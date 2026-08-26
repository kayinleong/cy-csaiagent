# RESEARCH — collateral links: WhatsApp assets render as dead paths

**Claim:** quick-kayinleong-050
**Report:** "the link to the source can put the google drive one instead of the whatsapp one."
**Scope:** read-only investigation. No code changed.

---

## Root cause

**`src/agents/finder/tools.ts:267`** hands the model a raw Firebase Storage object path
whenever `externalUrl` is absent:

```ts
// externalUrl takes precedence (plain share link);
// storagePath is the fallback (Firebase Storage object path)
const url = data.externalUrl ?? data.storagePath
```

`collateral/GnoAYH9KP5JL2e9hwaxl/whatsapp/kensho-brochure.pdf` is not a URL. It is a
bucket key. Nothing in the repo ever converts it into one.

The three docs that promise a conversion all point at each other, and **none of them
implements it**:

| Location | Claim | Reality |
|---|---|---|
| `src/agents/finder/tools.ts:234` | `Otherwise → return storagePath as the URL (caller / UI resolves to signed URL)` | No caller resolves it. |
| `src/agents/finder/schema.ts:116` | `Returns type + URL (Storage path resolved to download URL, or externalUrl)` | Never resolved. |
| `src/inventory/crud.ts:250-251` | `Signed URLs for storagePath are generated in the READ path (03-04 fetchCollateral / 03-08 admin UI), not here.` | Neither read path does it. |

**Confirmation that no resolution exists anywhere.** A repo-wide grep for every plausible
symbol returns nothing:

```
grep -rn "getDownloadURL|getSignedUrl|firebasestorage.googleapis.com|storage.googleapis.com|signedUrl" app src scripts
→ (no matches)
```

The only Storage surface in the codebase is `src/firebase/client.ts:127-130`
(`getClientStorage()`), used solely for **uploads**. `src/firebase/admin.ts` never
initializes a `storageBucket` and never exports a bucket handle — there is no
server-side Storage surface at all.

### Why Drive collateral looks like "the" source

The asymmetry is entirely in which field each ingestion path populates:

- **Drive/Skool importer** writes `externalUrl` → `tools.ts:267` returns a real
  `https://drive.google.com/...` string → the model renders it as a markdown link →
  clickable.
- **WhatsApp importer** writes `storagePath` only → `tools.ts:267` falls through to the
  bucket key → the model, correctly recognising it is not a URL, formats it as inline
  code → dead text.

The agent is not "choosing" Drive. Drive is the only item in the tool result that *is* a
URL, so it is the only one that can become a link. The model's behaviour is downstream
and correct given its input.

### Both render paths are already broken by this, independently

1. **Finder card** — `app/[lang]/chat/match-list.tsx:171` renders `href={item.url}`
   unconditionally. A bucket key becomes a *relative* href, resolving to
   `/{lang}/chat/collateral/…` → 404.
2. **Prose fallback** — `app/[lang]/chat/markdown-message.tsx:99` runs react-markdown;
   a bare `collateral/…` string is not a link target, so it renders as text. This is the
   path in the bug report (the turn narrated headings like "Brochure / Sales Kit" rather
   than rendering `MatchList`).
3. **Admin UI, same bug** — `app/[lang]/(admin)/inventory/collateral-form.tsx:134-144`
   is the identical fork in miniature: `externalUrl` → `<a href>`; otherwise
   `<span className="opacity-60">{item.storagePath}</span>`, a greyed-out unclickable
   string.

**The critical consequence for fix placement:** the model receives the bare path *inside
its tool result* and copies it into its narration. Any fix applied at render time cannot
undo that — the dead string is already in the generated text.

---

## Data model reality

`CollateralDoc` — `src/firebase/collections.ts:271-293`:

```ts
export interface CollateralDoc {
  tenantId: TenantId
  projectId: string
  type: string
  /** Firebase Storage object path (e.g. `collateral/project-id/poster.pdf`). */
  storagePath: string
  /** Optional plain share URL for assets not hosted in Firebase Storage … */
  externalUrl?: string
  lang: 'en' | 'ms' | 'zh'
}
```

There is **no `url` field and no `downloadUrl` field**. `storagePath` and `externalUrl`
are the only two location fields, and only one of them is web-addressable.

### Path A — Drive/Skool importer (populates `externalUrl`)

`scripts/scrape-skool/to-inventory.ts:120-128`:

```ts
if (/drive\.google\.com|docs\.google\.com/.test(l.href) && !seen.has(l.href)) {
  seen.add(l.href);
  out.push({ type: collateralType(l.text || l.href), lang: "en", externalUrl: l.href });
}
```

Applied at `to-inventory.ts:271`:

```ts
await attachCollateral(ADMIN, projectId, { type: c.type, lang: c.lang, externalUrl: c.externalUrl });
```

→ writes `{ storagePath: '', externalUrl: 'https://drive.google.com/…' }`. **Clickable.**

### Path B — WhatsApp importer (populates `storagePath` only)

`app/[lang]/(admin)/whatsapp-import/whatsapp-import-form.tsx:349-360`:

