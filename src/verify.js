// Faithfulness verification — the guard that turns "cite-or-refuse" from a prompt instruction into a
// checked property. After an answer is produced, verifyFaithfulness asks whether each claim in it is
// actually entailed by the retrieved passages, and returns the ones that aren't.
const ENDPOINT = process.env.SOURCERER_ENDPOINT || 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.SOURCERER_MODEL || 'google/gemini-3-flash-preview';

async function chat(system, user, timeoutMs = 45000) {
  const KEY = process.env.SOURCERER_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!KEY) return { error: 'set SOURCERER_API_KEY' };
  try {
    const res = await fetch(ENDPOINT, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const t = (await res.json()).choices?.[0]?.message?.content ?? '';
    const m = t.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} }
    try { return JSON.parse(t); } catch {}
    return { error: 'no-json' };
  } catch (e) { return { error: e?.name === 'AbortError' ? 'timeout' : String(e) }; }
}

/**
 * Reduce a fact-checker's per-claim verdicts into a faithfulness summary. Pure and side-effect free.
 * @param {{claim?:string, supported?:boolean}[]} [claims]
 * @param {string[]} [unsupportedInput] - explicit list of unsupported claims, if the checker provided one
 * @returns {{ faithful: boolean, unsupported: string[], score: number }}
 */
export function summarizeFaithfulness(claims = [], unsupportedInput) {
  const hasExplicit = Array.isArray(unsupportedInput);
  const unsupported = hasExplicit
    ? unsupportedInput
    : claims.filter((c) => !c.supported).map((c) => c.claim);
  // Fail closed: with no claims to check and no explicit verdict list, verification could not run —
  // that is "cannot verify," not "verified faithful." Never report unchecked answers as faithful.
  if (!claims.length && !hasExplicit) {
    return { faithful: false, unsupported: [], score: 0 };
  }
  const score = claims.length
    ? claims.filter((c) => c.supported).length / claims.length
    : (unsupported.length ? 0 : 1);
  return { faithful: unsupported.length === 0, unsupported, score: Math.round(score * 100) / 100 };
}

/**
 * Check whether an answer is supported by the passages it was drawn from.
 * @param {string} question
 * @param {string} answer
 * @param {(string|{text:string})[]} passages
 * @param {(system:string, user:string)=>Promise<Record<string,any>>} [chatFn] - injectable model call, for tests
 * @returns {Promise<{ faithful: boolean, unsupported: string[], score: number, error?: string }>}
 */
export async function verifyFaithfulness(question, answer, passages, chatFn = chat) {
  if (!answer || !passages?.length) return { faithful: false, unsupported: [], score: 0 };
  const ctx = passages.map((p, i) => `[${i + 1}] ${typeof p === 'string' ? p : p.text}`).join('\n\n');
  const sys = 'You are a strict fact-checker. Break the ANSWER into its individual factual claims and, using ONLY the passages, mark each as supported or not. Do not use outside knowledge. Output JSON only: {"claims":[{"claim":"...","supported":true}],"unsupported":["..."]}';
  const r = await chatFn(sys, `Passages:\n${ctx}\n\nQuestion: ${question}\nAnswer: "${answer}"\n\nCheck it.`);
  if (r.error) return { faithful: false, unsupported: [], score: 0, error: r.error };
  return summarizeFaithfulness(r.claims || [], r.unsupported);
}
