// Best-effort: tenta encontrar um email publico no website da oficina.
// Nao e obrigatorio; muitas oficinas nao publicam email.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BAD = ['example.com', 'sentry', 'wixpress', '.png', '.jpg', 'godaddy'];

export async function findEmailOnWebsite(website?: string): Promise<string | undefined> {
  if (!website) return undefined;
  const pages = [website, website.replace(/\/$/, '') + '/contactos', website.replace(/\/$/, '') + '/contacto'];
  for (const url of pages) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 GarageFlowBot' } });
      clearTimeout(t);
      if (!res.ok) continue;
      const html = await res.text();
      const found = html.match(EMAIL_RE) ?? [];
      const clean = found.find(e => !BAD.some(b => e.toLowerCase().includes(b)));
      if (clean) return clean.toLowerCase();
    } catch {
      // ignora falhas de rede/timeout
    }
  }
  return undefined;
}
