import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEndpointResponse } from '../src/sourcerer.js';
import { summarizeFaithfulness } from '../src/verify.js';

test('normalizeEndpointResponse maps a rich service body', () => {
  const out = normalizeEndpointResponse({
    text: 'The answer.',
    abstained: false,
    top_rerank_score: 0.87,
    citations: [{ citation: 'Handbook §2', pub_id: 'handbook', page_printed: 12 }],
  });
  assert.equal(out.answer, 'The answer.');
  assert.equal(out.refused, false);
  assert.equal(out.reason, null);
  assert.equal(out.score, 0.87);
  assert.deepEqual(out.citations, [{ label: 'Handbook §2', source: 'handbook', page: 12 }]);
  assert.equal(out.via, 'endpoint');
});

test('normalizeEndpointResponse accepts the alternate field spellings', () => {
  const out = normalizeEndpointResponse({
    answer: 'Alt.',
    refused: true,
    reason: 'not_in_sources',
    citations: [{ label: 'L', source: 's', page: 3 }],
  });
  assert.equal(out.answer, 'Alt.');
  assert.equal(out.refused, true);
  assert.equal(out.reason, 'not_in_sources');
  assert.deepEqual(out.citations, [{ label: 'L', source: 's', page: 3 }]);
});

test('normalizeEndpointResponse fills stable defaults for an empty body', () => {
  const out = normalizeEndpointResponse();
  assert.deepEqual(out, { answer: '', refused: false, reason: null, score: null, citations: [], via: 'endpoint' });
});

test('summarizeFaithfulness scores per-claim verdicts', () => {
  const s = summarizeFaithfulness([
    { claim: 'a', supported: true },
    { claim: 'b', supported: false },
  ]);
  assert.equal(s.faithful, false);
  assert.deepEqual(s.unsupported, ['b']);
  assert.equal(s.score, 0.5);
});

test('summarizeFaithfulness is faithful when every claim is supported', () => {
  const s = summarizeFaithfulness([{ claim: 'a', supported: true }, { claim: 'b', supported: true }]);
  assert.equal(s.faithful, true);
  assert.equal(s.score, 1);
});

test('summarizeFaithfulness honors an explicit empty unsupported list', () => {
  const s = summarizeFaithfulness([], []);
  assert.deepEqual(s, { faithful: true, unsupported: [], score: 1 });
});
