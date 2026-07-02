// ============================================================
// FOLLOW-UP AGENT
// Sequencia automatica: D0 (primeiro contacto), D3, D7, D14 (ultima tentativa).
// Para automaticamente quando a lead responde.
// Respeita DAILY_SEND_LIMIT, MIN_SCORE e supressoes (RGPD).
// ============================================================
import { db, log, setAgentState } from '../db.js';
import { completeJSON } from '../llm.js';
import { config } from '../config.js';
import { sendEmail, isSuppressed } from '../integrations/email.js';

const AGENT = 'followup';

// Cadencia em dias desde o primeiro contacto -> tipo de mensagem.
const CADENCIA: Array<{ dia: number; tipo: 'followup_1' | 'followup_2' | 'followup_final' }> = [
  { dia: 3, tipo: 'followup_1' },
  { dia: 7, tipo: 'followup_2' },
  { dia: 14, tipo: 'followup_final' },
];

const SYSTEM = `Es comercial do GarageFlow (CRM para oficinas). Escreves follow-ups curtos a cold outreach B2B.
Portugues de Portugal, tom humano e leve, sem insistencia agressiva. Max 60 palavras.
Referencia que ja escreveste antes, traz 1 angulo/beneficio novo e uma pergunta simples.
No follow-up final, e uma despedida educada com porta aberta. Devolve JSON { "assunto", "corpo" }.`;

async function draftFollowup(lead: any, tipo: string, anterior?: string): Promise<{ assunto: string; corpo: string }> {
  const user = `Oficina: ${lead.nome_oficina} (${lead.cidade ?? '?'})
Analise: ${lead.research_resumo ?? 'n/d'}
Tipo de follow-up: ${tipo}
Mensagem anterior (resumo): ${anterior?.slice(0, 300) ?? 'n/d'}
Escreve o follow-up. JSON { "assunto", "corpo" }.`;
  return completeJSON(SYSTEM, user, 0.8);
}

// Envia o primeiro contacto (rascunhos) e agenda proxima accao para D3.
async function enviarPrimeirosContactos(orcamento: { restante: number }): Promise<number> {
  let n = 0;
  const { data: rascunhos } = await db.from('mensagens')
    .select('id, lead_id, assunto, conteudo, leads(email, estado, nome_oficina)')
    .eq('tipo', 'primeiro_contacto')
    .eq('estado', 'rascunho')
    .limit(orcamento.restante);

  for (const m of rascunhos ?? []) {
    if (orcamento.restante <= 0) break;
    const lead: any = (m as any).leads;
    if (!lead?.email || lead.estado !== 'analisada') continue;
    if (await isSuppressed(lead.email)) { await db.from('mensagens').update({ estado: 'suprimida' }).eq('id', m.id); continue; }

    const r = await sendEmail(lead.email, m.assunto ?? 'GarageFlow', m.conteudo);
    if (r.ok) {
      const agora = new Date();
      const prox = new Date(agora.getTime() + 3 * 864e5);
      await db.from('mensagens').update({
        estado: 'enviada', data_envio: agora.toISOString(), provider_id: r.id ?? null,
      }).eq('id', m.id);
      await db.from('leads').update({
        estado: 'contactada', ultimo_contacto: agora.toISOString(), proxima_accao: prox.toISOString(),
      }).eq('id', m.lead_id);
      orcamento.restante--; n++;
      await log({ agente: AGENT, accao: 'primeiro_contacto_enviado', lead_id: m.lead_id, motivo: lead.nome_oficina, resultado: 'ok', detalhe: { dry: r.skipped } });
    } else {
      await log({ agente: AGENT, accao: 'envio_falhou', lead_id: m.lead_id, resultado: 'erro', motivo: r.error ?? r.skipped });
    }
  }
  return n;
}

// Processa follow-ups D3/D7/D14 para leads contactadas cuja proxima_accao ja passou.
async function enviarFollowups(orcamento: { restante: number }): Promise<number> {
  let n = 0;
  const agora = new Date();
  const { data: leads } = await db.from('leads')
    .select('*')
    .eq('estado', 'contactada')
    .lte('proxima_accao', agora.toISOString())
    .limit(orcamento.restante);

  for (const lead of leads ?? []) {
    if (orcamento.restante <= 0) break;
    if (!lead.email || await isSuppressed(lead.email)) continue;

    // Quantos follow-ups ja foram enviados?
    const { data: enviados } = await db.from('mensagens')
      .select('tipo, conteudo')
      .eq('lead_id', lead.id)
      .in('tipo', ['followup_1', 'followup_2', 'followup_final'])
      .eq('estado', 'enviada');

    const nEnviados = enviados?.length ?? 0;
    const proximo = CADENCIA[nEnviados];
    if (!proximo) {
      // Ja fez a ultima tentativa sem resposta -> perdida.
      await db.from('leads').update({ estado: 'perdida', proxima_accao: null }).eq('id', lead.id);
      await log({ agente: AGENT, accao: 'sequencia_terminada', lead_id: lead.id, motivo: 'sem resposta', resultado: 'ok' });
      continue;
    }

    const { data: primeiro } = await db.from('mensagens')
      .select('conteudo').eq('lead_id', lead.id).eq('tipo', 'primeiro_contacto').maybeSingle();

    const draft = await draftFollowup(lead, proximo.tipo, primeiro?.conteudo);
    const r = await sendEmail(lead.email, draft.assunto, draft.corpo);

    if (r.ok) {
      const proxDias = CADENCIA[nEnviados + 1]?.dia;
      const proxData = proxDias ? new Date(agora.getTime() + (proxDias - proximo.dia) * 864e5) : null;
      await db.from('mensagens').insert({
        lead_id: lead.id, tipo: proximo.tipo, canal: 'email',
        assunto: draft.assunto, conteudo: draft.corpo,
        estado: 'enviada', data_envio: agora.toISOString(), provider_id: r.id ?? null, agente: AGENT,
      });
      await db.from('leads').update({
        ultimo_contacto: agora.toISOString(),
        proxima_accao: proxData ? proxData.toISOString() : null,
      }).eq('id', lead.id);
      orcamento.restante--; n++;
      await log({ agente: AGENT, accao: `${proximo.tipo}_enviado`, lead_id: lead.id, motivo: lead.nome_oficina, resultado: 'ok' });
    } else {
      await log({ agente: AGENT, accao: 'followup_falhou', lead_id: lead.id, resultado: 'erro', motivo: r.error ?? r.skipped });
    }
  }
  return n;
}

export async function runFollowup(): Promise<{ primeiros: number; followups: number }> {
  await setAgentState(AGENT, 'a_correr', 'Enviar contactos e follow-ups');
  const orcamento = { restante: config.limits.dailySend };
  const primeiros = await enviarPrimeirosContactos(orcamento);
  const followups = await enviarFollowups(orcamento);
  await log({ agente: AGENT, accao: 'fim', motivo: `${primeiros} primeiros, ${followups} follow-ups`, resultado: 'ok' });
  await setAgentState(AGENT, 'idle');
  return { primeiros, followups };
}
