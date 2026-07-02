// Envio de email via Resend + verificacao de supressao (RGPD/opt-out/bounce).
import { Resend } from 'resend';
import { config } from '../config.js';
import { db } from '../db.js';

const resend = config.email.resendKey ? new Resend(config.email.resendKey) : null;

export async function isSuppressed(email?: string): Promise<boolean> {
  if (!email) return true;
  const dominio = email.split('@')[1]?.toLowerCase();
  const { data } = await db.from('supressoes')
    .select('id')
    .or(`email.eq.${email.toLowerCase()},dominio.eq.${dominio}`)
    .limit(1);
  return !!(data && data.length);
}

export async function suppress(email: string, motivo: string): Promise<void> {
  await db.from('supressoes').insert({
    email: email.toLowerCase(),
    dominio: email.split('@')[1]?.toLowerCase(),
    motivo,
  });
}

export type SendResult = { ok: boolean; id?: string; skipped?: string; error?: string };

export async function sendEmail(to: string, subject: string, body: string): Promise<SendResult> {
  if (await isSuppressed(to)) return { ok: false, skipped: 'suprimido' };

  // DRY_RUN: nao envia, apenas simula (util ate teres dominio verificado + warm-up).
  if (config.limits.dryRun) {
    return { ok: true, id: `dryrun-${Date.now()}`, skipped: 'dry_run' };
  }
  if (!resend) return { ok: false, error: 'RESEND_API_KEY nao configurada' };

  try {
    const res = await resend.emails.send({
      from: config.email.from,
      to,
      subject,
      replyTo: config.email.replyTo || undefined,
      text: body,
    });
    if (res.error) return { ok: false, error: String(res.error) };
    return { ok: true, id: res.data?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
