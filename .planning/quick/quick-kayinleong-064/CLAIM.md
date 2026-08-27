# Claim: quick-kayinleong-064
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-27
- status: claimed
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

## Verification

_(pending)_
