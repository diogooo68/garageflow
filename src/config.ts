// Configuracao central — le variaveis de ambiente uma unica vez.
import 'dotenv/config';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta a variavel de ambiente: ${name}`);
  return v;
}
function opt(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const config = {
  supabase: {
    url: req('SUPABASE_URL'),
    serviceKey: req('SUPABASE_SERVICE_ROLE_KEY'),
  },
  google: {
    placesKey: opt('GOOGLE_PLACES_API_KEY'),
  },
  openai: {
    key: opt('OPENAI_API_KEY'),
    model: opt('OPENAI_MODEL', 'gpt-4o-mini'),
  },
  email: {
    resendKey: opt('RESEND_API_KEY'),
    from: opt('EMAIL_FROM', 'GarageFlow <onboarding@resend.dev>'),
    replyTo: opt('EMAIL_REPLY_TO'),
  },
  calendly: {
    token: opt('CALENDLY_API_TOKEN'),
    schedulingUrl: opt('CALENDLY_SCHEDULING_URL'),
  },
  prospect: {
    cidades: opt('PROSPECT_CIDADES', 'Lisboa;Porto').split(';').map(s => s.trim()).filter(Boolean),
    keywords: opt('PROSPECT_KEYWORDS', 'oficina automovel').split(';').map(s => s.trim()).filter(Boolean),
    pais: opt('PROSPECT_PAIS', 'PT'),
  },
  limits: {
    dailySend: parseInt(opt('DAILY_SEND_LIMIT', '40'), 10),
    dryRun: opt('DRY_RUN', 'true').toLowerCase() === 'true',
    minScoreToContact: parseInt(opt('MIN_SCORE_TO_CONTACT', '55'), 10),
  },
  ops: {
    timezone: opt('TIMEZONE', 'Europe/Lisbon'),
    pipelineCron: opt('PIPELINE_CRON', '0 8 * * *'),
    reportEmailTo: opt('REPORT_EMAIL_TO'),
    port: parseInt(opt('PORT', '3000'), 10),
  },
};
