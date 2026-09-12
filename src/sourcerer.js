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

async function viaEndpoint(url, question) {
  const res = await fetch(`${url.replace(/\/+$/, '')}/api/ask`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }), signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error('endpoint ' + res.status);
  const d = await res.json();
  return {
    answer: d.text || d.answer || '', refused: !!d.abstained || !!d.refused,
    reason: d.abstain_reason || d.reason || null, score: typeof d.top_rerank_score === 'number' ? d.top_rerank_score : null,
    citations: (d.citations || []).map((c) => ({ label: c.citation || c.label, source: c.pub_id || c.source, page: c.page_printed || c.page })),
    via: 'endpoint',
  };
}

async function viaRetriever(question, retriever, k, history) {
  const top = await retriever(question, k);
  if (!top.length) return { answer: "I can't answer that from the provided sources — nothing supports it.", refused: true, reason: 'not_in_sources', citations: [], via: 'retriever', passages: [] };
  const ctx = top.map((r, i) => `[${i + 1}] ${r.source ? '(' + r.source + ') ' : ''}${r.text}`).join('\n\n');
  const convo = history?.length ? `Conversation so far:\n${history.map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`).join('\n')}\n\n` : '';
  const sys = 'Answer ONLY from the provided passages. Cite passage numbers like [1]. If they do not support an answer, output {"refused":true}. Output JSON only: {"refused":false,"answer":"...","used":[1,2]}';
  const out = await chat(sys, `${convo}Passages:\n${ctx}\n\nQuestion: ${question}`);
  if (out.error || out.refused) return { answer: "I can't answer that from the provided sources.", refused: true, reason: out.error || 'unsupported', citations: [], via: 'retriever', passages: top };
  const used = (out.used || []).map((n) => top[n - 1]).filter(Boolean);
  const cite = used.length ? used : top.slice(0, 2);
  return { answer: out.answer, refused: false, reason: null, citations: cite.map((r) => ({ label: r.source || 'source', source: r.source, page: null })), via: 'retriever', passages: cite };
}

/**
 * Ask a grounded question.
 * @param {string} question
 * @param {{
 *   endpoint?: string,
 *   passages?: (string|{text,source?})[],
 *   retriever?: (q:string,k:number)=>Promise<{text,source,score}[]>,
 *   k?: number,
 *   history?: {role:'user'|'assistant', text:string}[],
 *   verify?: boolean | 'strict'   // check the answer against its sources; 'strict' refuses if unfaithful
 * }} [opts]
 */
export async function ask(question, opts = {}) {
  const endpoint = opts.endpoint || process.env.SOURCERER_GROUNDING_URL;
  let result;
  if (endpoint) { try { result = await viaEndpoint(endpoint, question); } catch { /* fall through */ } }
  if (!result) {
    const retriever = opts.retriever || (opts.passages?.length ? keywordRetriever(opts.passages) : null);
    if (!retriever) return { answer: 'No grounding configured — pass { endpoint }, { passages }, or { retriever }.', refused: true, reason: 'no_grounding', citations: [] };
    result = await viaRetriever(question, retriever, opts.k || 5, opts.history);
  }

  if (opts.verify && !result.refused && result.passages?.length) {
    const check = await verifyFaithfulness(question, result.answer, result.passages);
    result.faithfulness = check;
    if (opts.verify === 'strict' && !check.faithful) {
      return { ...result, answer: "I can't give a fully supported answer from these sources.", refused: true, reason: 'unfaithful', faithfulness: check };
    }
  }
  return result;
}

export { keywordRetriever, embedRetriever } from './retrieve.js';
export { verifyFaithfulness } from './verify.js';
