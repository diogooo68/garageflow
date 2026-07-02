// ============================================================
// Servidor HTTP: dashboard + webhooks (Calendly, email inbound) + triggers manuais.
// Corre dentro do worker no Railway (mesma instancia).
// ============================================================
import express from 'express';
import { config } from './config.js';
import { db } from './db.js';
import { registarReuniaoCalendly } from './agents/meeting.js';
import { handleReply } from './agents/reply.js';
import { runPipeline } from './pipeline.js';
import { runProspect } from './agents/prospect.js';

export function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // -------- Dashboard simples --------
  app.get('/', async (_req, res) => {
    const { data: pipeline } = await db.from('v_pipeline').select('*');
    const { data: stats } = await db.from('estatisticas').select('*').order('dia', { ascending: false }).limit(1);
    const { data: logs } = await db.from('logs').select('*').order('data', { ascending: false }).limit(30);
    const { data: agentes } = await db.from('agentes').select('nome, estado, tarefa_atual, ultima_accao');
    res.type('html').send(renderDashboard({ pipeline, stat: stats?.[0], logs, agentes }));
  });

  // -------- Webhook Calendly (invitee.created) --------
  app.post('/webhooks/calendly', async (req, res) => {
    try {
      if (req.body?.event === 'invitee.created' || req.body?.payload) {
        await registarReuniaoCalendly(req.body);
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // -------- Webhook email inbound (Resend inbound / reencaminhamento) --------
  // Espera { from, subject, text } — mapeia o remetente a uma lead pelo email.
  app.post('/webhooks/email-inbound', async (req, res) => {
    try {
      const from = (req.body?.from?.address || req.body?.from || '').toLowerCase();
      const text = req.body?.text || req.body?.body || '';
      if (!from || !text) return res.status(400).json({ error: 'faltam from/text' });
      const { data: lead } = await db.from('leads').select('id').ilike('email', from).maybeSingle();
      if (!lead) return res.json({ ok: true, note: 'sem lead correspondente' });
      await handleReply(lead.id, text);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // -------- Triggers manuais (protegidos por token) --------
  app.post('/run/:job', async (req, res) => {
    const token = req.query.token || req.headers['x-token'];
    if (config.supabase.serviceKey && token !== process.env.TRIGGER_TOKEN) {
      return res.status(401).json({ error: 'nao autorizado (define TRIGGER_TOKEN e passa ?token=)' });
    }
    const job = req.params.job;
    // Corre em background para nao bloquear o request.
    (async () => {
      try {
        if (job === 'prospect') await runProspect({ enrichEmails: true });
        else if (job === 'pipeline') await runPipeline({ prospect: false });
        else if (job === 'pipeline-full') await runPipeline({ prospect: true });
      } catch (e) { console.error('job err', e); }
    })();
    res.json({ ok: true, started: job });
  });

  app.listen(config.ops.port, () => console.log(`HTTP a ouvir na porta ${config.ops.port}`));
}

function renderDashboard(d: any): string {
  const pipe = (d.pipeline ?? []).map((p: any) =>
    `<tr><td>${p.estado}</td><td style="text-align:right">${p.total}</td><td style="text-align:right">${p.score_medio ?? '-'}</td></tr>`).join('');
  const ag = (d.agentes ?? []).map((a: any) =>
    `<tr><td>${a.nome}</td><td>${a.estado}</td><td>${a.tarefa_atual ?? '-'}</td><td>${a.ultima_accao ? new Date(a.ultima_accao).toLocaleString('pt-PT') : '-'}</td></tr>`).join('');
  const lg = (d.logs ?? []).map((l: any) =>
    `<tr><td>${new Date(l.data).toLocaleString('pt-PT')}</td><td>${l.agente}</td><td>${l.accao}</td><td>${l.motivo ?? ''}</td><td>${l.resultado}</td></tr>`).join('');
  const s = d.stat;
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GarageFlow Sales Engine</title>
<style>
  body{font-family:system-ui,Segoe UI,Arial;margin:0;background:#0b0f17;color:#e6edf3}
  header{padding:20px 28px;background:#111827;border-bottom:1px solid #1f2937}
  h1{margin:0;font-size:20px}
  .wrap{padding:24px 28px;display:grid;gap:24px;max-width:1100px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
  .card{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:16px}
  .card .n{font-size:26px;font-weight:700}
  .card .l{color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  table{width:100%;border-collapse:collapse;background:#111827;border-radius:12px;overflow:hidden}
  th,td{padding:8px 12px;border-bottom:1px solid #1f2937;font-size:13px;text-align:left}
  th{color:#9ca3af;font-weight:600;text-transform:uppercase;font-size:11px}
  section h2{font-size:14px;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px}
  .rec{background:#0f172a;border:1px solid #1f2937;border-radius:12px;padding:16px;white-space:pre-wrap;color:#cbd5e1}
</style></head><body>
<header><h1>GarageFlow · Sales Engine</h1></header>
<div class="wrap">
  <div class="cards">
    <div class="card"><div class="n">${s?.novas_leads ?? 0}</div><div class="l">Novas leads (24h)</div></div>
    <div class="card"><div class="n">${s?.contactos_enviados ?? 0}</div><div class="l">Contactos (24h)</div></div>
    <div class="card"><div class="n">${s?.respostas ?? 0}</div><div class="l">Respostas (24h)</div></div>
    <div class="card"><div class="n">${s?.demos_marcadas ?? 0}</div><div class="l">Demos marcadas</div></div>
    <div class="card"><div class="n">${s?.taxa_resposta ?? 0}%</div><div class="l">Taxa resposta</div></div>
    <div class="card"><div class="n">${s?.novos_clientes ?? 0}</div><div class="l">Clientes</div></div>
  </div>
  <section><h2>Recomendacoes de hoje</h2><div class="rec">${s?.recomendacoes ?? 'Ainda sem relatorio. Corre o pipeline.'}</div></section>
  <section><h2>Pipeline</h2><table><tr><th>Estado</th><th style="text-align:right">Total</th><th style="text-align:right">Score medio</th></tr>${pipe || '<tr><td colspan=3>vazio</td></tr>'}</table></section>
  <section><h2>Agentes</h2><table><tr><th>Agente</th><th>Estado</th><th>Tarefa</th><th>Ultima accao</th></tr>${ag}</table></section>
  <section><h2>Ultimos logs</h2><table><tr><th>Data</th><th>Agente</th><th>Accao</th><th>Motivo</th><th>Resultado</th></tr>${lg}</table></section>
</div></body></html>`;
}
