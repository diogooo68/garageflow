// Integracao Google Places API (New) — Text Search com paginacao completa.
import { config } from '../config.js';

const BASE = 'https://places.googleapis.com/v1/places:searchText';

// Campos que pedimos (FieldMask) — inclui telefone, website, rating.
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.primaryType',
  'places.addressComponents',
  'nextPageToken',
].join(',');

export type PlaceRaw = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  primaryType?: string;
  addressComponents?: Array<{ longText?: string; types?: string[] }>;
};

function extractCity(p: PlaceRaw): string | undefined {
  const comp = p.addressComponents?.find(c =>
    c.types?.some(t => ['locality', 'postal_town', 'administrative_area_level_2'].includes(t)));
  return comp?.longText;
}

// Faz UMA pesquisa de texto e devolve todos os resultados (ate 60 = 3 paginas).
async function searchTextAllPages(query: string, region: string): Promise<PlaceRaw[]> {
  const out: PlaceRaw[] = [];
  let pageToken: string | undefined;
  let page = 0;
  do {
    const body: Record<string, unknown> = {
      textQuery: query,
      regionCode: region,
      languageCode: 'pt',
      pageSize: 20,
    };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': config.google.placesKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Places API ${res.status}: ${txt}`);
    }
    const data = (await res.json()) as { places?: PlaceRaw[]; nextPageToken?: string };
    if (data.places) out.push(...data.places);
    pageToken = data.nextPageToken;
    page++;
    // O nextPageToken pode demorar 1-2s a ficar valido.
    if (pageToken) await new Promise(r => setTimeout(r, 2000));
  } while (pageToken && page < 3);
  return out;
}

export type NormalizedLead = {
  google_place_id: string;
  nome_oficina: string;
  telefone?: string;
  website?: string;
  morada?: string;
  cidade?: string;
  google_maps_url?: string;
  rating?: number;
  total_reviews?: number;
  categoria?: string;
};

// Varre TODAS as combinacoes cidade x keyword e devolve leads normalizadas e dedup por place_id.
export async function scrapeAllWorkshops(
  cidades: string[],
  keywords: string[],
  region: string,
  onProgress?: (msg: string) => void,
): Promise<NormalizedLead[]> {
  const byId = new Map<string, NormalizedLead>();
  for (const cidade of cidades) {
    for (const kw of keywords) {
      const query = `${kw} em ${cidade}, Portugal`;
      try {
        const places = await searchTextAllPages(query, region);
        for (const p of places) {
          if (!p.id || byId.has(p.id)) continue;
          byId.set(p.id, {
            google_place_id: p.id,
            nome_oficina: p.displayName?.text ?? 'Sem nome',
            telefone: p.internationalPhoneNumber || p.nationalPhoneNumber,
            website: p.websiteUri,
            morada: p.formattedAddress,
            cidade: extractCity(p) ?? cidade,
            google_maps_url: p.googleMapsUri,
            rating: p.rating,
            total_reviews: p.userRatingCount,
            categoria: p.primaryType,
          });
        }
        onProgress?.(`"${query}" -> ${places.length} resultados (total unicos: ${byId.size})`);
      } catch (e) {
        onProgress?.(`ERRO em "${query}": ${(e as Error).message}`);
      }
      // Pequeno respiro para nao rebentar rate limits.
      await new Promise(r => setTimeout(r, 300));
    }
  }
  return [...byId.values()];
}
