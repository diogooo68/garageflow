// Cliente Supabase + helpers de logging e estado dos agentes.
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const db = createClient(config.supabase.url, config.supabase.serviceKey, {
  auth: { persistSession: false },
});

type LogArgs = {
  agente: string;
  accao: string;
  motivo?: string;
  resultado?: 'ok' | 'erro' | 'skip';
  lead_id?: string;
  detalhe?: unknown;
};

export async function log(a: LogArgs) {
  const line = `[${a.agente}] ${a.accao}${a.motivo ? ' — ' + a.motivo : ''} (${a.resultado ?? 'ok'})`;
  console.log(line);
  try {
    await db.from('logs').insert({
      agente: a.agente,
      accao: a.accao,
      motivo: a.motivo ?? null,
      resultado: a.resultado ?? 'ok',
      lead_id: a.lead_id ?? null,
      detalhe: a.detalhe ? JSON.parse(JSON.stringify(a.detalhe)) : null,
    });
  } catch (e) {
    console.error('Falha a gravar log:', e);
  }
}

export async function setAgentState(nome: string, estado: string, tarefa?: string) {
  await db.from('agentes')
    .update({ estado, tarefa_atual: tarefa ?? null, ultima_accao: new Date().toISOString() })
    .eq('nome', nome);
}
