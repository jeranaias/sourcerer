// Sourcerer — ask your documents, get a cited answer or an honest "not in the source".
// Two ways to ground it:
//   1) point it at a grounding endpoint that returns { text, citations, abstained }
//   2) hand it an array of passages and it will retrieve + answer, cite-or-refuse, itself
// Model calls go to any OpenAI-compatible chat endpoint (OpenRouter by default).
const ENDPOINT = process.env.SOURCERER_ENDPOINT || 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.SOURCERER_MODEL || 'google/gemini-3-flash-preview';

async function chat(system, user, timeoutMs = 45000) {
  const KEY = process.env.SOURCERER_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!KEY) return { error: 'set SOURCERER_API_KEY (or OPENROUTER_API_KEY)' };
  try {
    const res = await fetch(ENDPOINT, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, temperature: 0.1, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const t = (await res.json()).choices?.[0]?.message?.content ?? '';
    try { return JSON.parse(t); } catch {}
    const m = t.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} }
    return { error: 'no-json' };
  } catch (e) { return { error: e?.name === 'AbortError' ? 'timeout' : String(e) }; }
}

// call an external grounding service and normalize its reply
async function viaEndpoint(url, question) {
  const res = await fetch(`${url.replace(/\/+$/, '')}/api/ask`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }), signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error('endpoint ' + res.status);
  const d = await res.json();
  return {
    answer: d.text || d.answer || '',
    refused: !!d.abstained || !!d.refused,
    reason: d.abstain_reason || d.reason || null,
    score: typeof d.top_rerank_score === 'number' ? d.top_rerank_score : null,
    citations: (d.citations || []).map((c) => ({ label: c.citation || c.label, source: c.pub_id || c.source, page: c.page_printed || c.page })),
    via: 'endpoint',
  };
}

// simple keyword ranking so the local path has zero heavy dependencies
function rank(question, passages, k) {
  const terms = new Set(question.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
  return passages
    .map((p) => { const text = typeof p === 'string' ? p : p.text; const src = typeof p === 'string' ? '' : (p.source || p.cite || ''); const words = text.toLowerCase(); let s = 0; terms.forEach((t) => { if (words.includes(t)) s++; }); return { text, source: src, score: s }; })
    .filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}

async function viaPassages(question, passages, k) {
  const top = rank(question, passages, k);
  if (!top.length) return { answer: "I can't answer that from the provided sources — nothing supports it.", refused: true, reason: 'not_in_sources', citations: [], via: 'passages' };
  const ctx = top.map((r, i) => `[${i + 1}] ${r.source ? '(' + r.source + ') ' : ''}${r.text}`).join('\n\n');
  const sys = 'Answer ONLY from the provided passages. Cite passage numbers like [1]. If they do not support an answer, output {"refused":true}. Output JSON only: {"refused":false,"answer":"...","used":[1,2]}';
  const out = await chat(sys, `Passages:\n${ctx}\n\nQuestion: ${question}`);
  if (out.error || out.refused) return { answer: "I can't answer that from the provided sources.", refused: true, reason: out.error || 'unsupported', citations: [], via: 'passages' };
  const used = (out.used || []).map((n) => top[n - 1]).filter(Boolean);
  const cite = used.length ? used : top.slice(0, 2);
  return { answer: out.answer, refused: false, reason: null, citations: cite.map((r) => ({ label: r.source || 'source', source: r.source, page: null })), via: 'passages' };
}

/**
 * Ask a grounded question.
 * @param {string} question
 * @param {{ endpoint?: string, passages?: (string|{text,source?})[], k?: number }} opts
 */
export async function ask(question, opts = {}) {
  const endpoint = opts.endpoint || process.env.SOURCERER_GROUNDING_URL;
  if (endpoint) { try { return await viaEndpoint(endpoint, question); } catch { /* fall through if passages given */ } }
  if (opts.passages?.length) return viaPassages(question, opts.passages, opts.k || 5);
  return { answer: 'No grounding configured — pass { endpoint } or { passages }.', refused: true, reason: 'no_grounding', citations: [] };
}
