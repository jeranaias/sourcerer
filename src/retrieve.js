// Retrievers turn (question, passages) into the top-k most relevant passages. Sourcerer ships two,
// and you can pass your own — any `async (question, k) => [{ text, source, score }]` works.

const STOP = new Set('a an the of to and or in on for with by is are be as at from that this it its'.split(' '));
// Unicode-aware: keep letters/numbers of any script (Arabic, CJK, accented Latin), strip the rest.
// Short ASCII noise is dropped, but non-ASCII tokens (where a single glyph can carry meaning) are kept.
const tokens = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/)
  .filter((w) => (w.length > 2 || /\P{ASCII}/u.test(w)) && !STOP.has(w));

const asPassage = (p) => (typeof p === 'string' ? { text: p, source: '' } : { text: p.text, source: p.source || p.cite || '' });

/**
 * Zero-dependency keyword-overlap retriever. Good default; no model calls.
 * @param {(string|{text:string, source?:string, cite?:string})[]} passages
 * @returns {(question:string, k?:number)=>Promise<{text:string, source:string, score:number}[]>}
 */
export function keywordRetriever(passages) {
  if (!Array.isArray(passages)) throw new TypeError('keywordRetriever(passages): passages must be an array');
  const docs = passages.map(asPassage);
  return async (question, k = 5) => {
    const q = new Set(tokens(question));
    return docs
      .map((d) => { const t = new Set(tokens(d.text)); let s = 0; q.forEach((w) => { if (t.has(w)) s++; }); return { ...d, score: q.size ? s / q.size : 0 }; })
      .filter((d) => d.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  };
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/**
 * Semantic retriever backed by any OpenAI-compatible /embeddings endpoint. Embeddings for the
 * passages are computed once and cached. Falls back to keyword ranking if embeddings are unavailable.
 * @param {{passages:(string|{text:string, source?:string})[], endpoint?:string, model?:string, apiKey?:string}} opts
 * @returns {(question:string, k?:number)=>Promise<{text:string, source:string, score:number}[]>}
 */
export function embedRetriever({ passages, endpoint, model, apiKey } = {}) {
  if (!Array.isArray(passages)) throw new TypeError('embedRetriever({ passages }): passages must be an array');
  const docs = passages.map(asPassage);
  const url = endpoint || process.env.SOURCERER_EMBED_ENDPOINT || 'https://api.openai.com/v1/embeddings';
  const mdl = model || process.env.SOURCERER_EMBED_MODEL || 'text-embedding-3-small';
  const key = apiKey || process.env.SOURCERER_EMBED_KEY || process.env.SOURCERER_API_KEY || process.env.OPENROUTER_API_KEY;
  let cache = null;
  const embed = async (input) => {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: mdl, input }), signal: AbortSignal.timeout(45000) });
    if (!res.ok) throw new Error('embeddings ' + res.status);
    return (await res.json()).data.map((d) => d.embedding);
  };
  const fallback = keywordRetriever(passages);
  return async (question, k = 5) => {
    try {
      if (!cache) cache = await embed(docs.map((d) => d.text));
      const [qv] = await embed([question]);
      return docs.map((d, i) => ({ ...d, score: cosine(qv, cache[i]) })).sort((a, b) => b.score - a.score).slice(0, k);
    } catch { return fallback(question, k); }
  };
}
