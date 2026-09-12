// SOURCERER_API_KEY=... node example/demo.mjs
import { ask } from '../src/sourcerer.js';
const passages = [
  { text: 'Sight alignment is the relationship between the rear aperture, the front sight post, and the aiming eye.', source: 'Marksmanship, Ch.7' },
  { text: 'A pace count is the number of paces it takes to walk 100 meters.', source: 'Land Nav, Ch.9' },
];
console.log('Q1:', JSON.stringify(await ask('What is sight alignment?', { passages }), null, 2));
console.log('Q2 (out of scope):', JSON.stringify(await ask('What is the range of a Javelin?', { passages }), null, 2));
