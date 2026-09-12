// Sourcerer — public entry point.
// Ask your documents, get a cited answer or an honest "not in the source," and verify it.
export { ask, normalizeEndpointResponse } from './sourcerer.js';
export { keywordRetriever, embedRetriever } from './retrieve.js';
export { verifyFaithfulness, summarizeFaithfulness } from './verify.js';