```ts
const path = `collateral/${projectId}/whatsapp/${safeStorageName(entryName)}`
await withTimeout(
  uploadBytes(storageRef(storage, path), blob),
  UPLOAD_TIMEOUT_MS,
  t('mediaTimedOut', { bucket }),
)
const att = await attachCollateralAction(projectId, {
  type: 'whatsapp-media',
  lang: kbLang,
  storagePath: path,
})
```

The `uploadBytes` result — which carries the `ref` needed by `getDownloadURL()` — is
**discarded**. → writes `{ storagePath: 'collateral/…/whatsapp/…pdf' }`, no
`externalUrl`. **Dead string.**

### Path C — manual admin form

`app/[lang]/(admin)/inventory/collateral-form.tsx:102-103` lets an admin pick either
field via a radio toggle:

```ts
? { storagePath: path.trim() }
: { externalUrl: path.trim() }),
```

Choosing "storage path" reproduces the same defect by hand.

### Writer

`src/inventory/crud.ts:264-282` — `attachCollateral` validates only that **at least one**
field is present (`if (!input.storagePath && !input.externalUrl) throw`), despite the
doc-comment at `crud.ts:247` claiming "exactly one". Passing **both** is already legal
and already persists both — which the recommended fix relies on, with no writer change.

---

## Fix plan

### Recommendation: fix at **ingestion** — capture `getDownloadURL()` at upload time

**Where:** `app/[lang]/(admin)/whatsapp-import/whatsapp-import-form.tsx:349-360`.

```ts
// import getDownloadURL alongside ref/uploadBytes (line ~330)
const snap = await withTimeout(uploadBytes(storageRef(storage, path), blob), …)
const downloadUrl = await getDownloadURL(snap.ref)
const att = await attachCollateralAction(projectId, {
  type: 'whatsapp-media',
  lang: kbLang,
  storagePath: path,      // keep — canonical object identity, used for delete/overwrite
  externalUrl: downloadUrl, // NEW — the web-addressable form
})
```

**Why this location, and not the other two:**

1. **It is the only location upstream of the model.** The reported symptom is prose: the
   model printed the dead path because the dead path was in its tool result. Render-time
   resolution (option 3) fixes the `MatchList` chip and nothing else — it cannot repair
   text the model already generated. Ingestion-time resolution means `tools.ts:267`
   returns a real URL and the defect disappears on every downstream surface at once
   (Finder card, prose narration, admin badge).
2. **Zero new code in the read path.** `tools.ts:267` (`externalUrl ?? storagePath`) is
   already written to prefer a URL. Populating `externalUrl` makes the existing line
   correct rather than requiring a new resolution step in the streaming hot path.
3. **The token already exists.** These objects were uploaded by the Firebase **web** SDK
   (`uploadBytes`), which stamps `firebaseStorageDownloadTokens` into object metadata
   automatically. `getDownloadURL()` therefore costs one metadata read and returns a
   **permanent, non-expiring** URL. No new infrastructure.
4. **No new GCP surface.** `firebase/storage`'s `getDownloadURL` is squarely inside the
   Firebase SDK surface and contains no Drive-API symbol, so the D-09 / C2 / T-03-24
   grep gates are unaffected.

**Required companions (both small):**

- **Backfill.** Collateral already written by quick-kayinleong-045 has `storagePath`
  only. A one-off admin-side pass over `collateral` docs where `externalUrl` is
  missing and `storagePath` is non-empty, calling `getDownloadURL` for each. Must run
  client-side as a signed-in admin (see Storage access model below) — a Node script
  using the Admin SDK would need bucket init that does not exist yet.
- **Defensive guard at `tools.ts:263-272`.** Even after the backfill, never hand the
  model a bare path. If `externalUrl` is absent, either omit the item or return an
  explicit `url: null` / `unavailable: true` so the model has no dead string to print.
  This is what makes the bug non-recurring rather than merely fixed once. Pair it with a
  guard at `match-list.tsx:171` so a non-`http(s)` value renders as a plain chip instead
  of a broken anchor.

### Rejected: mint a signed URL at tool time

Would work, but costs more and reintroduces the same class of bug:

- **New server surface.** `src/firebase/admin.ts` initializes only Firestore and Auth
  (`admin.ts:79`, `admin.ts:86`) — no `storageBucket`, no bucket export. Signing needs
  `firebase-admin/storage` plus a bucket name.
- **New IAM surface.** On App Hosting the app runs on ADC via the metadata server
  (`admin.ts:69`). `getSignedUrl` under ADC requires the IAM Credentials `signBlob` API
  and the `iam.serviceAccountTokenCreator` role — a GCP surface expansion that sits
  awkwardly against the no-GCP-beyond-Firebase-SDK constraint.
- **Expiry re-breaks the bug.** The URL enters the model context and is persisted into
  `conversations/{cid}/messages`. Reopening a conversation after expiry shows dead links
  again — exactly the failure being fixed, just deferred.
- **Hot-path latency.** N sequential signing round-trips inside the streaming chat turn.

### Rejected as primary: resolve at render time

