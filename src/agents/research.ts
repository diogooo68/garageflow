// ============================================================
// RESEARCH AGENT
// Analisa cada oficina (website, servicos, dimensao, presenca online)
// e cria um resumo "porque esta oficina beneficia do GarageFlow".
// ============================================================
import { db, log, setAgentState } from '../db.js';
import { completeJSON } from '../llm.js';
import { findEmailOnWebsite } from '../integrations/emailFinder.js';

const AGENT = 'research';

const SYSTEM = `Es analista de mercado do GarageFlow, um SaaS de gestao/CRM para oficinas automoveis.
O GarageFlow ajuda oficinas a: organizar clientes e viaturas, gerir marcacoes e agenda,
faturacao e orcamentos, historico de reparacoes, lembretes de revisao/inspecao (IPO) por SMS/email,
e ter uma visao clara do negocio.
Analisas cada oficina a partir dos dados fornecidos e produzes uma analise objetiva e util para vendas.
Nunca inventas factos que nao estejam nos dados. Escreves em portugues de Portugal.`;

async function fetchWebsiteSnippet(website?: string): Promise<string> {
  if (!website) return '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(website, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 GarageFlowBot' } });
    clearTimeout(t);
    if (!res.ok) return '';
    const html = await res.text();
    // Remove tags e reduz a ~2500 chars de texto util.
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, 2500);
  } catch {
    return '';
  }
}

type ResearchOut = {
  servicos: string[];
  dimensao_estimada: 'pequena' | 'media' | 'grande' | 'desconhecida';
  presenca_online: 'fraca' | 'media' | 'forte';
  resumo: string;           // porque beneficia do GarageFlow
  dores_provaveis: string[];
};

export async function researchLead(leadId: string): Promise<void> {
  const { data: lead } = await db.from('leads').select('*').eq('id', leadId).single();
  if (!lead) return;

  const snippet = await fetchWebsiteSnippet(lead.website);
  // Aproveita para tentar apanhar email se ainda nao houver.
  if (!lead.email) {
    const email = await findEmailOnWebsite(lead.website);
    if (email) await db.from('leads').update({ email }).eq('id', leadId);
  }

  const user = `Dados da oficina:
Nome: ${lead.nome_oficina}
Cidade: ${lead.cidade ?? '?'}
Morada: ${lead.morada ?? '?'}
Website: ${lead.website ?? 'sem website'}
Rating Google: ${lead.rating ?? '?'} (${lead.total_reviews ?? 0} avaliacoes)
Categoria: ${lead.categoria ?? '?'}
Texto do website (extrato): ${snippet || 'indisponivel'}

Devolve JSON com as chaves: servicos (array), dimensao_estimada, presenca_online,
resumo (2-4 frases, especifico a esta oficina, a explicar porque beneficiaria do GarageFlow),
dores_provaveis (array de 2-4 itens).`;

  const out = await completeJSON<ResearchOut>(SYSTEM, user, 0.5);

  await db.from('leads').update({
    estado: lead.estado === 'nova' ? 'analisada' : lead.estado,
    research_resumo: out.resumo,
    notas: JSON.stringify({
      servicos: out.servicos,
      dimensao: out.dimensao_estimada,
      presenca_online: out.presenca_online,
      dores: out.dores_provaveis,
    }),
  }).eq('id', leadId);

  await log({ agente: AGENT, accao: 'analisada', lead_id: leadId, motivo: lead.nome_oficina, resultado: 'ok' });
}

// Analisa todas as leads no estado 'nova'.
export async function runResearch(limit = 50): Promise<number> {
  await setAgentState(AGENT, 'a_correr', 'Analisar leads novas');
  const { data: leads } = await db.from('leads').select('id').eq('estado', 'nova').limit(limit);
  let n = 0;
  for (const l of leads ?? []) {
    try { await researchLead(l.id); n++; }
    catch (e) { await log({ agente: AGENT, accao: 'erro', lead_id: l.id, resultado: 'erro', motivo: (e as Error).message }); }
  }
  await setAgentState(AGENT, 'idle');
  return n;
}
