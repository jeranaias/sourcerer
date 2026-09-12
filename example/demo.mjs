// Grounded Q&A over a tiny document set. No key needed for the refusal path;
// set SOURCERER_API_KEY to see a real cited answer.
//   SOURCERER_API_KEY=... node example/demo.mjs
import { ask } from '../src/index.js';

const passages = [
  { text: 'Standard shipping takes 3 to 5 business days within the continental United States.', source: 'Shipping Policy' },
  { text: 'Returns are accepted within 30 days of delivery for a full refund on unused items.', source: 'Returns Policy' },
];

console.log('Q1:', JSON.stringify(await ask('How long does standard shipping take?', { passages }), null, 2));
console.log('Q2 (out of scope):', JSON.stringify(await ask('Do you offer a lifetime warranty?', { passages }), null, 2));
