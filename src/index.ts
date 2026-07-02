// ============================================================
// Ponto de entrada / CLI.
//   npm run prospect   -> corre so o Prospect Agent (scrape de todas as oficinas)
//   npm run pipeline   -> corre o pipeline completo uma vez
//   npm run report     -> gera e envia o relatorio diario
//   npm start (worker) -> arranca o scheduler (cron) — modo Railway
// ============================================================
import cron from 'node-cron';
import { config } from './config.js';
import { runPipeline } from './pipeline.js';
import { runProspect } from './agents/prospect.js';
import { runAnalytics } from './agents/analytics.js';
import { startServer } from './server.js';

const cmd = process.argv[2] ?? 'worker';

async function main() {
  switch (cmd) {
    case 'prospect': {
      const r = await runProspect({ enrichEmails: true });
      console.log(`\nProspect concluido: ${r.novas} novas leads (de ${r.encontradas} oficinas encontradas).`);
      process.exit(0);
      break;
    }
    case 'pipeline': {
      await runPipeline({ prospect: true });
      process.exit(0);
      break;
    }
    case 'report': {
      await runAnalytics(true);
      process.exit(0);
      break;
    }
    case 'worker':
    default: {
      // Modo Railway: servidor HTTP (webhooks + dashboard) + cron.
      startServer();

      console.log(`Scheduler ativo. Pipeline diario: "${config.ops.pipelineCron}" (${config.ops.timezone})`);
      // Pipeline diario (sem prospect todos os dias).
      cron.schedule(config.ops.pipelineCron, () => {
        runPipeline({ prospect: false }).catch(err => console.error('pipeline err', err));
      }, { timezone: config.ops.timezone });

      // Prospecao 1x/semana (segunda 06:00) para renovar o funil.
      cron.schedule('0 6 * * 1', () => {
        runProspect({ enrichEmails: true }).catch(err => console.error('prospect err', err));
      }, { timezone: config.ops.timezone });

      console.log('Worker a correr. Ctrl+C para sair.');
      break;
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
