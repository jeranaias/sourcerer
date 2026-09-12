import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordRetriever } from '../src/retrieve.js';
import { ask } from '../src/index.js';

const passages = [
  { text: 'Standard shipping takes 3 to 5 business days within the continental United States.', source: 'Shipping Policy' },
  { text: 'Returns are accepted within 30 days of delivery for a full refund on unused items.', source: 'Returns Policy' },
];

test('keyword retriever ranks the relevant passage first', async () => {
  const r = keywordRetriever(passages);
  const top = await r('what is the standard shipping time', 2);
  assert.equal(top[0].source, 'Shipping Policy');
  assert.ok(top[0].score > 0);
});

test('keyword retriever returns nothing for out-of-scope queries', async () => {
  const r = keywordRetriever(passages);
  const top = await r('quantum chromodynamics lagrangian', 5);
  assert.equal(top.length, 0);
});

test('keyword retriever respects k and drops non-matching passages', async () => {
  const r = keywordRetriever(passages);
  const top = await r('shipping and returns', 1);
  assert.equal(top.length, 1); // k caps the result even when both would match
});

test('keyword retriever accepts bare strings and the cite alias', async () => {
  const r = keywordRetriever(['plain string about refunds and returns', { text: 'about shipping', cite: 'Doc' }]);
  const top = await r('returns', 5);
  assert.equal(top[0].text, 'plain string about refunds and returns');
  assert.equal(top[0].source, ''); // strings carry no source
  const t2 = await keywordRetriever([{ text: 'about shipping', cite: 'Doc' }])('shipping', 5);
  assert.equal(t2[0].source, 'Doc'); // `cite` is honored as a source alias
});

test('keyword retriever ignores an all-stopword query', async () => {
  const r = keywordRetriever(passages);
  assert.deepEqual(await r('the of to and or', 5), []);
});

test('keyword retriever validates its input', () => {
  assert.throws(() => keywordRetriever('not an array'), TypeError);
});

test('ask refuses (no API call) when nothing is retrieved', async () => {
  const res = await ask('what is the boiling point of mercury', { passages });
  assert.equal(res.refused, true);
  assert.equal(res.reason, 'not_in_sources');
  assert.deepEqual(res.citations, []);
});

test('ask reports missing grounding config', async () => {
  const res = await ask('anything', {});
  assert.equal(res.refused, true);
  assert.equal(res.reason, 'no_grounding');
});

test('ask rejects an empty or non-string question', async () => {
  assert.equal((await ask('', { passages })).reason, 'no_question');
  assert.equal((await ask('   ', { passages })).reason, 'no_question');
  assert.equal((await ask(null, { passages })).reason, 'no_question');
});
