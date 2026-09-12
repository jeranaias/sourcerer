// Adversarial tests for the hardening pass: cite-or-refuse must be enforced, not merely prompted.
// Every case here fails against the pre-hardening code and passes after it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ask } from '../src/index.js';
import { keywordRetriever } from '../src/retrieve.js';
import { summarizeFaithfulness, verifyFaithfulness } from '../src/verify.js';

const passages = [
  { text: 'Standard shipping takes 3 to 5 business days within the continental United States.', source: 'Shipping Policy' },
  { text: 'Returns are accepted within 30 days of delivery for a full refund on unused items.', source: 'Returns Policy' },
];

// Mock model call: routes by system prompt so one function drives both answering and verification.
function mockChat({ answer, used, refused, claims, unsupported } = {}) {
  return async (system) => {
    if (/fact-checker/i.test(system)) return { claims: claims || [], unsupported };
    return { refused: !!refused, answer, used };
  };
}

test('fabricated citation: empty used[] is refused, never back-filled with top passages', async () => {
  const chat = mockChat({ answer: 'Standard shipping takes 3 to 5 business days. [1]', used: [] });
  const res = await ask('How long does standard shipping take?', { passages, chat });
  assert.equal(res.refused, true);
  assert.equal(res.reason, 'no_citation');
  assert.deepEqual(res.citations, []);
});

test('fabricated citation: an out-of-range used index is refused, not filtered away', async () => {
  const chat = mockChat({ answer: 'It ships fast. [9]', used: [9] });
  const res = await ask('How long does standard shipping take?', { passages, chat });
  assert.equal(res.refused, true);
  assert.equal(res.reason, 'no_citation');
});

test('missing inline [n] marker is refused even when used[] is valid', async () => {
  const chat = mockChat({ answer: 'Standard shipping takes 3 to 5 business days.', used: [1] });
  const res = await ask('How long does standard shipping take?', { passages, chat });
  assert.equal(res.refused, true);
  assert.equal(res.reason, 'no_citation');
});

test('a properly cited answer is accepted and carries real citations', async () => {
  const chat = mockChat({ answer: 'Standard shipping takes 3 to 5 business days. [1]', used: [1] });
  const res = await ask('How long does standard shipping take?', { passages, chat });
  assert.equal(res.refused, false);
  assert.equal(res.citations.length, 1);
  assert.equal(res.citations[0].source, 'Shipping Policy');
});

test('summarizeFaithfulness([]) cannot verify → not faithful (fail closed)', () => {
  const s = summarizeFaithfulness([]);
  assert.equal(s.faithful, false);
  assert.equal(s.score, 0);
});

test('verifyFaithfulness reports unfaithful when a claim is unsupported (injected chat)', async () => {
  const chat = mockChat({ claims: [{ claim: 'ships in 2 hours', supported: false }] });
  const r = await verifyFaithfulness('q', 'It ships in 2 hours.', ['shipping takes 3 to 5 days'], chat);
  assert.equal(r.faithful, false);
  assert.deepEqual(r.unsupported, ['ships in 2 hours']);
});

test("strict verify turns an unfaithful answer into a refusal", async () => {
  const chat = mockChat({
    answer: 'Standard shipping takes 2 hours. [1]', used: [1],
    claims: [{ claim: 'ships in 2 hours', supported: false }], unsupported: ['ships in 2 hours'],
  });
  const res = await ask('How long does standard shipping take?', { passages, chat, verify: 'strict' });
  assert.equal(res.refused, true);
  assert.equal(res.reason, 'unfaithful');
  assert.equal(res.faithfulness.faithful, false);
});

test('unicode retrieval: Arabic and accented Latin survive tokenization', async () => {
  const docs = [
    { text: 'الشحن القياسي يستغرق من ثلاثة إلى خمسة أيام عمل.', source: 'شحن' },
    { text: 'Le café est préparé fraîchement chaque matin.', source: 'café' },
  ];
  const r = keywordRetriever(docs);
  const ar = await r('كم يستغرق الشحن القياسي', 5);
  assert.equal(ar[0].source, 'شحن');
  assert.ok(ar[0].score > 0);
  const fr = await r('préparé café', 5);
  assert.equal(fr[0].source, 'café');
  assert.ok(fr[0].score > 0);
});

test('minScore floor refuses a weak single-word match', async () => {
  // Only "standard" overlaps out of six query tokens → 1/6 ≈ 0.17, below the 0.2 default floor.
  const chat = mockChat({ answer: 'x [1]', used: [1] });
  const res = await ask('standard aardvark zebra quantum lagrangian entropy', { passages, chat });
  assert.equal(res.refused, true);
  assert.equal(res.reason, 'below_threshold');
});

test('minScore is configurable and refuses when raised above the top score', async () => {
  const chat = mockChat({ answer: 'Standard shipping takes 3 to 5 business days. [1]', used: [1] });
  const strict = await ask('standard shipping', { passages, chat, minScore: 1.1 });
  assert.equal(strict.refused, true);
  assert.equal(strict.reason, 'below_threshold');
  // The same query clears the default floor.
  const ok = await ask('standard shipping', { passages, chat });
  assert.equal(ok.refused, false);
});

test('k is validated: 0, negative, and non-numbers are rejected', async () => {
  assert.equal((await ask('q', { passages, k: 0 })).reason, 'bad_k');
  assert.equal((await ask('q', { passages, k: -3 })).reason, 'bad_k');
  assert.equal((await ask('q', { passages, k: 'five' })).reason, 'bad_k');
  assert.equal((await ask('q', { passages, k: 2.5 })).reason, 'bad_k');
});

test('verify on the endpoint path fails loud instead of silently skipping', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ text: 'An answer from the service.', citations: [{ citation: 'C1', pub_id: 'p1' }], abstained: false }),
  });
  try {
    // Without verify, the endpoint answer flows through normally.
    const plain = await ask('anything', { endpoint: 'http://localhost:7700' });
    assert.equal(plain.via, 'endpoint');
    assert.equal(plain.refused, false);
    // With verify, there is no passage text to check against → throw, don't pretend it was verified.
    await assert.rejects(
      () => ask('anything', { endpoint: 'http://localhost:7700', verify: true }),
      /verify is not supported on the endpoint/,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
