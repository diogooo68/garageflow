// ============================================================
// PROSPECT AGENT
// Encontra TODAS as oficinas de uma vez (todas as cidades x keywords),
// dedup por google_place_id + nome/cidade, e grava em Supabase.
// ============================================================
import { db, log, setAgentState } from '../db.js';
import { config } from '../config.js';
import { scrapeAllWorkshops } from '../integrations/places.js';
import { findEmailOnWebsite } from '../integrations/emailFinder.js';

const AGENT = 'prospect';

export async function runProspect(opts?: { enrichEmails?: boolean }): Promise<{ encontradas: number; novas: number }> {
  await setAgentState(AGENT, 'a_correr', 'Scrape Google Places');

  if (!config.google.placesKey) {
    await log({ agente: AGENT, accao: 'prospect', resultado: 'erro', motivo: 'Falta GOOGLE_PLACES_API_KEY' });
    await setAgentState(AGENT, 'erro');
    throw new Error('Falta GOOGLE_PLACES_API_KEY');
  }

  await log({
    agente: AGENT,
    accao: 'inicio',
    motivo: `${config.prospect.cidades.length} cidades x ${config.prospect.keywords.length} keywords`,
  });

  // 1) Scrape TODAS as combinacoes de uma vez.
  const leads = await scrapeAllWorkshops(
    config.prospect.cidades,
    config.prospect.keywords,
    config.prospect.pais,
    (msg) => console.log(`  [places] ${msg}`),
  );

  await log({ agente: AGENT, accao: 'scrape_completo', motivo: `${leads.length} oficinas unicas encontradas` });

  // 2) Enriquecimento opcional de email (best-effort, so onde ha website e nao ha telefone/email).
  if (opts?.enrichEmails) {
    let enriched = 0;
    for (const l of leads) {
      const email = await findEmailOnWebsite(l.website);
      if (email) { (l as any).email = email; enriched++; }
    }
    await log({ agente: AGENT, accao: 'enrich_emails', motivo: `${enriched} emails encontrados` });
  }

  // 3) Upsert com dedup por google_place_id.
  //    onConflict place_id: nao sobrescreve estado/score de leads ja trabalhadas.
  let novas = 0;
  for (const l of leads) {
    // Verifica se ja existe (por place_id) para contabilizar "novas".
    const { data: existing } = await db
      .from('leads')
      .select('id')
      .eq('google_place_id', l.google_place_id)
      .maybeSingle();

    if (existing) {
      // Atualiza apenas campos factuais (rating, telefone, website) sem tocar no pipeline.
      await db.from('leads').update({
        telefone: l.telefone,
        website: l.website,
        rating: l.rating ?? null,
        total_reviews: l.total_reviews ?? null,
        morada: l.morada,
        cidade: l.cidade,
        google_maps_url: l.google_maps_url,
      }).eq('id', existing.id);
      continue;
    }

    const { error } = await db.from('leads').insert({
      nome_oficina: l.nome_oficina,
      email: (l as any).email ?? null,
      telefone: l.telefone ?? null,
      website: l.website ?? null,
      morada: l.morada ?? null,
      cidade: l.cidade ?? null,
      pais: config.prospect.pais,
      google_place_id: l.google_place_id,
      google_maps_url: l.google_maps_url ?? null,
      rating: l.rating ?? null,
      total_reviews: l.total_reviews ?? null,
      categoria: l.categoria ?? null,
      estado: 'nova',
      fonte: 'google_places',
    });

    if (error) {
      // Conflito no indice nome+cidade (duplicado que o Google devolveu com place_id diferente) — ignora.
      if (!String(error.message).includes('duplicate')) {
        await log({ agente: AGENT, accao: 'insert_erro', resultado: 'erro', motivo: error.message });
      }
    } else {
      novas++;
    }
  }

  await log({ agente: AGENT, accao: 'fim', motivo: `${novas} leads novas gravadas`, resultado: 'ok' });
  await setAgentState(AGENT, 'idle');
  return { encontradas: leads.length, novas };
}
