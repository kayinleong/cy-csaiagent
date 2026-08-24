# Claim: quick-kayinleong-046
- owner: kayinleong
- session: claude-code
- branch: quick-kayinleong-045-whatsapp-ingest
- started: 2026-08-24
- status: claimed
- summary: UX motion/perf overhaul + chat history loss on refresh + onboarding router/JSON-leak bugs + admin lead management

## What will change

Four bundled defects reported by the user:

1. **UX motion + perf** — page/route transitions and AI-message waiting states feel
   "inhuman and not intuitive"; web interface is laggy. Research the design/motion
   skills at https://github.com/emilkowalski/skills and apply them to the chat
   surface + route transitions. Fix backend hot paths if they are the lag source.
2. **Chat history lost on refresh** — reloading the chat page drops history and the
   agent stops responding.
3. **Onboarding broken** — screenshots show (a) the raw structured JSON envelope
   (`{"answer":..., "citations":[], "handoff":{"reason":"kb_miss"}}`) leaking into
   the user-visible bubble, (b) `kb_miss` on core onboarding content, (c) the router
   sending a coaching question ("walk me through my first Meta ad") to Property
   Finder instead of Onboarding Coach.
4. **Admin leads** — no way to create/set a Lead in the admin app, so the Reply
   Assistant pillar cannot be exercised end to end.

## What has changed

_(pending)_

## Verification

_(pending)_
