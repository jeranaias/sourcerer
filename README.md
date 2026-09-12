# 🔮 Sourcerer

**Ask your documents. Get a cited answer — or an honest "not in the source."**

Most doc-chat tools will always answer, even when the documents don't actually say anything. Sourcerer
won't. Every answer comes with the passages it stands on, and when your sources don't support an
answer, it **says so** instead of making one up. Cite, or refuse. That's the magic.

```js
import { ask } from 'sourcerer';

const passages = [
  { text: 'Sight alignment is the relationship between the rear aperture, the front post, and the eye.', source: 'Marksmanship, Ch.7' },
  { text: 'A pace count is the number of paces to walk 100 meters.', source: 'Land Nav, Ch.9' },
];

await ask('What is sight alignment?', { passages });
// → { answer: 'Sight alignment is… [1]', refused: false,
//     citations: [{ label: 'Marksmanship, Ch.7' }] }

await ask('What is the range of a Javelin?', { passages });
// → { answer: "I can't answer that from the provided sources — nothing supports it.",
//     refused: true, reason: 'not_in_sources', citations: [] }
```

## Two ways to ground it

**Bring passages** (zero-infrastructure): hand Sourcerer an array of `{ text, source }` and it
retrieves the relevant ones and answers, cite-or-refuse.

```js
await ask(question, { passages, k: 5 });
```

**Point at a grounding endpoint**: already have a retrieval/verification service? Point Sourcerer at
it and it normalizes the reply into the same shape. It reads a `{ text, citations, abstained }`
response from `POST <endpoint>/api/ask`.

```js
await ask(question, { endpoint: 'http://localhost:7700' });
// or set SOURCERER_GROUNDING_URL
```

## The answer shape

```jsonc
{
  "answer": "…",              // the grounded answer, with [1]-style inline cites
  "refused": false,          // true when the sources don't support an answer
  "reason": null,            // why it refused, when it did
  "citations": [{ "label": "…", "source": "…", "page": null }],
  "via": "passages"          // or "endpoint"
}
```

## Bring your own model

| Variable | Default |
|---|---|
| `SOURCERER_API_KEY` | *(required for the passages path; `OPENROUTER_API_KEY` also accepted)* |
| `SOURCERER_ENDPOINT` | `https://openrouter.ai/api/v1/chat/completions` |
| `SOURCERER_MODEL` | `google/gemini-3-flash-preview` |
| `SOURCERER_GROUNDING_URL` | *(optional external grounding service)* |

## Try it

```bash
npm install sourcerer
export SOURCERER_API_KEY=...
node example/demo.mjs
```

## Why refusal matters

For anything where a wrong answer is worse than no answer — policy, doctrine, medicine, law — a model
that confidently fills gaps is a liability. Sourcerer's refusal is a feature, not a failure: it draws
a hard line at the edge of what your sources actually say.

## License

Apache-2.0.
