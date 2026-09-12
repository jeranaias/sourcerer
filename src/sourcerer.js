// Sourcerer — ask your documents, get a cited answer or an honest "not in the source".
// Ground it three ways: a grounding endpoint, an array of passages, or your own retriever.
// Optionally verify every answer against its own sources before you trust it.
import { keywordRetriever } from './retrieve.js';
import { verifyFaithfulness } from './verify.js';

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

/**
 * Normalize a grounding-service JSON body into Sourcerer's answer shape. Pure and side-effect free,
 * so it accepts the several field spellings a service might use (`text`/`answer`, `abstained`/`refused`,
 * `pub_id`/`source`, and so on) and always returns a stable, fully-populated object.
 * @param {Record<string, any>} [d]
 * @returns {{answer:string, refused:boolean, reason:(string|null), score:(number|null), citations:{label:any,source:any,page:any}[], via:'endpoint'}}
 */
export function normalizeEndpointResponse(d = {}) {
  return {
    answer: d.text || d.answer || '',
    refused: !!d.abstained || !!d.refused,
    reason: d.abstain_reason || d.reason || null,
    score: typeof d.top_rerank_score === 'number' ? d.top_rerank_score : null,
    citations: (d.citations || []).map((c) => ({ label: c.citation ?? c.label ?? null, source: c.pub_id ?? c.source ?? null, page: c.page_printed ?? c.page ?? null })),
    via: 'endpoint',
  };
}

async function viaEndpoint(url, question) {
  const res = await fetch(`${url.replace(/\/+$/, '')}/api/ask`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }), signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error('endpoint ' + res.status);
  return normalizeEndpointResponse(await res.json());
}

async function viaRetriever(question, retriever, k, history, minScore, chatFn) {
  const top = await retriever(question, k);
  if (!top.length) return { answer: "I can't answer that from the provided sources — nothing supports it.", refused: true, reason: 'not_in_sources', citations: [], via: 'retriever', passages: [] };
  // Retrieval floor: a best match weaker than minScore is noise (e.g. a single common word), not grounding.
  const topScore = typeof top[0].score === 'number' ? top[0].score : 0;
  if (topScore < minScore) return { answer: "I can't answer that from the provided sources — the closest match is too weak to trust.", refused: true, reason: 'below_threshold', score: topScore, citations: [], via: 'retriever', passages: [] };
  const ctx = top.map((r, i) => `[${i + 1}] ${r.source ? '(' + r.source + ') ' : ''}${r.text}`).join('\n\n');
  const convo = history?.length ? `Conversation so far:\n${history.map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`).join('\n')}\n\n` : '';
  const sys = 'Answer ONLY from the provided passages. Cite the passages you use inline like [1] AND list their numbers in "used". If they do not support an answer, output {"refused":true}. Output JSON only: {"refused":false,"answer":"...","used":[1,2]}';
  const out = await chatFn(sys, `${convo}Passages:\n${ctx}\n\nQuestion: ${question}`);
  if (out.error || out.refused) return { answer: "I can't answer that from the provided sources.", refused: true, reason: out.error || 'unsupported', citations: [], via: 'retriever', passages: top };
  // Cite-or-refuse, enforced: the model must name the passages it used, every index must be a real
  // retrieved passage, and the answer must actually carry an inline [n] marker into that set. We never
  // synthesize citations for an answer the model failed to ground — that would be a fabricated cite.
  const inRange = (n) => Number.isInteger(n) && n >= 1 && n <= top.length;
  const used = out.used;
  if (!Array.isArray(used) || used.length === 0 || !used.every(inRange)) {
    return { answer: "I can't give a cited answer from these sources.", refused: true, reason: 'no_citation', citations: [], via: 'retriever', passages: top };
  }
  const markers = [...String(out.answer || '').matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  if (!markers.some(inRange)) {
    return { answer: "I can't give a cited answer from these sources.", refused: true, reason: 'no_citation', citations: [], via: 'retriever', passages: top };
  }
  const cited = used.map((n) => top[n - 1]);
  return { answer: out.answer, refused: false, reason: null, citations: cited.map((r) => ({ label: r.source || 'source', source: r.source, page: null })), via: 'retriever', passages: cited };
}

/**
 * Ask a grounded question.
 * @param {string} question
 * @param {{
 *   endpoint?: string,
 *   passages?: (string|{text,source?})[],
 *   retriever?: (q:string,k:number)=>Promise<{text,source,score}[]>,
 *   k?: number,
 *   minScore?: number,           // retrieval floor (default 0.2); refuse when the top score is below it
 *   history?: {role:'user'|'assistant', text:string}[],
 *   chat?: (system:string, user:string)=>Promise<Record<string,any>>,  // injectable model call, for tests
 *   verify?: boolean | 'strict'   // check the answer against its sources; 'strict' refuses if unfaithful
 * }} [opts]
 */
export async function ask(question, opts = {}) {
  if (typeof question !== 'string' || !question.trim()) {
    return { answer: 'Ask a non-empty question (string).', refused: true, reason: 'no_question', citations: [] };
  }
  if (opts.k !== undefined && (typeof opts.k !== 'number' || !Number.isInteger(opts.k) || opts.k < 1)) {
    return { answer: 'k must be a positive integer.', refused: true, reason: 'bad_k', citations: [] };
  }
  const minScore = typeof opts.minScore === 'number' ? opts.minScore : 0.2;
  const chatFn = opts.chat || chat;
  const endpoint = opts.endpoint || process.env.SOURCERER_GROUNDING_URL;
  let result;
  if (endpoint) { try { result = await viaEndpoint(endpoint, question); } catch { /* fall through */ } }
  if (!result) {
    const retriever = opts.retriever || (opts.passages?.length ? keywordRetriever(opts.passages) : null);
    if (!retriever) return { answer: 'No grounding configured — pass { endpoint }, { passages }, or { retriever }.', refused: true, reason: 'no_grounding', citations: [] };
    result = await viaRetriever(question, retriever, opts.k || 5, opts.history, minScore, chatFn);
  }

  if (opts.verify && !result.refused) {
    // Enforce, don't silently skip: the endpoint path returns citations without passage text, so there is
    // nothing to verify the answer against. Refuse to pretend it was checked — fail loud instead.
    if (result.via === 'endpoint' || !result.passages?.length) {
      throw new Error('verify is not supported on the endpoint grounding path: the service returns citations without passage text to check against. Ground with { passages } or { retriever }, or drop verify.');
    }
    const check = await verifyFaithfulness(question, result.answer, result.passages, chatFn);
    result.faithfulness = check;
    if (opts.verify === 'strict' && !check.faithful) {
      return { ...result, answer: "I can't give a fully supported answer from these sources.", refused: true, reason: 'unfaithful', faithfulness: check };
    }
  }
  return result;
}

export { keywordRetriever, embedRetriever } from './retrieve.js';
export { verifyFaithfulness } from './verify.js';
