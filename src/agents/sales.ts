// ============================================================
// SALES AGENT
// Cria a mensagem de primeiro contacto, personalizada por oficina.
// Nunca generica. Grava como mensagem 'rascunho' (o envio e do Follow-up/Orquestrador).
// ============================================================
import { db, log, setAgentState } from '../db.js';
import { completeJSON } from '../llm.js';
import { config } from '../config.js';

const AGENT = 'sales';

const SYSTEM = `Es o melhor comercial do GarageFlow (CRM/gestao para oficinas automoveis).
Escreves emails de primeiro contacto (cold outreach B2B) para donos de oficinas em Portugal.
Regras:
- Portugues de Portugal, tom humano, direto e respeitoso. Tratamento por "voce".
- NUNCA generico. Referencia algo especifico da oficina (servicos, cidade, reputacao).
- Curto: 60-110 palavras. Uma unica proposta de valor clara + 1 pergunta/CTA suave.
- Nada de exageros, nada de "melhor do mundo", nada de mentiras.
- Assunto curto (max 6 palavras), sem clickbait, sem emojis.
- Termina com abertura para uma demo rapida de 15 min, sem pressao.
- Inclui sempre espaco para opt-out (a assinatura trata disso; nao escrevas o opt-out no corpo).
Devolve JSON: { "assunto": "...", "corpo": "..." }`;

type SalesOut = { assunto: string; corpo: string };

function assinatura(): string {
  return `\n\n— Diogo Henriques\nGarageFlow · Gestao simples para oficinas\n${config.calendly.schedulingUrl || ''}` +
    `\n\nSe nao for do seu interesse, responda "remover" e nao voltamos a contactar.`;
}

export async function draftFirstMessage(leadId: string): Promise<string | null> {
  const { data: lead } = await db.from('leads').select('*').eq('id', leadId).single();
  if (!lead) return null;

  const user = `Oficina: ${lead.nome_oficina}
Cidade: ${lead.cidade ?? '?'}
Rating Google: ${lead.rating ?? '?'} (${lead.total_reviews ?? 0} avaliacoes)
Analise: ${lead.research_resumo ?? 'n/d'}
Notas (servicos/dores): ${lead.notas ?? 'n/d'}
Score de qualificacao: ${lead.score ?? '?'} — ${lead.score_motivo ?? ''}

Escreve o email de primeiro contacto. Devolve JSON { "assunto", "corpo" }.`;

  const out = await completeJSON<SalesOut>(SYSTEM, user, 0.8);
  const corpo = out.corpo.trim() + assinatura();

  const { data: msg, error } = await db.from('mensagens').insert({
    lead_id: leadId,
    tipo: 'primeiro_contacto',
    canal: 'email',
    assunto: out.assunto,
    conteudo: corpo,
    estado: 'rascunho',
    agente: AGENT,
  }).select('id').single();

  if (error) { await log({ agente: AGENT, accao: 'erro', lead_id: leadId, resultado: 'erro', motivo: error.message }); return null; }

  await log({ agente: AGENT, accao: 'rascunho_criado', lead_id: leadId, motivo: out.assunto, resultado: 'ok' });
  return msg?.id ?? null;
}

// Cria rascunhos para leads qualificadas acima do score minimo que ainda nao foram contactadas.
export async function runSales(limit = 50): Promise<number> {
  await setAgentState(AGENT, 'a_correr', 'Escrever mensagens');
  const { data: leads } = await db.from('leads')
    .select('id')
    .in('estado', ['analisada'])
    .gte('score', config.limits.minScoreToContact)
    .limit(limit);

  let n = 0;
  for (const l of leads ?? []) {
    // Evita duplicar rascunho de primeiro contacto.
    const { data: existing } = await db.from('mensagens')
      .select('id').eq('lead_id', l.id).eq('tipo', 'primeiro_contacto').maybeSingle();
    if (existing) continue;
    try { if (await draftFirstMessage(l.id)) n++; }
    catch (e) { await log({ agente: AGENT, accao: 'erro', lead_id: l.id, resultado: 'erro', motivo: (e as Error).message }); }
  }
  await setAgentState(AGENT, 'idle');
  return n;
}
