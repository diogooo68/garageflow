// ============================================================
// MEETING AGENT
// Leads com interesse -> envia link Calendly. Webhook do Calendly regista a reuniao.
// ============================================================
import { db, log, setAgentState } from '../db.js';
import { complete } from '../llm.js';
import { sendEmail } from '../integrations/email.js';
import { schedulingLink, getScheduledEvent } from '../integrations/calendly.js';

const AGENT = 'meeting';

const SYSTEM = `Es comercial do GarageFlow. Escreves um email curto (max 70 palavras, PT-PT) a propor uma demo de 15 min
e a convidar a escolher horario no link fornecido. Tom simpatico e direto. Devolve apenas o corpo.`;

// Envia convite de marcacao a leads no estado 'interesse' sem reuniao ainda.
export async function runMeeting(): Promise<number> {
  await setAgentState(AGENT, 'a_correr', 'Enviar convites de demo');
  const link = schedulingLink();

  const { data: leads } = await db.from('leads').select('*').eq('estado', 'interesse').limit(50);
  let n = 0;
  for (const lead of leads ?? []) {
    // Ja tem reuniao?
    const { data: r } = await db.from('reunioes').select('id').eq('lead_id', lead.id).maybeSingle();
    if (r) continue;
    // Ja enviamos convite ha pouco? (evita spam) — verifica mensagem meeting recente
    const { data: convite } = await db.from('mensagens')
      .select('id').eq('lead_id', lead.id).eq('agente', AGENT).maybeSingle();
    if (convite) continue;
    if (!lead.email) continue;

    const corpo = await complete(SYSTEM,
      `Oficina: ${lead.nome_oficina} (${lead.cidade ?? '?'}). Link de marcacao: ${link || '(pede disponibilidade)'}`, 0.7);
    const sent = await sendEmail(lead.email, 'Demo GarageFlow — 15 min', corpo);
    if (sent.ok) {
      await db.from('mensagens').insert({
        lead_id: lead.id, tipo: 'manual', canal: 'email', assunto: 'Demo GarageFlow — 15 min',
        conteudo: corpo, estado: 'enviada', data_envio: new Date().toISOString(), agente: AGENT,
      });
      await db.from('leads').update({ ultimo_contacto: new Date().toISOString() }).eq('id', lead.id);
      n++;
      await log({ agente: AGENT, accao: 'convite_enviado', lead_id: lead.id, motivo: lead.nome_oficina, resultado: 'ok' });
    }
  }
  await setAgentState(AGENT, 'idle');
  return n;
}

// Chamado pelo webhook do Calendly quando alguem marca. Cria reuniao e atualiza CRM.
export async function registarReuniaoCalendly(payload: any): Promise<void> {
  // Estrutura do webhook Calendly v2: payload.event = 'invitee.created'
  const evt = payload?.payload;
  const email = evt?.email?.toLowerCase();
  const eventUri = evt?.scheduled_event?.uri || evt?.event;
  const startTime = evt?.scheduled_event?.start_time;

  if (!email) { await log({ agente: AGENT, accao: 'webhook_sem_email', resultado: 'skip' }); return; }

  // Encontra a lead pelo email do convidado.
  const { data: lead } = await db.from('leads').select('id, nome_oficina').ilike('email', email).maybeSingle();

  const detalhes = eventUri ? await getScheduledEvent(eventUri) : null;

  await db.from('reunioes').insert({
    lead_id: lead?.id ?? null,
    calendly_event_id: eventUri ?? null,
    data_reuniao: startTime ?? detalhes?.resource?.start_time ?? null,
    estado: 'marcada',
    link: detalhes?.resource?.location?.join_url ?? null,
  });

  if (lead) {
    await db.from('leads').update({ estado: 'demonstracao_marcada', proxima_accao: null }).eq('id', lead.id);
    await log({ agente: AGENT, accao: 'demo_marcada', lead_id: lead.id, motivo: lead.nome_oficina, resultado: 'ok' });
  } else {
    await log({ agente: AGENT, accao: 'demo_marcada_sem_lead', motivo: email, resultado: 'ok' });
  }
}
