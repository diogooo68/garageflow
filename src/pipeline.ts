// ============================================================
// ORQUESTRADOR — corre o pipeline completo de uma passagem.
// Ordem: Prospect -> Research -> Qualification -> Sales -> Reply -> Meeting -> Follow-up -> Analytics
// (Prospect nao corre todos os dias por defeito; ver runPipeline.)
// ============================================================
import { log } from './db.js';
import { runProspect } from './agents/prospect.js';
import { runResearch } from './agents/research.js';
import { runQualification } from './agents/qualification.js';
import { runSales } from './agents/sales.js';
import { runReply } from './agents/reply.js';
import { runMeeting } from './agents/meeting.js';
import { runFollowup } from './agents/followup.js';
import { runAnalytics } from './agents/analytics.js';

export async function runPipeline(opts?: { prospect?: boolean }): Promise<void> {
  const t0 = Date.now();
  await log({ agente: 'orquestrador', accao: 'pipeline_inicio' });

  try {
    // 1) Prospecao (opcional — normalmente 1x/semana chega para nao gastar API/quota).
    if (opts?.prospect) {
      const p = await runProspect();
      await log({ agente: 'orquestrador', accao: 'prospect', motivo: `${p.novas} novas de ${p.encontradas}` });
    }

    // 2) Analisar leads novas.
    const analisadas = await runResearch();
    // 3) Pontuar.
    const pontuadas = await runQualification();
    // 4) Escrever mensagens (rascunhos) para as boas.
    const rascunhos = await runSales();
    // 5) Processar respostas recebidas.
    const respostas = await runReply();
    // 6) Convidar interessados para demo.
    const convites = await runMeeting();
    // 7) Enviar primeiros contactos + follow-ups (respeita limite diario).
    const envio = await runFollowup();
    // 8) Relatorio diario.
    const rel = await runAnalytics(true);

    await log({
      agente: 'orquestrador', accao: 'pipeline_fim', resultado: 'ok',
      motivo: `analisadas:${analisadas} pontuadas:${pontuadas} rascunhos:${rascunhos} respostas:${respostas} convites:${convites} enviados:${envio.primeiros + envio.followups} em ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      detalhe: { analisadas, pontuadas, rascunhos, respostas, convites, envio, demos: rel.demos },
    });
  } catch (e) {
    await log({ agente: 'orquestrador', accao: 'pipeline_erro', resultado: 'erro', motivo: (e as Error).message });
    throw e;
  }
}
