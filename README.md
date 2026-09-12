# 🔮 Sourcerer

[![CI](https://github.com/jeranaias/sourcerer/actions/workflows/ci.yml/badge.svg)](https://github.com/jeranaias/sourcerer/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Ask your documents. Get a cited answer — or an honest "not in the source." And *verify* it.**

Most doc-chat tools always answer, even when the documents don't say anything, and ask you to trust
that the citations are real. Sourcerer does two things they don't: it **refuses** when the sources
don't support an answer, and it can **check its own answer against those sources** before you trust it.

```js
import { ask } from 'sourcerer';

const passages = [
  { text: 'Standard shipping takes 3 to 5 business days within the continental United States.', source: 'Shipping Policy' },
  { text: 'Returns are accepted within 30 days of delivery for a full refund on unused items.', source: 'Returns Policy' },
];

await ask('How long does standard shipping take?', { passages });
// → { answer: 'Standard shipping takes 3 to 5 business days… [1]', refused: false, citations: [{ label: 'Shipping Policy' }] }

await ask('Do you offer a lifetime warranty?', { passages });
// → { answer: "I can't answer that from the provided sources — nothing supports it.",
//     refused: true, reason: 'not_in_sources' }
```

## Verify, don't trust

`cite-or-refuse` is a prompt instruction until something checks it. Turn on verification and Sourcerer
breaks its own answer into claims and confirms each is actually supported by the retrieved passages:

```js
const res = await ask('How long does standard shipping take?', { passages, verify: true });
res.faithfulness; // → { faithful: true, unsupported: [], score: 1 }

// 'strict' turns an unfaithful answer into a refusal automatically
await ask(question, { passages, verify: 'strict' });
```

Verification checks the answer against the passage **text** it was drawn from, so it needs
`{ passages }` or `{ retriever }`. A grounding `{ endpoint }` returns citations without passage
text, so `verify` on that path throws rather than silently pretending the answer was checked.

## Three ways to ground it

**Passages** (zero-infrastructure) — hand it `{ text, source }[]` and it retrieves + answers:

```js
await ask(question, { passages, k: 5, minScore: 0.2 });
```

`k` must be a positive integer. `minScore` (default `0.2`) is a retrieval floor: if the best passage
scores below it, Sourcerer refuses (`reason: 'below_threshold'`) rather than answer off a single
common-word overlap. And a cited answer is enforced, not requested — the model must both list the
passages it used and carry a matching inline `[n]` marker, or the answer is refused
(`reason: 'no_citation'`). Citations are never fabricated from the top passages.

**Your own retriever** — anything `async (question, k) => [{ text, source, score }]`:

```js
await ask(question, { retriever: myVectorSearch });
```

**A grounding endpoint** — point at an existing retrieval/verification service that returns
`{ text, citations, abstained }`:

```js
await ask(question, { endpoint: 'http://localhost:7700' });   // or SOURCERER_GROUNDING_URL
```

## Retrieval: keyword *or* semantic

Ships with a zero-dependency keyword retriever (the default) and a semantic one backed by any
OpenAI-compatible `/embeddings` endpoint — embeddings are computed once and cached, and it falls back
to keyword if embeddings are unavailable. The keyword tokenizer is Unicode-aware, so Arabic, CJK, and
accented-Latin sources retrieve correctly:

```js
import { embedRetriever } from 'sourcerer';
const retriever = embedRetriever({ passages, model: 'text-embedding-3-small' });
await ask(question, { retriever });
```

## Multi-turn

Pass prior turns and follow-ups stay grounded:

```js
const history = [
  { role: 'user', text: 'How long does standard shipping take?' },
  { role: 'assistant', text: 'Standard shipping takes 3 to 5 business days. [1]' },
];
await ask('And what about returns?', { passages, history });
```

## The answer shape

```jsonc
{
  "answer": "…",             // grounded answer with [1]-style inline cites
  "refused": false,          // true when the sources don't support an answer
  "reason": null,
  "citations": [{ "label": "…", "source": "…" }],
  "faithfulness": { "faithful": true, "unsupported": [], "score": 1 },  // when verify is on
  "via": "retriever"
}
```

`reason` names why an answer was refused: `not_in_sources` (nothing retrieved), `below_threshold`
(top match under `minScore`), `no_citation` (the model gave no valid, in-range, inline-marked
citation), `unsupported` (the model declined), `unfaithful` (failed strict verification),
`no_question`, `bad_k`, or `no_grounding`.

## Install & test

```bash
npm install sourcerer
export SOURCERER_API_KEY=...   # any OpenAI-compatible key (OpenRouter by default)
node example/demo.mjs
npm test                       # retrieval + refusal logic is unit-tested (no key needed)
```

| Variable | Default |
|---|---|
| `SOURCERER_API_KEY` | *(`OPENROUTER_API_KEY` also accepted)* |
| `SOURCERER_ENDPOINT` | `https://openrouter.ai/api/v1/chat/completions` |
| `SOURCERER_MODEL` | `google/gemini-3-flash-preview` |
| `SOURCERER_EMBED_ENDPOINT` / `SOURCERER_EMBED_MODEL` | for `embedRetriever` |
| `SOURCERER_GROUNDING_URL` | optional external grounding service |

## Why refusal + verification

For anything where a wrong answer is worse than no answer — policy, doctrine, medicine, law — a model
that confidently fills gaps is a liability. Sourcerer draws a hard line at the edge of what your
sources say, and gives you the receipts to prove it stayed inside it.

## License

Apache-2.0.
