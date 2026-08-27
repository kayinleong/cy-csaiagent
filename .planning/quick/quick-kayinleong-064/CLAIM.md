# Claim: quick-kayinleong-064
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: done
- summary: no Finder tab and no way to re-pillar — Coach has 1 doc of 1069 so every coach question kb_misses

## What will change

User: "/en/kb there is a lot of documents in reply section, but nothing on coach/finder. add
2 buttons that convert reply docs to coach/finder. also when asking question in coach chat
page, it always say cannot find the kb docs even the docs is in kb".

**Correcting the premise first — measured on live Firestore:**

| pillar | kbDocs | kbChunks |
|---|---|---|
| finder | **1068** | **25153** |
| coach | 1 | 10 |
| reply | **0** | **0** |

Nothing is tagged `reply`. Everything is `finder`. What is actually happening on that page:
the pillar tabs are **All / Coach / Reply with NO Finder tab** (a deliberate ADMIN-05 choice
when Finder inventory was not managed here), so the 1068 Finder docs are only visible under
"All" — which reads as "the documents are in some other section".

The Coach kb_miss is real and is the same fact: Coach retrieval filters `pillar == 'coach'`
and there are 10 chunks in the whole corpus.

Planned:
1. Add the missing **Finder** tab.
2. Row selection + a bulk **Move to pillar** action, so Derek chooses WHICH docs become
   Coach rather than me guessing for 1068 of them.
3. The action must update the denormalized `kbChunks.pillar` too — retrieval filters on the
   CHUNK, so moving only the doc would change the label and fix nothing.
4. Bounded per call + client-driven loop, the same shape as ingestion. 1068 docs x ~24
   chunks in one request is the timeout trap this codebase already has a pattern for.

## What has changed

**`src/kb/crud.ts` — `repillarDocs(user, docIds, pillar)`**
Moves documents to a different pillar AND re-tags their `kbChunks`. The chunk update is the
whole point: every retrieval path filters `findNearest` on `kbChunks.pillar`, so moving only
the kbDocs row would relabel the admin table and change nothing an agent can retrieve —
which is worse than not shipping the button, because it looks fixed and is not.

Bounded to `REPILLAR_DOC_LIMIT = 5` documents per call, returning the ids it did not reach.
Five documents is ~120 chunk writes; the corpus is ~25k chunks and one request cannot
rewrite them. Deliberately not transactional across documents: a failure leaves what already
moved moved, which is honest and safe to re-run, since moving a doc to the pillar it is
already in is a no-op. A doc deleted between page render and click is skipped, not fatal
(the quick-060 lesson).

**`app/[lang]/(admin)/kb/actions.ts`** — `repillarKbDocsAction`, same admin gate as the
other KB actions.

**`app/[lang]/(admin)/kb/kb-doc-list.tsx`**
- The missing **Finder** tab. ADMIN-05 originally shipped All / Coach / Reply on the
  reasoning that Finder inventory was not managed here; 1068 of 1069 documents are Finder,
  so that made the entire KB reachable only under "All".
- A checkbox column, select-all-on-this-page, and a bulk bar that appears only when
  something is selected. Selection is by id and accumulates across pages.
- The client loops `repillarKbDocsAction` until `remaining` is empty, showing `Moving n/N`,
  with a no-progress guard so a bad id cannot spin forever.

## Verification

- `npx tsc --noEmit` -> **0 errors**
- `npx vitest run` -> **1060 passed**, 197 skipped, 0 failed (was 1053; **+7**)
- `npx eslint app src` -> **0 errors**; `npm run build` -> exit 0

### Measured first, and it contradicted the request
| pillar | kbDocs | kbChunks |
|---|---|---|
| finder | 1068 | 25153 |
| coach | 1 | 10 |
| reply | **0** | **0** |

Nothing is tagged `reply`. The "documents are in the reply section" reading came from the
missing Finder tab. The Coach kb_miss is the same fact from the other side: Coach retrieval
filters `pillar == 'coach'` and there are 10 chunks in the entire corpus.

### What the tests pin
The chunks move with the doc (`{ pillar: 'coach' }` on every chunk ref); the call is bounded
and hands back the remainder; a deleted doc is skipped without aborting the batch; a
non-admin is refused; an invalid pillar throws before any write; malformed ids are filtered
before touching Firestore; an empty selection reads nothing.

### Regression surface
- **Additive.** No existing action, query or schema changed. The default table view gains one
  checkbox column; the bulk bar is not rendered until something is selected.
- **`kbDocs.pillar` and `kbChunks.pillar` stay in sync**, which is the invariant the
  publish / supersede / unpublish paths already maintain.
- Server-rendered the real `KbDocList` with the project's compiled stylesheet and confirmed
  the tab row now reads **All / Coach / Finder / Reply** with the checkbox column in place.

## Honest gaps

1. **The bulk bar itself was not seen rendered** — it only appears after a click, and the
   static render shows initial state. Its markup is plain Button/Checkbox composition, but
   that is reasoning, not a screenshot.
2. **Nothing is moved automatically.** Coach still has 1 document until Derek selects some
   and moves them — deliberate. Which of 1068 Finder documents belong to Coach is a content
   judgement I should not make silently.
3. **No audit entry** on the move, unlike some other admin actions. Worth adding; the
   existing KB mutations in `crud.ts` do not audit either, so this matches the file rather
   than fixing a pre-existing gap inside a bug claim.
4. **Re-pillaring does not re-embed.** Chunk vectors are pillar-agnostic, so retrieval works
   immediately — but a Coach-specific chunking or prompt strategy, if one is added later,
   would need a re-ingest.
