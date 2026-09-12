import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordRetriever } from '../src/retrieve.js';
import { ask } from '../src/sourcerer.js';

const passages = [
  { text: 'Sight alignment is the relationship between the rear aperture, the front sight post, and the aiming eye.', source: 'Marksmanship, Ch.7' },
  { text: 'A pace count is the number of paces it takes to walk 100 meters.', source: 'Land Nav, Ch.9' },
];

test('keyword retriever ranks the relevant passage first', async () => {
  const r = keywordRetriever(passages);
  const top = await r('what is sight alignment', 2);
  assert.equal(top[0].source, 'Marksmanship, Ch.7');
  assert.ok(top[0].score > 0);
});

test('keyword retriever returns nothing for out-of-scope queries', async () => {
  const r = keywordRetriever(passages);
  const top = await r('quantum chromodynamics lagrangian', 5);
  assert.equal(top.length, 0);
});

test('ask refuses (no API call) when nothing is retrieved', async () => {
  const res = await ask('what is the airspeed of an unladen swallow', { passages });
  assert.equal(res.refused, true);
  assert.equal(res.reason, 'not_in_sources');
  assert.deepEqual(res.citations, []);
});

test('ask reports missing grounding config', async () => {
  const res = await ask('anything', {});
  assert.equal(res.refused, true);
  assert.equal(res.reason, 'no_grounding');
});
