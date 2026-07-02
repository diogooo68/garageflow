// ============================================================
// ANALYTICS AGENT
// Snapshot diario: leads, contactos, respostas, conversoes, melhores mensagens.
// Gera recomendacoes e envia relatorio diario por email.
// ============================================================
import { db, log, setAgentState } from '../db.js';
import { complete } from '../llm.js';
import { config } from '../config.js';
import { sendEmail } from '../integrations/email.js';

const AGENT = 'analytics';

function hoje(): string { return new Date().toISOString().slice(0, 10); }

async function count(filter: (q: any) => any): Promise<number> {
  const { count } = await filter(db.from('leads').select('*', { count: 'exact', head: true }));
  return count ?? 0;
}

export async function runAnalytics(sendReport = true): Promise<any> {
  await setAgentState(AGENT, 'a_correr', 'Calcular metricas');
  const dia = hoje();
  const ontem = new Date(Date.now() - 864e5).toISOString();

  // Totais de pipeline por estado.
  const { data: pipeline } = await db.from('v_pipeline').select('*');

  // Metricas do dia.
  const novasLeads = await count(q => q.gte('data_criacao', ontem));
  const { count: contactosEnviados } = await db.from('mensagens')
    .select('*', { count: 'exact', head: true })
    .in('tipo', ['primeiro_contacto', 'followup_1', 'followup_2', 'followup_final'])
    .eq('estado', 'enviada').gte('data_envio', ontem);
  const { count: respostas } = await db.from('mensagens')
    .select('*', { count: 'exact', head: true })
    .eq('tipo', 'resposta').gte('data_resposta', ontem);
  const interessados = await count(q => q.eq('estado', 'interesse'));
  const demos = await count(q => q.eq('estado', 'demonstracao_marcada'));
  const clientes = await count(q => q.eq('estado', 'cliente'));

  const totalContactadas = await count(q => q.in('estado', ['contactada', 'respondeu', 'interesse', 'demonstracao_marcada', 'cliente', 'perdida']));
  const totalRespondeu = await count(q => q.in('estado', ['respondeu', 'interesse', 'demonstracao_marcada', 'cliente']));
  const taxaResposta = totalContactadas ? +(100 * totalRespondeu / totalContactadas).toFixed(1) : 0;
  const taxaConversao = totalContactadas ? +(100 * clientes / totalContactadas).toFixed(1) : 0;

  const metrics = {
    dia, novasLeads, contactosEnviados: contactosEnviados ?? 0, respostas: respostas ?? 0,
    interessados, demos, clientes, taxaResposta, taxaConversao, pipeline,
  };

  // Recomendacoes via LLM.
  const recomendacoes = await complete(
    `Es Head of Growth do GarageFlow. Analisas metricas diarias de outreach a oficinas e dás 3 recomendacoes
     concretas e acionaveis para aumentar demos marcadas. PT-PT, direto, sem enchimento. Max 120 palavras.`,
    `Metricas de hoje:\n${JSON.stringify(metrics, null, 2)}`,
    0.6,
  );

  // Persiste snapshot (upsert por dia).
  await db.from('estatisticas').upsert({
    dia,
    novas_leads: novasLeads,
    contactos_enviados: contactosEnviados ?? 0,
    respostas: respostas ?? 0,
    interessados,
    demos_marcadas: demos,
    novos_clientes: clientes,
    taxa_resposta: taxaResposta,
    taxa_conversao: taxaConversao,
    recomendacoes,
    detalhe: metrics,
  }, { onConflict: 'dia' });

  // Relatorio por email.
  if (sendReport && config.ops.reportEmailTo) {
    const corpo = relatorioTexto(metrics, recomendacoes);
    await sendEmailReport(config.ops.reportEmailTo, `GarageFlow — Relatorio ${dia}`, corpo);
  }

  await log({ agente: AGENT, accao: 'relatorio', motivo: dia, resultado: 'ok', detalhe: metrics });
  await setAgentState(AGENT, 'idle');
  return { ...metrics, recomendacoes };
}

function relatorioTexto(m: any, rec: string): string {
  const linhasPipe = (m.pipeline ?? []).map((p: any) => `  - ${p.estado}: ${p.total} (score medio ${p.score_medio ?? '-'})`).join('\n');
  return `Relatorio diario GarageFlow — ${m.dia}

RESULTADOS (ultimas 24h)
  Novas leads: ${m.novasLeads}
  Contactos enviados: ${m.contactosEnviados}
  Respostas: ${m.respostas}
  Interessados (total): ${m.interessados}
  Demos marcadas (total): ${m.demos}
  Clientes (total): ${m.clientes}
  Taxa de resposta: ${m.taxaResposta}%
  Taxa de conversao: ${m.taxaConversao}%

PIPELINE
${linhasPipe || '  (vazio)'}

RECOMENDACOES
${rec}
`;
}

// Envia sempre (relatorio interno) mesmo em dry-run de outreach — usa o mesmo canal.
async function sendEmailReport(to: string, subject: string, body: string) {
  // O relatorio e para ti, por isso ignora dry-run de outreach: forca envio se houver Resend.
  const r = await sendEmail(to, subject, body);
  if (!r.ok && r.skipped === 'dry_run') {
    console.log('\n===== RELATORIO (dry-run, nao enviado) =====\n' + body);
  }
}
