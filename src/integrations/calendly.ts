// Integracao Calendly. Para a maioria dos casos basta enviar o scheduling link.
// A API e usada para ler eventos marcados (via webhook) e confirmar.
import { config } from '../config.js';

export function schedulingLink(): string {
  return config.calendly.schedulingUrl;
}

// Le detalhes de um evento agendado a partir do URI recebido no webhook do Calendly.
export async function getScheduledEvent(eventUri: string): Promise<any | null> {
  if (!config.calendly.token) return null;
  try {
    const res = await fetch(eventUri, {
      headers: { Authorization: `Bearer ${config.calendly.token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