`getDownloadURL` from the signed-in client in `match-list.tsx` has the cleanest security
posture (the user's own credentials, rules enforced). But it fixes only the card, leaves
the prose path — the actual reported symptom — untouched, and adds async work to a render
component. Useful only as the hardening guard described above.

### Security tradeoff — state this to Derek before shipping

A Firebase download URL is an **unguessable capability URL**. It embeds a token and is
readable by anyone who holds it, **bypassing `storage.rules` entirely**. Persisting it in
Firestore and emitting it into chat transcripts means the file is effectively
link-public.

For this asset class that is almost certainly the intended behaviour — the product exists
so agents can forward brochures and sales kits to leads over WhatsApp, which requires a
link that works for a recipient who has no D2 account. These are marketing documents, not
PII. But it *is* a widening of access relative to today's `allow read: if isSignedIn()`,
so it should be an explicit decision rather than an implicit side effect. If
rules-enforced access is required instead, the only coherent option is render-time
resolution plus stripping URLs from tool output — which removes the forwarding capability
and changes the product.

### Storage access model (does the simpler option exist?)

`storage.rules:26-33`:

```
match /collateral/{projectId}/{allPaths=**} {
  // Any signed-in tenant user may read collateral (single-tenant 'd2' now).
  allow read: if isSignedIn();
  // Only admins may upload/overwrite, capped at 200 MB per object.
  allow write: if isAdmin() && request.resource.size < 200 * 1024 * 1024;
}
```

**A plain public object URL is not available.** Objects are not public, so
`https://storage.googleapis.com/{bucket}/{path}` returns 403. The two viable forms are
the tokenized `getDownloadURL` result (recommended) or a server-minted signed URL
(rejected above). Note that `allow read: if isSignedIn()` *does* permit an authenticated
admin client to call `getDownloadURL` — which is what makes both the ingestion fix and
the backfill possible without touching the rules. **No `storage.rules` change is needed.**

---

## Regression surface

**Untouched by the recommended fix** (verify, do not modify):

- **Drive/Skool collateral.** `to-inventory.ts:126` already writes `externalUrl`;
  `tools.ts:267` already returns it first. Behaviour identical before and after. This is
  the "working" half of the bug and must stay working.
- **`storage.rules`.** No change required. Re-run `src/firebase/__tests__/rules.test.ts`
  to confirm no drift.
- **Upload path.** Capturing the `uploadBytes` return value does not alter what is
  written to the bucket. Watch only for the added `getDownloadURL` await interacting with
  `withTimeout` / the `consecutiveFailures` abort counter at
  `whatsapp-import-form.tsx:337-374` — a `getDownloadURL` rejection must increment
  `mediaErrors` like any other failure, not escape the try/catch.

**Directly exercised — must re-run:**

- `src/inventory/crud.test.ts:336-344` — asserts `expect(writeArg.externalUrl).toBeUndefined()`
  when only `storagePath` is passed. Still passes (it calls `attachCollateral` directly),
  but it encodes the loose "exactly one" invariant that the fix deliberately relaxes to
  "both". If `crud.ts` validation is tightened to genuinely enforce mutual exclusion, this
  fix breaks — do not tighten it in this claim.
- `src/agents/finder/finder.test.ts:549-579` — mocks a collateral doc with
  `storagePath` set and `externalUrl: undefined`, then asserts only `Array.isArray(result)`.
  If the defensive guard **omits** unresolvable items, the array becomes empty and the
  assertion still passes — but the test then verifies nothing. Update the fixture to carry
  an `externalUrl` and assert the returned `url` is an `https://` string; add a second case
  asserting a bare path is never emitted.
- `src/inventory/crud.test.ts:183-191` — non-admin rejection on `attachCollateral`.
  Unchanged, but it is the authorization guard for the write the WhatsApp form performs.

**Currently skipped — will not catch a regression:**

- `e2e/finder-flow.spec.ts:153` (`FINDER-02`, collateral chips) — `test.skip`.
- `e2e/inventory-admin.spec.ts:196` (`ADMIN-05`, attach collateral) — `test.skip`.
  Both are gated on a seeded pilot stack. This claim is the natural point to unskip
  `FINDER-02`, since a real URL in the chip is precisely what it asserts.

**Doc-comment drift to repair in the same commit (Documentation Gate):**

Three comments describe resolution behaviour that will still not exist after this fix, and
would mislead the next reader into re-implementing signed URLs:

- `src/agents/finder/tools.ts:234` — "caller / UI resolves to signed URL"
- `src/agents/finder/schema.ts:116` — "Storage path resolved to download URL"
- `src/inventory/crud.ts:250-251` — "Signed URLs for storagePath are generated in the READ path"

Also update `CollateralDoc`'s `externalUrl` doc-comment
(`src/firebase/collections.ts:281-288`), which currently says the field is for assets
"not hosted in Firebase Storage" — after this fix it also holds Firebase download URLs.

**Blast radius if the guard is added to `tools.ts`:** `fetchCollateral` is reachable from
the Finder pillar only (`route.ts:587`). Coach and Reply do not call it. Returning fewer
items can only reduce what the model attaches; it cannot fabricate or mis-attach.
