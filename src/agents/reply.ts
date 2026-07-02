// ============================================================
// REPLY AGENT
// Quando uma oficina responde: analisa intencao, classifica, responde
// automaticamente e define proxima accao. Se houver interesse -> Meeting Agent.
// ============================================================
import { db, log, setAgentState } from '../db.js';
import { complete, completeJSON } from '../llm.js';
import { sendEmail, suppress } from '../integrations/email.js';
import { schedulingLink } from '../integrations/calendly.js';

const AGENT = 'reply';

const SYSTEM_INTENT = `Es comercial do GarageFlow (CRM para oficinas). Classificas a resposta de uma oficina a um email de outreach.
Devolve JSON:
{
  "intencao": "interesse" | "duvida" | "mais_tarde" | "nao_interessado" | "opt_out" | "auto_reply" | "outro",
  "resumo": "1 frase",
  "sentimento": "positivo" | "neutro" | "negativo"
}
"opt_out" = pede para remover/parar/nao contactar. "auto_reply" = resposta automatica/ausencia.`;

const SYSTEM_REPLY = `Es comercial do GarageFlow (CRM para oficinas automoveis). Respondes a uma oficina que respondeu ao teu outreach.
Portugues de Portugal, humano, util, curto (max 90 palavras). Responde ao que perguntaram.
Se houver interesse ou abertura, propoe uma demo de 15 min e inclui o link de marcacao fornecido.
Nao sejas insistente. Nao inventes funcionalidades. Devolve apenas o corpo do email.`;

type Intent = { intencao: string; resumo: string; sentimento: string };

// Analisa uma resposta recebida e age.
export async function handleReply(leadId: string, replyText: string): Promise<Intent> {
  const { data: lead } = await db.from('leads').select('*').eq('id', leadId).single();
  if (!lead) throw new Error('lead nao encontrada');

  const intent = await completeJSON<Intent>(SYSTEM_INTENT, `Resposta da oficina "${lead.nome_oficina}":\n"""${replyText}"""`, 0.2);

  // Regista a resposta como mensagem recebida.
  await db.from('mensagens').insert({
    lead_id: leadId, tipo: 'resposta', canal: 'email',
    conteudo: replyText, resposta: replyText, estado: 'respondida',
    data_resposta: new Date().toISOString(), agente: AGENT,
  });

  // OPT-OUT: suprime e marca perdida. Nunca mais contactar (RGPD).
  if (intent.intencao === 'opt_out') {
    if (lead.email) await suppress(lead.email, 'opt_out');
    await db.from('leads').update({ estado: 'perdida', proxima_accao: null, notas: 'opt-out pedido' }).eq('id', leadId);
    await log({ agente: AGENT, accao: 'opt_out', lead_id: leadId, resultado: 'ok' });
    return intent;
  }

  // AUTO-REPLY: ignora, mantem cadencia.
  if (intent.intencao === 'auto_reply') {
    await log({ agente: AGENT, accao: 'auto_reply_ignorado', lead_id: leadId, resultado: 'skip' });
    return intent;
  }

  // Para a cadencia de follow-up (respondeu).
  const novoEstado = ['interesse', 'duvida', 'mais_tarde'].includes(intent.intencao)
    ? (intent.intencao === 'interesse' ? 'interesse' : 'respondeu')
    : 'respondeu';

  // Gera resposta personalizada.
  const link = schedulingLink();
  const corpo = await complete(
    SYSTEM_REPLY,
    `Oficina: ${lead.nome_oficina}\nIntencao detetada: ${intent.intencao}\nResposta recebida: "${replyText}"\n` +
    `Link de marcacao de demo: ${link || '(sem link configurado — pede disponibilidade)'}`,
    0.7,
  );

  const enviada = lead.email ? await sendEmail(lead.email, `Re: GarageFlow`, corpo) : { ok: false, error: 'sem email' };
  if (enviada.ok) {
    await db.from('mensagens').insert({
      lead_id: leadId, tipo: 'resposta', canal: 'email', assunto: 'Re: GarageFlow',
      conteudo: corpo, estado: 'enviada', data_envio: new Date().toISOString(), agente: AGENT,
    });
  }

  await db.from('leads').update({
    estado: novoEstado,
    proxima_accao: null, // cadencia parada; se houver interesse, Meeting Agent trata
    ultimo_contacto: new Date().toISOString(),
  }).eq('id', leadId);

  await log({ agente: AGENT, accao: 'resposta_tratada', lead_id: leadId, motivo: intent.intencao, resultado: 'ok' });
  return intent;
}

// Processa respostas que chegaram por webhook mas ainda estao por analisar
// (mensagens tipo 'resposta' com estado 'rascunho' e campo resposta preenchido).
export async function runReply(): Promise<number> {
  await setAgentState(AGENT, 'a_correr', 'Analisar respostas');
  const { data: pendentes } = await db.from('mensagens')
    .select('id, lead_id, resposta')
    .eq('tipo', 'resposta').eq('estado', 'rascunho').not('resposta', 'is', null).limit(50);
  let n = 0;
  for (const m of pendentes ?? []) {
    try {
      await db.from('mensagens').update({ estado: 'respondida' }).eq('id', m.id);
      await handleReply(m.lead_id, m.resposta as string); n++;
    } catch (e) {
      await log({ agente: AGENT, accao: 'erro', lead_id: m.lead_id, resultado: 'erro', motivo: (e as Error).message });
    }
  }
  await setAgentState(AGENT, 'idle');
  return n;
}
