// ============================================================
// QUALIFICATION AGENT
// Pontua cada oficina 0-100 com justificacao explicita.
// Criterios: tamanho, atividade, presenca digital, potencial de compra.
// ============================================================
import { db, log, setAgentState } from '../db.js';
import { completeJSON } from '../llm.js';

const AGENT = 'qualification';

const SYSTEM = `Es responsavel de qualificacao de leads do GarageFlow (CRM para oficinas automoveis).
Pontuas cada oficina de 0 a 100 quanto a probabilidade de se tornar cliente do GarageFlow.
Criterios e pesos sugeridos:
- Tamanho/dimensao da oficina (0-30): oficinas medias sao o alvo ideal; micro pode ter menos orcamento, grandes ja podem ter software.
- Atividade/reputacao (0-25): rating e numero de avaliacoes no Google indicam volume de clientes.
- Presenca digital (0-25): ter website e presenca online sugere abertura a ferramentas digitais.
- Potencial de compra/encaixe (0-20): dores identificadas que o GarageFlow resolve.
Explica sempre o motivo do score. Portugues de Portugal. Devolve JSON.`;

type QualOut = { score: number; motivo: string };

export async function qualifyLead(leadId: string): Promise<void> {
  const { data: lead } = await db.from('leads').select('*').eq('id', leadId).single();
  if (!lead) return;

  const user = `Oficina: ${lead.nome_oficina}
Cidade: ${lead.cidade ?? '?'}
Rating: ${lead.rating ?? '?'} (${lead.total_reviews ?? 0} avaliacoes)
Website: ${lead.website ? 'sim' : 'nao'}
Analise previa: ${lead.research_resumo ?? 'n/d'}
Notas: ${lead.notas ?? 'n/d'}

Devolve JSON: { "score": <int 0-100>, "motivo": "<explicacao curta e concreta do score>" }`;

  const out = await completeJSON<QualOut>(SYSTEM, user, 0.3);
  const score = Math.max(0, Math.min(100, Math.round(out.score)));

  await db.from('leads').update({
    score,
    score_motivo: out.motivo,
  }).eq('id', leadId);

  await log({ agente: AGENT, accao: 'qualificada', lead_id: leadId, motivo: `score ${score}`, resultado: 'ok' });
}

// Qualifica leads analisadas ainda sem score.
export async function runQualification(limit = 50): Promise<number> {
  await setAgentState(AGENT, 'a_correr', 'Pontuar leads');
  const { data: leads } = await db.from('leads')
    .select('id').eq('estado', 'analisada').is('score', null).limit(limit);
  let n = 0;
  for (const l of leads ?? []) {
    try { await qualifyLead(l.id); n++; }
    catch (e) { await log({ agente: AGENT, accao: 'erro', lead_id: l.id, resultado: 'erro', motivo: (e as Error).message }); }
  }
  await setAgentState(AGENT, 'idle');
  return n;
}
