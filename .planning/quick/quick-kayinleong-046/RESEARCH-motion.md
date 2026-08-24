# Motion & Design-Engineering Research — `emilkowalski/skills`

**Claim:** `quick-kayinleong-046`
**Researched:** 2026-08-24
**Source:** `https://github.com/emilkowalski/skills` — cloned at `--depth 1`, every file read in full (20 files, 3,962 lines).
**Author:** Emil Kowalski (Sonner, Vaul, animations.dev; ex-Vercel, ex-Linear)
**Install (if we ever want the skills locally):** `npx skills@latest add emilkowalski/skills`

**Confidence:** HIGH for everything in `## Per-skill distillation` — it is verbatim from the cloned repo, not paraphrase.
**Confidence:** HIGH for Next.js 16 View Transitions claims — verified against `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md` in this repo.
**Confidence:** HIGH for codebase findings — verified by grep against `app/` and `components/ui/`.

> **Provenance note.** Emil's skills are *taste doctrine*, not standards. Where a rule of his collides with a hard project constraint (PDPA, no-GCP, model-agnostic, `AGENTS.md` "read the Next 16 docs first"), the project constraint wins. Nothing below requires a new backend dependency.

---

## Skill inventory

| Skill | What it covers | When to reach for it |
|---|---|---|
| **`emil-design-eng`** (674 ln) | The master skill. Animation decision framework, spring config, component-building principles, CSS transform mastery, `clip-path`, gestures, performance rules, a11y, the "Sonner principles", debugging, review checklist. | The one to read cover-to-cover. Everything else is a specialised slice of it. |
| **`animate`** (199 ln + `RECIPES.md` 324 ln) | *Construction.* A 7-step build sequence: should-it-animate gate → purpose → cheapest tool → properties → easing/duration → interruption/exit → reduced-motion. Plus 13 ready recipes. | Building any new animation from scratch. Start from a recipe, not a blank file. |
| **`review-animations`** (112 ln + `STANDARDS.md` 187 ln) | *Critique.* Ten non-negotiable standards, aggressive escalation triggers, a remedial preference hierarchy, required Before/After table output, Block/Approve verdict. `disable-model-invocation: true` — explicit invoke only. | Reviewing a motion diff. Also the bar `animate` is written to survive. |
| **`improve-animations`** (101 ln + `AUDIT.md` 115 ln + `PLAN-TEMPLATE.md` 73 ln) | *Audit → plan.* Recon → parallel audit across 8 categories → vet → self-contained plans in `plans/NNN-slug.md` for cheaper executors. Read-only on source. | Auditing our whole motion surface and producing GSD-shaped work items. This is the closest analogue to a GSD phase plan. |
| **`find-animation-opportunities`** (132 ln) | *Restraint-first search.* A 4-question Gate (frequency → purpose → speed → function), a hunt list of seams, hard cap of 5–7 suggestions app-wide, and a **required** "rejected candidates" section. | Asking "what should animate here?" — its job is to say *no* more often than yes. |
| **`animation-vocabulary`** (173 ln) | Reverse-lookup glossary: ~120 named terms across entrances, sequencing, transforms, state transitions, scroll, feedback, easing, springs, ambient, polish, performance, principles. | Naming an effect precisely so a prompt or a design review lands. Useful as our shared motion lexicon. |
| **`apple-design`** (282 ln) | Apple's WWDC design talks (chiefly *Designing Fluid Interfaces* 2018) translated to web: response, 1:1 tracking, interruptibility, springs as behaviour, velocity handoff, momentum projection, rubber-banding, materials/translucency, multimodal feedback, typography, the 8 principles. | Gesture-driven UI, sheets, translucent chrome, and the deepest available treatment of interruptibility + reduced motion (3 media queries, not 1). |
| **`pick-ui-library`** (77 ln) | Curated, opinionated library picks per task + "common mismatches to catch". `disable-model-invocation: true`. | Choosing a dependency. **Notable: we already ship 8 of his picks.** |
| **`prototype`** (90 ln + `PICKER.md` 197 ln) | Build 3–5 *genuinely divergent* UI variants behind a fixed floating dark-glass picker (spec'd verbatim), flip live, promote the winner, delete the harness. | Design exploration on a single high-leverage component. Maps onto `/gsd-sketch`. |
| **`ask-sonner`** (80 ln + `API.md` 64 ln) | Sonner setup, call-picking table, styling escalation ladder (defaults → inline → `classNames` + `!important` → headless), full `<Toaster/>` and `toast()` prop tables, 14-row troubleshooting table. | We ship `sonner@^2.0.7`. Directly applicable. |
| **`animate-expo`** (255 ln + `RECIPES.md` 385 ln) | React Native / Expo: Reanimated 4 worklets, UI-runtime discipline, gestures, haptics, native stack transitions. | **Not applicable** — we have no RN app. But it carries three transferable mobile truths (no hover; press-in feedback; tabs never slide) that matter because D2 agents are on phones. |
| **`write-swift`** (388 ln) | Modern Swift 6.3/6.4 — value types, concurrency, generics, Swift Testing. | **Not applicable.** No Swift in this project. |

---

## Per-skill distillation

Everything in this section is copied from the repo, not summarised. Numbers, curves, and code are exact.

### The three canonical easing tokens

These three appear identically in `animate/SKILL.md`, `review-animations/STANDARDS.md`, `improve-animations/AUDIT.md`, and `emil-design-eng/SKILL.md`. They are *the* shared vocabulary all the skills cite.

```css
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1);     /* strong ease-out for UI */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);    /* strong ease-in-out for on-screen movement */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);     /* iOS-like drawer curve (from Ionic Framework) */
```

> "Built-in CSS easings are too weak. They lack the punch that makes animations feel intentional."
> "Need a curve that isn't here? Take it from [easing.dev](https://easing.dev/) or [easings.co](https://easings.co/). Don't hand-roll one."

**Easing decision order** (identical in all four files):

| Situation | Easing |
|---|---|
| Entering or exiting | `ease-out` |
| Moving / morphing on screen | `ease-in-out` |
| Hover / colour change | `ease` |
| Constant motion (marquee, progress) | `linear` |
| Default | `ease-out` |

> **Never `ease-in` on UI.** "It starts slow, delaying the exact moment the user is watching. `ease-out` at 200ms *feels* faster than `ease-in` at 200ms."

**Duration budgets** (identical in all four files):

| Element | Duration |
|---|---|
| Button press feedback | 100–160ms |
| Tooltips, small popovers | 125–200ms |
| Dropdowns, selects | 150–250ms |
| Modals, drawers | 200–500ms |
| Marketing / explanatory | Can be longer |

> **Rule: UI animations stay under 300ms.** "A 180ms dropdown feels more responsive than a 400ms one."

**Frequency gate** (identical in all five files that carry it):

| Frequency | Decision |
|---|---|
| 100+ times/day (keyboard shortcuts, command palette toggle) | **No animation. Ever.** |
| Tens of times/day (hover effects, list navigation) | Remove or drastically reduce — near-imperceptible only |
| Occasional (modals, drawers, toasts) | Standard animation |
| Rare / first-time (onboarding, success, celebration) | The delight budget lives here |

> "**Keyboard-initiated actions are a disqualifier, not a judgment call.** Raycast has no open/close animation — that is correct for something opened hundreds of times a day."

**The six valid purposes.** Name it in one of these words before writing code: **Feedback**, **Spatial consistency**, **State indication**, **Preventing a jarring change**, **Explanation** (marketing/onboarding only), **Delight** (rare/first-time tier only).

> "Can't name it? Don't build it. 'It looks cool' on a frequently-seen element is a reason to stop."

---

### `animate` — the 7-step build sequence

**Hard rules (verbatim):**
1. Run the sequence in order. Steps 1 and 2 gate everything.
2. **No approximated values.** "Never invent `cubic-bezier(0.4, 0, 0.2, 1)` because it looks familiar."
3. **Extend the codebase's tokens, don't fork them.** "Adding a parallel system is a defect."
4. Reduced motion and hover gating ship *with* the animation, not as a follow-up.
5. Cheapest tool that works. "Don't install a motion library for a fade."

**Step 3 — the tool ladder. Walk down; stop at the first that fits:**

| Need | Tool |
|---|---|
| Hover, press, colour, a state toggle you control with a class or attribute | **CSS transition** |
| Entry animation on mount, no JS state | **CSS `@starting-style`** |
| Predetermined motion that must stay smooth while the page is busy loading | **CSS animation** (runs off the main thread) |
| Programmatic control with CSS performance, no library | **WAAPI** (`element.animate()`) |
| Springs, layout animations, exit animations, gesture-driven values | **Motion** (`motion.dev`) |

> "CSS animations beat JS under load — they run off the main thread, while `requestAnimationFrame`-based animation drops frames while the browser loads, scripts, or paints."
> "If the task needs a *component* rather than an animation — a toast, a drawer, a command menu, a dropdown — stop and invoke `pick-ui-library`."

**Step 4 — properties:**
- **`transform` and `opacity` only.** They skip layout and paint and run on the GPU. `width`/`height`/`margin`/`padding`/`top`/`left` trigger all three.
- **`clip-path` is the sanctioned fourth.** `height` is tolerated *only* for accordions, "where there's no transform equivalent."
- **Never `scale(0)`.** Start from `scale(0.9–0.97)` + `opacity: 0`. "Nothing in the real world appears from nothing… like a balloon that has a visible shape even when deflated."
- **`transform-origin` at the trigger** for popovers/dropdowns/menus/tooltips — `var(--transform-origin)` in Base UI. **Modals are exempt** (not anchored to a trigger → stay centered).
- **Percentages in `translate()`** are relative to the element's own size. `translateY(100%)` moves by its own height whatever the content. Prefer over hardcoded px.
- **In Motion, use the full transform string:**

```jsx
<motion.div animate={{ x: 100 }} />                          // drops frames under load
<motion.div animate={{ transform: "translateX(100px)" }} />  // hardware accelerated
```

- **Never drive a child's transform from a CSS variable on the parent** — recalculates styles for every child.

**Step 5 — springs (when not a duration):** reach for a spring when the motion is drag with momentum, an element that should feel alive, a gesture the user can interrupt or reverse, or decorative mouse-tracking.

```js
{ type: "spring", duration: 0.5, bounce: 0.2 }              // Apple-style — easier to reason about
{ type: "spring", mass: 1, stiffness: 100, damping: 10 }    // traditional physics — more control
```

> "Keep bounce at 0.1–0.3, and avoid bounce in most UI — reserve it for drag-to-dismiss and playful interactions."

**Step 6 — interruption and exit:**
- **Transitions, not keyframes, for anything triggered rapidly.** "Transitions retarget from the current value; keyframes restart from zero."
- **Springs for gestures**, because they carry velocity through an interruption.
- **Exit the way it entered.** "A toast that slides in from the bottom leaves through the bottom."
- **Asymmetric timing where the user is deciding.** Hold-to-confirm press: `2s linear`. Release: `200ms ease-out`.

**Step 7 — reduced motion + pointer gating (ships every time):**

```css
@media (prefers-reduced-motion: reduce) {
  .element { animation: fade 0.2s ease; } /* keep opacity/color, drop transform-based motion */
}

@media (hover: hover) and (pointer: fine) {
  .element:hover { transform: scale(1.05); } /* touch fires false hovers on tap */
}
```

```jsx
const reduce = useReducedMotion();
const closedX = reduce ? 0 : '-100%';
```

> "Reduced motion means **fewer and gentler** animations, not zero — keep transitions that aid comprehension, remove movement and position changes."

**The `Never Ship` table (verbatim — this is the enforcement list):**

| Never | Instead |
|---|---|
| `transition: all` | Name the exact properties |
| `transform: scale(0)` entrance | `scale(0.95)` + `opacity: 0` |
| `ease-in` on a UI element | `ease-out` or a strong custom curve |
| Built-in `ease-out` on a deliberate animation | `cubic-bezier(0.23, 1, 0.32, 1)` |
| Animation on a keyboard shortcut or 100+/day action | No animation |
| UI duration over 300ms with no reason | 150–250ms |
| `transform-origin: center` on a trigger-anchored popover | `var(--transform-origin)` (modals exempt) |
| Keyframes on toasts, toggles, rapidly-triggered elements | CSS transitions |
| Animating `width`/`height`/`margin`/`padding`/`top`/`left` | `transform` / `opacity` |
| Motion `x`/`y`/`scale` props under load | Full `transform` string |
| Ungated `:hover` motion | `@media (hover: hover) and (pointer: fine)` |
| Missing `prefers-reduced-motion` | Gentler variant, not zero |
| Everything entering at once | 30–80ms stagger |

---

### `animate/RECIPES.md` — the 13 recipes, verbatim

**Button press** — "Any pressable element. Instant feedback that the interface heard the user."

```css
.button { transition: transform 160ms var(--ease-out); }
.button:active { transform: scale(0.97); }
```

> "`scale()` scales children too — the label and icons come along, which is what makes it read as a physical press. No hover gating needed here: `:active` is a real press on touch."

**Dropdown / popover / menu / select** — "Scales out of its trigger, not out of thin air."

```css
.popover {
  transform-origin: var(--transform-origin); /* Base UI supplies this */
  transition: opacity 200ms var(--ease-out), transform 200ms var(--ease-out);
}
.popover[data-starting-style],
.popover[data-ending-style] { opacity: 0; transform: scale(0.95); }
```

**Tooltip** — same shape, faster, plus the detail most implementations miss.

```css
.tooltip {
  transform-origin: var(--transform-origin);
  transition: transform 125ms var(--ease-out), opacity 125ms var(--ease-out);
}
.tooltip[data-starting-style],
.tooltip[data-ending-style] { opacity: 0; transform: scale(0.97); }

/* Once one tooltip is open, neighbours open instantly */
.tooltip[data-instant] { transition-duration: 0ms; }
```

> "The initial delay prevents accidental activation. After that, skipping both the delay and the animation makes the whole toolbar feel faster."

**Modal** — "The one popover that stays centered."

```css
.modal {
  transform-origin: center; /* exempt — not anchored to a trigger */
  transition: opacity 250ms var(--ease-out), transform 250ms var(--ease-out);
}
.modal[data-starting-style],
.modal[data-ending-style] { opacity: 0; transform: scale(0.96); }

.backdrop { transition: opacity 250ms var(--ease-out); }
```

> "Animate the backdrop's opacity alongside it so they read as one surface."

**Drawer / sheet**

```css
.drawer {
  transform: translateY(0);
  transition: transform 500ms var(--ease-drawer);
}
.drawer[data-closed] { transform: translateY(100%); }
```

> "This is how Vaul hides a drawer before animating it in."

**Toast**

```css
.toast {
  opacity: 1;
  transform: translateY(0);
  transition: opacity 400ms ease, transform 400ms ease;

  @starting-style {
    opacity: 0;
    transform: translateY(100%);
  }
}
```

> "`ease` rather than `ease-out`, slightly slower than typical UI: Sonner reads as elegant partly because its motion is tuned to the component's personality rather than to the generic UI budget."
> "When toasts stack and the list reflows, the opacity change has to work against the height change. There's no formula for that pair — adjust until it feels right, then check it again the next day."

Legacy fallback when `@starting-style` isn't available:

```jsx
useEffect(() => { setMounted(true); }, []);
// <div data-mounted={mounted}>
```

**Accordion / collapse**

```css
.content {
  overflow: hidden;
  transition: height 200ms var(--ease-out), opacity 200ms var(--ease-out);
}
```

> "Keep it short — this is one of the few animations that costs layout on every frame, so a long duration is expensive as well as sluggish. Measure the content height in JS (or use a headless primitive that supplies it) rather than animating to `auto`."

**Stagger a group entrance** — "For a list or grid the user sees occasionally — not for a list they scroll past all day."

```css
.item {
  opacity: 0;
  transform: translateY(8px);
  animation: fadeIn 300ms var(--ease-out) forwards;
}
.item:nth-child(2) { animation-delay: 50ms; }
.item:nth-child(3) { animation-delay: 100ms; }
.item:nth-child(4) { animation-delay: 150ms; }

@keyframes fadeIn { to { opacity: 1; transform: translateY(0); } }
```

> "Stagger is decorative — it must never block interaction while it plays." Delays: **30–80ms** between items.

**Hold to confirm** — for destructive actions where a plain click is too easy to fire by accident.

```css
.overlay {
  clip-path: inset(0 100% 0 0);
  transition: clip-path 200ms var(--ease-out); /* release: snappy */
}
.button:active .overlay {
  clip-path: inset(0 0 0 0);
  transition: clip-path 2s linear;             /* press: slow and deliberate */
}
.button:active { transform: scale(0.97); }
```

> "`linear` is correct here — the fill is a progress indicator, and progress shouldn't ease."

**Tab indicator with a colour transition** — "Timing individual colour transitions across a tab list never quite lands. Clip instead." Duplicate the tab list, style the copy as the active state, clip the copy so only the active tab shows, animate the clip:

```css
.tabs-active-copy {
  clip-path: inset(0 60% 0 20%); /* driven by the active tab's position */
  transition: clip-path 250ms var(--ease-in-out);
}
```

> "The text and background change together, in perfect sync, because they're one element being revealed rather than two colours being interpolated."

**Scroll reveal** — "Marketing surfaces only. Don't do this to functional UI a user visits daily."

```css
.reveal {
  clip-path: inset(0 0 100% 0);
  transition: clip-path 600ms var(--ease-in-out);
}
.reveal[data-visible] { clip-path: inset(0 0 0 0); }
```

Trigger with `IntersectionObserver`, or Motion's `useInView` with `{ once: true, margin: "-100px" }`. "Fire it once."

**Drag to dismiss**

```js
// Dismiss on a flick, not just on distance
const timeTaken = Date.now() - dragStartTime.current;
const velocity = Math.abs(swipeAmount) / timeTaken;

if (Math.abs(swipeAmount) >= SWIPE_THRESHOLD || velocity > 0.11) {
  dismiss();
}
```

```js
// Set transform on the dragged element directly.
// Driving it through a CSS variable on the parent recalcs styles for every child.
element.style.transform = `translateY(${distance}px)`;
```

Four details that separate a good drag from a bad one: **pointer capture** once the drag starts; **multi-touch protection** (`if (isDragging) return`); **damping past boundaries**; **friction, not a wall**. Settle with `{ type: "spring", duration: 0.5, bounce: 0.2 }`.

**Masking a crossfade that won't settle**

```css
.content { transition: filter 200ms ease, opacity 200ms ease; }
.content.transitioning { filter: blur(2px); opacity: 0.7; }
```

> "Without blur the eye reads two distinct objects swapping. Blur blends them into one perceived transformation. Keep it under 20px — heavy blur is expensive, especially in Safari."

**Programmatic, without a library (WAAPI)**

```js
element.animate(
  [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0 0)' }],
  { duration: 1000, fill: 'forwards', easing: 'cubic-bezier(0.77, 0, 0.175, 1)' }
);
```

> "Hardware-accelerated, interruptible, no bundle cost."

---

### `review-animations` — the ten non-negotiable standards

1. **Justified motion.** Every animation answers "why does this animate?" — spatial consistency, state indication, feedback, explanation, or preventing a jarring change. "'It looks cool' on a frequently-seen element is a block."
2. **Frequency-appropriate.** Keyboard-initiated and 100+/day actions get **no** animation.
3. **Responsive easing.** Entering/exiting use `ease-out` or a strong custom curve. "`ease-in` on UI is a block."
4. **Sub-300ms UI.**
5. **Origin & physical correctness.** Popovers scale from their trigger. Never `scale(0)`. Modals exempt.
6. **Interruptibility.** Rapidly-triggered or gesture-driven motion must use transitions/springs that retarget from current state, "not keyframes that restart from zero."
7. **GPU-only properties.** `transform` + `opacity` only. Framer Motion `x`/`y`/`scale` shorthands under load is a performance finding.
8. **Accessibility.** `prefers-reduced-motion` honoured (gentler, not zero). Hover gated behind `@media (hover: hover) and (pointer: fine)`.
9. **Asymmetric enter/exit.** "Deliberate actions animate slower; system responses snap. Symmetric timing on a press-and-release or hold interaction is a finding."
10. **Cohesion.** "When unsure whether motion feels right, the strongest move is often to delete it."

**Aggressive escalation triggers — "flag these on sight, hard":**

- `transition: all`
- `scale(0)` or pure-fade entrances with no initial transform
- `ease-in` on any UI interaction; weak built-in easing on a deliberate animation
- Animation on a keyboard shortcut, command-palette toggle, or 100+/day action
- UI duration > 300ms with no stated reason
- `transform-origin: center` on a trigger-anchored popover/dropdown/tooltip
- Keyframes on toasts, toggles, or anything added/triggered rapidly
- Animating layout properties (`width`/`height`/`margin`/`padding`/`top`/`left`)
- Framer Motion `x`/`y`/`scale` props on motion that runs while the page is busy
- Updating a CSS variable on a parent to drive a child transform (style recalc storm)
- Missing `prefers-reduced-motion` handling on movement
- Ungated `:hover` motion
- Symmetric enter/exit timing on a press-and-release or hold interaction
- Everything-at-once entrance where a 30–80ms stagger belongs

**Remedial preference hierarchy — "prefer earlier moves over later ones":**

1. **Delete the animation** (high-frequency / no purpose / keyboard-triggered)
2. **Reduce it** — shorter duration, smaller transform, fewer animated properties
3. **Fix the easing** — `ease-in` → `ease-out`/custom curve
4. **Fix the origin/physicality** — correct `transform-origin`; `scale(0)` → `scale(0.95)`+opacity
5. **Make it interruptible** — keyframes → transitions, or a spring for gesture-driven motion
6. **Move it to the GPU** — layout props → `transform`/`opacity`; shorthand → full transform string; WAAPI for programmatic CSS
7. **Asymmetric timing** — slow the deliberate phase, snap the response
8. **Polish** — blur to mask crossfades, stagger for groups, `@starting-style` for entry, spring for "alive" elements
9. **Accessibility & cohesion** — reduced-motion + hover gating; tune to the component's personality

**Required output format.** A single markdown table with `| Before | After | Why |` columns — one row per issue. `emil-design-eng` explicitly forbids the "Before:/After:" list form. Then a verdict grouped by impact tier (feel-breaking regressions → missed simplifications → performance → interruptibility & timing → origin/physicality/cohesion → accessibility), closing with **Block** or **Approve**.

**Block criteria (verbatim):** "any feel-breaking regression, animation on a keyboard/high-frequency action, `scale(0)`/`ease-in` on UI, or a non-GPU animation with an easy GPU fix."

**Debugging protocol (recommended whenever feel is uncertain):**
- **Slow motion:** bump duration **2–5×** or use the DevTools animation inspector. Check colours crossfade cleanly, easing doesn't stop abruptly, `transform-origin` is right, coordinated properties stay in sync.
- **Frame-by-frame:** Chrome DevTools Animations panel reveals timing drift between coordinated properties.
- **Real devices** for gestures — connect a phone, hit the dev server by IP, use Safari remote devtools.
- **Fresh eyes next day** — "imperfections invisible during development surface later."

---

### `improve-animations` — the 8 audit categories + plan discipline

**Workflow:** Phase 1 Recon (stack, where motion lives, conventions, personality, **frequency map**) → Phase 2 parallel audit → Phase 3 vet + prioritise by leverage (impact ÷ effort) → **stop and wait for the user to select** → Phase 4 write self-contained plans.

**The 8 categories:** 1 Purpose & frequency · 2 Easing & duration · 3 Physicality & origin · 4 Interruptibility · 5 Performance · 6 Accessibility · 7 Cohesion & tokens · 8 Missed opportunities.

**Effort levels:**

| Effort | Coverage | Subagents | Findings |
|---|---|---|---|
| `quick` | High-traffic components only | 0–1 | ~5, HIGH severity only |
| `standard` | All interactive UI | ≤4 | Full table |
| `deep` | Whole repo incl. marketing pages | ≤8 | Full table + LOW polish items |

**Severity definitions (verbatim):**
- **HIGH** = feel-breaking — wrong easing on UI, animation on keyboard/high-frequency actions, dropped frames, `scale(0)`
- **MEDIUM** = noticeably off — wrong origin, non-interruptible dynamic UI, missing reduced-motion
- **LOW** = polish — stagger, blur-masked crossfades, token consolidation

**Useful greps (verbatim):** `transition`, `animation`, `@keyframes`, `motion.`, `animate={`, `useSpring`, `ease-in`, `transition: all`, `scale(0)`, `prefers-reduced-motion`, `transform-origin`.

**Plan discipline that transfers directly to GSD PLAN.md:**
> "The executor may be a less capable model with zero context and zero taste — the plan must contain everything, exactly. No references to 'the audit above' or 'the easing we discussed.'"

Plan sections: **Problem** (with current code verbatim + `file:line`) → **Target** (every value spelled out) → **Repo conventions to follow** (with one exemplar to imitate) → **Steps** (one concrete edit per step) → **Boundaries** (do NOT touch X; do NOT add dependencies; "if a step doesn't match the code you find, STOP and report instead of improvising") → **Verification** (mechanical commands **and** a mandatory **feel check**: "set playback to 10% in the Animations panel", "toggle `prefers-reduced-motion` in the Rendering panel", "spamming the toggle never restarts the animation from zero").

> "The feel check is not optional. Motion can be mechanically correct and still feel wrong."

**Cohesion & token rule worth quoting for us:** "Five hand-typed cubic-beziers that almost match is a consolidation finding."

**Consistent exemption to respect:** "`transform-origin: center` on a modal is correct… **Do not report it.**" Also: "Don't re-litigate settled decisions. If a design doc or comment documents a deliberate motion tradeoff, respect it."

---

### `find-animation-opportunities` — the restraint filter

**Operating posture:** "You are a senior design engineer whose defining trait is **restraint**… An opportunity finder that suggests motion everywhere is worse than useless."

**Hard caps:** at most **5–7 suggestions for a whole app**, fewer for a single view. Ordered by leverage, not fun. Never modifies source code.

**The 4-question Gate, in order:** 1 Frequency · 2 Purpose (named from the six words) · 3 Speed (must fit budget — "if the moment only 'works' as a slow, showy animation, it fails the gate") · 4 **Function** — "Data the user is trying to *read* or *act on* should not move for style."

**Where to hunt (the seam classes):**
- **Feedback gaps** — pressables with no `:active` → `transform: scale(0.97)` / `transition: transform 160ms ease-out`; destructive actions on a plain click → hold-to-confirm `clip-path` fill, 2s linear press, 200ms ease-out release
- **Teleporting state** — instant content swaps/conditional renders → `scale(0.95–0.97)` + `opacity: 0`, `ease-out`, `@starting-style`; accordions that snap; list items added/removed with no bridge (CSS transitions, not keyframes)
- **Missing spatial story** — panels with no connection to their trigger → `transform-origin`; dismissables that exit a different way than they entered → symmetric paths, `translateY(100%)` percentages not pixels
- **Group entrances** — 30–80ms stagger, decorative, never blocking
- **Gesture seams** — springs, velocity dismissal `> ~0.11`, rubber-banding
- **The delight budget** — first-run, empty states, success/completion. "These are the only places bounce, stagger generosity, or a longer beat are welcome."

**Useful sweeps (verbatim):** grep for `{isOpen &&`, `display: none` toggles, `onClick` handlers on elements with no `:active`/transition styles, `details`/accordion markup, drag handlers, `.map(` renders of entering lists, empty-state and success components.

**Part 2 of the output is REQUIRED:** list 2–5 rejected candidates with the gate question that killed each. "This section is what separates this skill from an animation wishlist." Example rows given:
- `CommandMenu.tsx:12` — "**Rejected: keyboard-initiated, 100+/day. Never animate.**"
- `Chart.tsx:88` — "**Rejected: functional data the user is reading; decoration hinders.**"

> "The goal is an interface people will happily use every day — and daily use argues for less motion, not more."

---

### `apple-design` — fluid motion, materials, reduced motion (3 queries)

The through-line: "an interface feels alive when motion starts from the current on-screen value, inherits the user's velocity, projects momentum forward, and can be grabbed and reversed at any instant."

**§1 Response — kill latency.** "The moment lag appears, the feeling of directness 'falls off a cliff.'"
- **Respond on pointer-down, not on release.**
- "Be vigilant about every latency. Audit debounces, artificial timers, transition waits, and the ~300ms tap delay."
- "Feedback must be continuous *during* the interaction, not just at the end."

```css
.button:active { transform: scale(0.97); transition: transform 100ms ease-out; }
```

**§3 Interruptibility — "the single most important principle."**
- "Never lock out input during a transition."
- "**Always animate from the *presentation* (current) value, never the target value.** On interrupt, read the element's live on-screen transform and start the new animation from there."
- "**Avoid CSS transitions and `@keyframes` for anything gesture-driven** — they can't be smoothly grabbed and reversed mid-flight."
- "When a gesture reverses, blend velocity — don't hard-cut it… a velocity discontinuity, a 'brick wall.'"
- "**Decompose 2D motion into independent X and Y springs.**"

**§4 Springs — Apple's two designer parameters, with the concrete values Apple ships:**

| Interaction | Damping | Response |
|---|---|---|
| Move / reposition (e.g. PiP) | `1.0` | `0.4` |
| Rotation | `0.8` | `0.4` |
| Drawer / sheet | `0.8` | `0.3` |

- **Damping ratio** — `1.0` = critically damped, no bounce. `< 1.0` = overshoots. **Start most UI at damping `1.0`.**
- **Response** — how quickly the value reaches target, in seconds. "This is not 'duration'."
- "Add bounce (damping ~`0.8`) **only when the gesture itself carried momentum**."

```js
import { animate } from 'motion';
animate(el, { y: 0 },      { type: 'spring', bounce: 0,   duration: 0.4 }); // critically damped default
animate(el, { y: target }, { type: 'spring', bounce: 0.2, duration: 0.4 }); // momentum interaction
```

**§5 Velocity handoff.** `relativeVelocity = gestureVelocity / (targetValue − currentValue)`. "Framer Motion / Motion take absolute px/s velocity directly (`velocity` option)."

**§6 Momentum projection — Apple's exact function:**

```js
// decelerationRate ≈ 0.998 for normal scroll feel; 0.99 for snappier
function project(initialVelocity /* px/s */, decelerationRate = 0.998) {
  return (initialVelocity / 1000) * decelerationRate / (1 - decelerationRate);
}
const projectedEndpoint = currentPosition + project(releaseVelocity);
const target = nearestSnapPoint(projectedEndpoint);
animateSpringTo(target, { velocity: releaseVelocity });
```

> "Note: the physics-textbook `v²/(2·decel)` is *not* what Apple ships — use the exponential-decay form above."

**§9 Rubber-banding:**

```js
function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
```

**§10 Gesture feel checklist:** highlight on touch-*down*, commit on touch-*up*; ~10px hysteresis/hit padding; allow cancel-by-dragging-away-and-back; require ~10px movement threshold before committing to a direction; "detect all plausible gestures in parallel from the first move, then confidently cancel the losers"; avoid recognizers that only report a final state.

**§11 Frame-level smoothness:** "Keep the per-frame positional change below the perception threshold to avoid strobing." For very fast motion, "a subtle motion blur / stretch encodes speed." Animate only `transform`/`opacity` and "hint with `will-change` where motion is imminent."

**§12 Materials & depth:**

```css
.toolbar {
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(20px) saturate(180%);
  border-top: 1px solid rgba(255, 255, 255, 0.4); /* bright top edge = light catching the material */
}
```

- Build nav/toolbars/sheets as translucent layers with content scrolling underneath.
- **"Never stack a light translucent surface on another"** — legibility collapses.
- "Bigger surfaces should read as thicker: stronger blur + a deeper shadow than small chips."
- **"Dim to focus, separate to keep flow."** A modal task pairs the surface with a dimming scrim; a parallel non-blocking panel uses translucency and offset *without* a scrim.
- **Vibrancy:** over blurred/translucent surfaces "don't use flat gray text — use higher-contrast, slightly heavier weight, and a small letter-spacing bump."
- **"Scroll edge effects, not hard dividers."** Fade a small blur/gradient mask where content meets floating chrome instead of a 1px border.
- **"Materialize, don't just fade."** Animate blur radius and scale together on enter/exit.

**§13 Multimodal feedback — three rules:** **Causality** (trigger on the actual causal event), **Harmony** ("the visual, the sound, and the haptic must fire on the **same frame**"), **Utility** ("over-feedback trains users to ignore all of it").

**§14 Reduced motion — respond to THREE independent signals, not one:**

```css
@media (prefers-reduced-motion: reduce) {
  .sheet { transition: opacity 200ms ease; transform: none !important; }
}
@media (prefers-reduced-transparency: reduce) {
  .toolbar { background: white; backdrop-filter: none; }
}
/* prefers-contrast: more → near-solid backgrounds with a defined, contrasting border */
```

Also avoid: full-viewport moving backgrounds; slow looping oscillations near **0.2 Hz** (one cycle per 5s); abrupt brightness jumps (ease dark↔light theme changes). "Make large moving objects semi-transparent while they travel."

**§15 Typography:**

```css
:root { font: 100%/1.5 system-ui, sans-serif; }

.display {
  font-size: clamp(2rem, 5vw, 4rem);
  line-height: 1.05;        /* tight leading for large text */
  letter-spacing: -0.02em;  /* negative tracking as it grows */
  font-optical-sizing: auto;
}
```

> "**Tracking is size-specific — never one value for all sizes.** A fixed `letter-spacing` is wrong somewhere. Tighten headings, leave body near `0`."
> "Respect the user's text-size setting. Scale layout *with* the text — spacing in `rem`/`em`, not fixed px."

**§16 The eight principles:** Purpose · Agency · Responsibility · Familiarity · Flexibility · Simplicity (**not** minimalism) · Craft · Delight ("the result of getting the other seven right, not confetti tacked on top").

Tactical rules under them: "**Feedback comes in four kinds:** status, completion, warning, error… validate inline (not on submit)." · "**Wayfinding.** Every screen should answer: Where am I? Where can I go? What's there? How do I get out? Never trap the user." · "**Grouping & mapping.** If you need a label to explain a control, the mapping is weak." · "**Direct, specific labels beat safe generic ones.** Name nav items for their contents ('Progress', 'Library'), not vague umbrellas ('Home')."

**§17 Process:** "Prototype interactively — an interactive demo is worth 'a million static designs.'" · "Design interaction and visuals together. 'You shouldn't be able to tell where one ends and the other begins.'"

---

### `pick-ui-library` — the curated list (and what we already have)

| Task | Library | We ship it? |
|---|---|---|
| Unstyled, accessible primitives | [base-ui](https://base-ui.com) | ✅ `@base-ui/react@^1.5.0` |
| Command menus (⌘K) | [cmdk](https://cmdk.paco.me) | ✅ `cmdk@^1.1.1` |
| Toasts / notifications | [Sonner](https://sonner.emilkowal.ski) | ✅ `sonner@^2.0.7` |
| OTP / verification-code inputs | [input-otp](https://input-otp.rodz.dev) | ✅ `input-otp@^1.4.2` |
| General-purpose animation (springs, layout, enter/exit) | [motion](https://motion.dev) | ❌ **not installed** |
| Animating numbers | [NumberFlow](https://number-flow.barvian.me) | ❌ |
| Animated text | [torph](https://torph.lochie.me/) | ❌ |
| 3D globes | [Cobe](https://cobe.vercel.app) | ❌ (not needed) |
| Dynamic OG images | [Satori](https://github.com/vercel/satori) | ❌ |
| Syntax highlighting | [shiki](https://shiki.style) | ❌ |
| Real-time / streaming charts | [Liveline](https://github.com/benjitaylor/liveline) | ❌ |
| General charts | [recharts](https://recharts.org) | ✅ `recharts@^3.8.0` |
| Drag and drop | [dnd kit](https://dndkit.com) | ❌ |
| Virtualization (long lists / large tables) | [Virtuoso](https://virtuoso.dev) | ❌ **gap — see recommendations** |
| State management | [zustand](https://zustand.docs.pmnd.rs) | ❌ (we use React state) |
| Conditional `className` | [clsx](https://github.com/lukeed/clsx) | ✅ `clsx@^2.1.1` |
| Variant-driven Tailwind styling | [cva](https://cva.style) | ✅ `class-variance-authority@^0.7.1` |
| Theme switching, no flash | [next-themes](https://github.com/pacocoursey/next-themes) | ✅ `next-themes@^0.4.6` |

Also on his list implicitly: **Vaul** (his own drawer lib) — we ship `vaul@^1.1.2`.

> "Reach for motion when you need springs, layout animations, exit animations, or gesture-driven values. A simple hover or fade doesn't need it — plain CSS transitions are the right tool there."

**Rule 2 of the skill matters for us:** "**Check what's already installed.** Look at `package.json` first. If the project already uses a listed library, use it… don't churn the dependency without being asked."

**Common mismatches to catch:** hand-rolled toasts → Sonner · `<div>`-based dropdown/dialog with manual focus handling → base-ui · animating a number by re-rendering text → NumberFlow · rendering 1,000+ rows directly → Virtuoso before pagination hacks · `useState`-per-component prop web → zustand · three-deep className ternaries → clsx/cva.

---

### `animation-vocabulary` — the terms we should use

A ~120-term glossary in 12 groups. The ones that name things we are actually about to build:

- **Skeleton / Shimmer** — "A placeholder with a moving sheen shown while content loads."
- **Typewriter** — "Text appearing one character at a time, as if being typed."
- **Text morph** — "Text that animates character by character when it changes, drawing attention to the new value."
- **Tabular numbers** — "Fixed-width digits so numbers don't shift around as they change. **Essential** for tickers, timers, and counters."
- **Pulse** — "A gentle repeating scale or opacity change to draw attention."
- **Float** — "A gentle, continuous up-and-down drift that makes a static element feel alive and weightless."
- **Idle animation** — "Subtle motion that plays while an element is just sitting there, waiting to be interacted with."
- **Direction-aware transition** — "Content slides one way going forward and the opposite way going back, so navigation has a sense of direction."
- **Continuity transition** — "A change that keeps the user oriented by visually connecting before and after."
- **Shared element transition** — "An element travels and transforms from one position into another, like a thumbnail expanding into a card."
- **Layout animation** — "When an element's size or position changes, it animates to the new spot instead of snapping."
- **View transition** — "The browser morphs between two states or pages, connecting shared elements."
- **Origin-aware animation** — "An element animates out of its trigger… instead of from its own center which is the default in CSS."
- **Perceptual duration** — "How long a spring feels finished, even though it keeps micro-settling underneath."
- **Interruptible animation** — "An animation that can be smoothly redirected mid-flight instead of finishing first."
- **Layout thrashing** — "Animating properties like width, height, top, or left that force the browser to recalculate layout every frame, causing jank."
- **Jank** / **Dropped frame** / **Compositing** / **will-change** — the performance vocabulary.
- **Frequency of use** — "The more often a user sees an animation, the shorter and subtler it should be."
- **Perceived performance** — "The right animation makes an interface feel faster, even when it isn't."

Easing entries worth quoting in review: **Ease-in** — "Starts slow, ends fast. *Usually avoided; can feel sluggish.*" **Linear** — "*Avoid for UI*; reserve for spinners or marquees." **Asymmetric easing** — "A curve that accelerates and decelerates at different rates. Feels more alive than a symmetric one."

---

### `ask-sonner` — we ship Sonner, so these are live rules

**Setup:** exactly two pieces. **One `<Toaster />` mounted once**, as close to root as possible — "in Next.js: `layout.tsx` — it works inside server components. Never render it per-page or conditionally; a second mounted Toaster duplicates every toast." `toast()` is "a plain function, no hook or provider needed, but it does nothing on the server: in a server action, return the result and call `toast()` in the client code that receives it."

**Styling escalation ladder** — "Climb only as far as the change requires":
1. Defaults + `richColors` / `invert`
2. Inline `toastOptions={{ style: {…} }}`
3. `toastOptions={{ classNames: { toast, title, description, actionButton, cancelButton, closeButton } }}` — "Sonner's injected styles win the cascade, so every class needs `!important` (Tailwind: `!text-red-900`). **If you're marking more than a few things important, stop — go headless.**"
4. **Headless** `toast.custom()` — "The recommended approach for a design-system toast: wrap it in your own `toast()` abstraction."

**Key defaults from `API.md`:** `theme: 'light'` (**does not track OS** — pass `theme="system"` or the resolved theme from next-themes) · `position: 'bottom-right'` · `visibleToasts: 3` · `duration: 4000` · `gap: 14` · `offset: '32px'` · `mobileOffset: '16px'` (<600px) · `richColors: false` · `closeButton: false` · `hotkey: ⌥/alt + T`.

**Update-by-id is how loading→success works without `toast.promise`:**
```jsx
const id = toast.loading('Uploading…');
toast.success('Uploaded', { id });
```

**Troubleshooting rows that will bite us specifically:**
- *"Toasts render completely unstyled (common in Astro, **view transitions**)"* → "Sonner's injected stylesheet was lost — import it explicitly in a layout: `import 'sonner/dist/styles.css'`." **This is a direct hazard if we adopt View Transitions.**
- *"Toast behind a modal/overlay, or clipped"* → "An ancestor creates a stacking context (`transform`, `filter`, `overflow`)… Move `<Toaster />` to the document root."
- *"Dark mode ignored"* → `theme` defaults to `'light'`.
- *"Same toast appears twice"* → two Toasters, or `toast()` fired in an effect under StrictMode's dev double-invoke → "fire from the event handler instead, or pass a stable `id`."
- *"Toasts too close to the screen edge on mobile"* → `mobileOffset`.
- *"Swipe-to-dismiss goes the wrong way"* → `swipeDirections`.

---

### `prototype` — divergence harness

**The value is divergence:** "three tints of the same idea waste the picker." Default **3 variants**, up to 5. "Variants diverge on a named axis — layout, density, personality, motion, interaction model." Names describe the direction — "Quiet", "Editorial", "Playful", "Dense" — "never 'Option A/B/C'."

Craft bar still applies per variant: "right easing (`ease-out` on entrances, never `ease-in`), sub-300ms UI motion, correct `transform-origin`, `transform`/`opacity` only, reduced-motion handled."

"Every variant fully works. Real interactions, real motion, realistic content… No lorem ipsum, no dead buttons."

"The harness must render **one variant at a time, full size, in realistic surrounding context**… Side-by-side thumbnails distort spacing and scale; never judge UI at postage-stamp size."

**The picker itself is a frequency-rule demonstration:** "Switching is **instant** — flipping is a 100+/session action; by the frequency rule the variant swap gets no animation." But the active pill *does* slide (250ms `cubic-bezier(0.23, 1, 0.32, 1)`) as spatial feedback on the chrome, with `data-ready` added after first paint "so load doesn't animate." The `width` transition is called out as "a deliberate exception to the transform/opacity rule: the element is 28px tall, absolutely positioned, and has no layout dependents."

Full verbatim picker CSS lives at `skills/prototype/PICKER.md` in the clone — floating dark-glass pill, `bottom: 24px`, `background: rgba(10,10,10,0.82)`, `backdrop-filter: blur(12px) saturate(1.4)`, `z-index: 2147483647`. "Do not restyle it with the project's tokens."

---

### `animate-expo` and `write-swift` — not applicable, three transferable truths

We have no React Native app and no Swift. But `animate-expo` opens with three mobile facts that matter because **D2 agents live on phones**:

1. **"There is no hover."** "Every affordance the web puts in hover has to live in press, position, or nothing."
2. **Press feedback is the baseline.** "`scale: 0.97` in 100–150ms on any pressable… Feedback on press-in, commit on press-out. Waiting for the tap to complete before showing anything feels dead."
3. **"Tab switches never slide."** "Tabs are peers, not a hierarchy — sliding implies depth that isn't there, and the user pays for it dozens of times a session."

Also transferable: **44×44pt minimum touch target** (48dp Android); use `hitSlop` rather than growing the visual. And the same three easing curves appear as `Easing.bezier(0.23, 1, 0.32, 1)` etc., confirming they are Emil's cross-platform constants.

---

## Application to our app

### Step 0 — the prerequisite that gates everything else

Emil's Hard Rule 3: *"Extend the codebase's tokens, don't fork them. Adding a parallel system is a defect."* We have **no motion tokens at all** — `app/globals.css`'s `@theme inline` block carries colours and radii only. Every animation in the app currently inherits Tailwind's weak defaults.

Add to `app/globals.css` inside the existing `@theme inline` block:

```css
@theme inline {
  /* … existing colour + radius tokens … */

  /* Motion — Emil Kowalski's curves (animations.dev). Do NOT hand-roll variants. */
  --ease-out-strong:    cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out-strong: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer:        cubic-bezier(0.32, 0.72, 0, 1);
}
```

Tailwind 4's `--ease-*` namespace generates utilities, so these become `ease-out-strong`, `ease-in-out-strong`, `ease-drawer`.

> **Decision required (planner):** you can instead *override* Tailwind's built-in `--ease-out` / `--ease-in-out`. That makes every existing `ease-out` in the repo strong for free — which is arguably exactly what Emil wants ("built-in CSS easings are too weak") — but the blast radius is every component. **Recommendation: use the distinct `-strong` names.** Narrower diff, explicit at each call site, and `review-animations` can grep for bare `ease-out` as a finding.

Duration scale (Tailwind 4 `--duration-*` namespace), named after Emil's budget table rather than by number so the intent is legible:

```css
  --duration-press:    140ms;  /* button press feedback   — budget 100–160ms */
  --duration-tooltip:  150ms;  /* tooltips, small popovers — budget 125–200ms */
  --duration-popover:  200ms;  /* dropdowns, selects       — budget 150–250ms */
  --duration-modal:    250ms;  /* modals                   — budget 200–500ms */
  --duration-drawer:   400ms;  /* drawers/sheets — the one place >300ms is earned */
```

And the global accessibility floor we currently do not have anywhere (see anti-pattern A5):

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  /* Then re-enable the comprehension-carrying opacity transitions per Emil:
     "fewer and gentler animations, not zero". */
  [data-motion-keep-fade] { transition-duration: 200ms !important; }
}
```

> Emil is explicit that a blanket kill is *not* the ideal: "Reduced motion means **fewer and gentler** animations, not zero — keep transitions that aid comprehension, remove movement and position changes." The nuke-then-reopt-in shape above gets us compliant in one commit, then lets us restore opacity crossfades case by case with `data-motion-keep-fade`. `apple-design` §14 additionally requires `prefers-reduced-transparency: reduce` (kill `backdrop-filter`) and `prefers-contrast: more` — we use `supports-backdrop-filter:backdrop-blur-xs` on four overlay components, so the transparency query is genuinely applicable.

---

### 1. Route / page transitions across `chat`, `(admin)`, `(coach)`

**Run the gate first — and it rejects most of what you'd want to build.**

| Surface | Frequency tier | Gate verdict |
|---|---|---|
| Sidebar nav between sibling `(admin)/*` pages (kb ↔ users ↔ usage ↔ roles…) | Tens/day for Derek | **Reject directional slides.** These are *peers*, not a hierarchy. `animate-expo`: "sliding implies depth that isn't there, and the user pays for it dozens of times a session." Crossfade at most. |
| Sibling `(coach)/*` pages (dashboard ↔ agents ↔ flags) | Tens/day | Same — crossfade or nothing. |
| `(admin)/kb` → `(admin)/kb/[docId]` | Occasional | **Eligible.** Genuine hierarchy descent → shared-element morph + `nav-forward`. Purpose: *spatial consistency*, "same thing, going deeper". |
| `(coach)/agents` → `(coach)/agents/[uid]` | Occasional | **Eligible.** Same pattern — the agent row morphs into the detail header. |
| Any route → `chat` | 100+/day for agents | **Reject. No animation.** The chat surface is the thing agents open at 11pm; the frequency rule is unambiguous. Instant. |
| `(auth)/sign-in` → app | Rare / first-time | Eligible for the delight budget, but low leverage. Skip in v1. |

**So the only route transitions worth building are the two list→detail descents.** That is a *much* smaller scope than "add page transitions", and it is the correct scope.

**The mechanism — VERIFIED against this repo, not training data.**

| Fact | Status |
|---|---|
| `experimental.viewTransition` flag exists in Next 16 | `[VERIFIED: node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/viewTransition.md]` |
| Full four-pattern guide ships in our node_modules | `[VERIFIED: node_modules/next/dist/docs/01-app/02-guides/view-transitions.md]` |
| **Our top-level `react@19.2.4` does NOT export `ViewTransition`** — `Object.keys(require('react'))` matching `/View\|unstable\|experimental/` returns only `['unstable_useCacheRefresh']` | `[VERIFIED: node -e]` |
| Next 16.2.6 **vendors** `react@19.3.0-canary-3f0b9e61-20260317`, which **does** export it (`exports.ViewTransition = REACT_VIEW_TRANSITION_TYPE` in `next/dist/compiled/react/cjs/react.production.js`) | `[VERIFIED: grep]` |
| Next's own doc states it: *"The App Router in **Next.js 16** uses the latest React Canary release… Highlights include **View Transitions**"* | `[VERIFIED: node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md:400-402]` |
| Types exist but live behind a canary entrypoint: `@types/react@19.2.15` declares `ViewTransitionProps` in `canary.d.ts`, which requires `import {} from 'react/canary'` once, a `/// <reference types="react/canary" />`, or `"types": ["react/canary"]`. **Our `tsconfig.json` has no `types` array**, so one of the first two is needed. | `[VERIFIED: node_modules/@types/react/canary.d.ts:1-21, tsconfig.json]` |
| `next.config.ts` currently sets **no** experimental flags (`// No other config options needed for Phase 1 foundations.`) | `[VERIFIED]` |

**⚠️ Two hazards the planner must budget for:**

1. **Vitest will break.** Vitest resolves bare `react` to `node_modules/react@19.2.4`, which has no `ViewTransition` — so any component importing it fails in unit tests even though it builds and runs fine in Next. Mitigation: alias `react` → `next/dist/compiled/react` in `vitest.config`, or keep `ViewTransition` confined to files with no unit tests (route-level `page.tsx` / `layout.tsx`) and assert transitions in Playwright instead. **Prefer the second** — aliasing React in tests is a large, hard-to-debug lever.
2. **Sonner loses its stylesheet under view transitions.** `ask-sonner` troubleshooting, verbatim: *"Toasts render completely unstyled (common in Astro, **view transitions**) → Sonner's injected stylesheet was lost — import it explicitly in a layout: `import 'sonner/dist/styles.css'`."* Add that import to `app/layout.tsx` **in the same commit** that enables `viewTransition`, or toasts silently go naked.

**The CSS, reconciled to Emil's budgets.** The Next guide's own numbers exceed Emil's sub-300ms UI ceiling (it uses a 400ms `slide-y` and a 400ms morph). Our product personality is "crisp dashboard", not "photography gallery", so Emil wins:

```css
/* app/globals.css */
:root {
  --vt-exit:  120ms;  /* Next's guide says 150ms; tightened for a functional tool */
  --vt-enter: 180ms;  /* Next's guide says 210ms */
}

/* Hierarchy descent: list row → detail header */
::view-transition-group(.morph) { animation-duration: 250ms; }  /* guide: 400ms */
::view-transition-image-pair(.morph) { animation-name: via-blur; }
@keyframes via-blur { 30% { filter: blur(3px); } }   /* <20px per Emil */

/* Directional slide — ONLY on the two eligible descents */
::view-transition-old(.nav-forward) {
  --slide-offset: -48px;
  animation: var(--vt-exit) var(--ease-out-strong) both fade reverse,
             250ms var(--ease-in-out-strong) both slide reverse;
}
::view-transition-new(.nav-forward) {
  --slide-offset: 48px;
  animation: var(--vt-enter) var(--ease-out-strong) var(--vt-exit) both fade,
             250ms var(--ease-in-out-strong) both slide;
}
/* .nav-back mirrors with the offsets negated — "Exit the way it entered." */

@keyframes slide { from { translate: var(--slide-offset); } to { translate: 0; } }
@keyframes fade  { from { filter: blur(3px); opacity: 0; } to { filter: blur(0); opacity: 1; } }
```

Notes on the deltas from the Next guide:
- Guide uses `ease-in` on `::view-transition-new(.slide-up)` and `ease-in` on the nav-forward exit. **`ease-in` on UI is an automatic block** in `review-animations`. Replaced with `--ease-out-strong` / `--ease-in-out-strong` above.
- Guide's `60px` offset → `48px`. Guide's own rationale ("enough to communicate direction without making the user track a fast-moving element") holds; 48px suits a 390px-wide phone better than 60px.
- The guide's `fade` keyframe already includes a `blur(3px)` — that is Emil's crossfade-masking recipe, arrived at independently. Keep it.

**Anchor the chrome.** The admin sidebar and the chat header must not slide — `apple-design` §7 and the Next guide agree: "A sliding header breaks the user's spatial anchor."

```tsx
<header style={{ viewTransitionName: 'app-chrome' }}>…</header>
```
```css
::view-transition-group(app-chrome) { animation: none; z-index: 100; }
::view-transition-old(app-chrome)   { display: none; }   /* prevents the double-header flash */
::view-transition-new(app-chrome)   { animation: none; }
```

**Reduced motion.** The Next guide's blanket `animation-duration: 0s !important` on `::view-transition-*(*)` is the pragmatic floor and the guide itself notes it's not the refined answer. Directional slides are, per the guide, "the most common trigger for motion sensitivity" — so kill the slide but keep the morph and the fade:

```css
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(.nav-forward), ::view-transition-new(.nav-forward),
  ::view-transition-old(.nav-back),    ::view-transition-new(.nav-back) {
    animation-name: fade !important;   /* drop `slide`, keep the opacity bridge */
  }
}
```

**Locale switching (`app/[lang]/`) is a same-route content change**, not a navigation — the Next guide's Step 4 crossfade (`key={lang}`, `share="auto"`, `enter="auto"`, `default="none"`) is the right shape if we animate it at all. Given the language chip is used rarely, this is eligible; given it's low leverage, defer.

---

### 2. The AI-message waiting state (the "inhuman" one)

**Current state, verified:**
- `app/[lang]/chat/message-list.tsx:184` — `<div className="text-muted-foreground text-sm animate-pulse px-1">Thinking…</div>`
- `app/[lang]/chat/chat-shell.tsx` — `isStreaming` is derived as `last message is assistant && content === ''`.

**Diagnosis against the skills.** The indicator disappears the instant the first token lands, and the token text appears with **zero transition**. There are two distinct defects and the second is the one that reads as "inhuman":

1. **The indicator itself is an ambient loop carrying no information.** `animate-pulse` is Tailwind's 2s `cubic-bezier(0.4,0,0.6,1)` infinite opacity oscillation. It passes the purpose gate (*state indication*) but it's a "Pulse" doing the job of a progress signal, and 2s is 6.7× the UI budget for a state change.
2. **The handoff is a hard cut.** Two distinct objects swap in one frame: the "Thinking…" text and the first tokens. This is precisely the case `emil-design-eng` describes: *"Without blur, you see two distinct objects during a crossfade — the old state and the new state overlapping. This looks unnatural."*

**Prescription, in Emil's remedial order.**

**(a) Entrance for the indicator** — `@starting-style`, never `scale(0)`:

```css
[data-slot="thinking"] {
  opacity: 1;
  transform: translateY(0);
  transition: opacity 200ms var(--ease-out-strong),
              transform 200ms var(--ease-out-strong);

  @starting-style { opacity: 0; transform: translateY(4px); }
}
```

**(b) Replace the pulse with a three-dot stagger** — Emil's stagger numbers (30–80ms), `transform`/`opacity` only, and the *only* legitimate infinite loop in the app because it genuinely encodes "still working":

```css
[data-slot="thinking"] i {
  display: inline-block; width: 4px; height: 4px; border-radius: 999px;
  background: currentColor;
  animation: think 1.2s var(--ease-in-out-strong) infinite;
}
[data-slot="thinking"] i:nth-child(2) { animation-delay: 60ms; }
[data-slot="thinking"] i:nth-child(3) { animation-delay: 120ms; }

@keyframes think {
  0%, 60%, 100% { opacity: 0.35; transform: translateY(0); }
  30%           { opacity: 1;    transform: translateY(-2px); }
}

@media (prefers-reduced-motion: reduce) {
  /* "fewer and gentler, not zero": drop the movement, keep an opacity beat */
  [data-slot="thinking"] i { animation: none; opacity: 0.6; }
}
```

Keyframes are correct here (Emil's tool ladder: *"Predetermined motion that must stay smooth while the page is busy loading → CSS animation (runs off the main thread)"*) — and the page **is** busy: it's parsing an SSE stream. This is the single strongest argument for CSS over JS in our whole app.

**(c) Mask the handoff seam** — the highest-leverage change. Apply Emil's crossfade-masking recipe to the transition from indicator to first token:

```css
[data-slot="assistant-message"] {
  transition: filter 200ms ease, opacity 200ms ease;
}
[data-slot="assistant-message"][data-settling] {
  filter: blur(2px);
  opacity: 0.7;
}
```

Set `data-settling` for one frame when the first token arrives, then remove it. Emil: *"Blur bridges the visual gap by blending the two states together, tricking the eye into perceiving a single smooth transformation instead of two objects swapping."* Keep blur **under 20px** — "heavy blur is expensive, especially in Safari."

**(d) Asymmetric timing on the handoff** — Standard 9. The indicator is the *deliberate* phase (the wait), the first token is the *system responding*:
- Indicator exit: **120ms** `--ease-out-strong` (snap it away).
- Message entrance: **180ms** `--ease-out-strong`, **delayed by 120ms** so it doesn't compete with the exit.

This is structurally identical to the Next guide's Suspense-reveal asymmetry ("Old content should leave quickly so it does not compete for attention. New content should arrive more gently"). Two independent sources converge on it.

**(e) 🚫 Never animate per token.** The single biggest trap here. Tokens arrive 20–60×/second; any animation keyed to token arrival is the frequency rule violated by three orders of magnitude, plus it's "animating on every render."
- The message container's entrance must fire **once**. `@starting-style` does this correctly by construction (it applies only on first style resolution). A keyframe re-triggered by a changing `key` does not.
- Do **not** put a `key={msg.content}` on the bubble. Do not add a typewriter/`text-morph` effect over streamed text — the stream *is* the typewriter, and layering an animation on it fights the data.
- Do not set `will-change` on the streaming bubble; the content reflows constantly and the hint buys nothing.

**(f) Kill the latency before animating anything** — `apple-design` §1, the highest-leverage item in this whole document:

> "The moment lag appears, the feeling of directness 'falls off a cliff.'" · "Respond on pointer-down, not on release." · "Feedback must be continuous *during* the interaction, not just at the end."

Concretely for `chat-input.tsx`: the send button gets `:active { transform: scale(0.97) }` at 140ms, and the optimistic user bubble must land **on submit**, before the `fetch` to `/api/chat` even opens. No animation makes a 3-second wait feel human; a 0ms acknowledgement does. Also audit the input path for debounces and artificial timers — Emil: *"Anything on the input path that isn't essential is a regression."*

**(g) Faster spinner = faster app.** `emil-design-eng`, verbatim: *"A **fast-spinning spinner** makes loading feel faster (same load time, different perception)."* Our `components/ui/spinner.tsx:6` and the Sonner loading icon at `components/ui/sonner.tsx:28` both use `animate-spin` = Tailwind's default **1s linear infinite**. Drop to **~650ms**. `linear` is correct (constant motion). Free perceived-performance win, two lines.

---

### 3. List / message enter + exit, and optimistic insertion

**Current state:** `message-list.tsx` maps messages with **no** enter animation — a textbook "teleporting state" seam from `find-animation-opportunities`.

**Enter — transitions, not keyframes.** `emil-design-eng` Sonner Principle 5, verbatim: *"Toasts are added rapidly. Keyframes restart from zero on interruption. Transitions retarget smoothly."* Messages are added rapidly during a burst, so this applies directly.

```css
[data-role="user"] > div,
[data-role="assistant"] > * {
  opacity: 1;
  transform: translateY(0);
  transition: opacity 200ms var(--ease-out-strong),
              transform 200ms var(--ease-out-strong);

  @starting-style { opacity: 0; transform: translateY(8px); }
}
```

`translateY(8px)` is Emil's own stagger-recipe offset. `transform`/`opacity` only — nothing here touches layout.

**🚫 No stagger on the message list.** Emil's stagger recipe is explicitly scoped: *"For a list or grid the user sees occasionally — **not** for a list they scroll past all day."* Messages also arrive one at a time, so stagger has no subject. **Where stagger DOES belong in our app:** `app/[lang]/chat/hero-empty-state.tsx` — the first-run suggestion cards. That's the rare/first-time tier, i.e. the delight budget. 50ms steps, 300ms `--ease-out-strong`, `translateY(8px)`, and it must never block tapping a card.

**Spatial consistency (Standard 5 + `apple-design` §7).** User bubbles are right-aligned and originate from the composer at the bottom; assistant bubbles are left-aligned. `translateY(8px)` for both is correct and directionally honest. Do **not** slide user messages in from the right or assistant messages in from the left — that invents a spatial story that isn't there.

**Optimistic insertion — the flicker trap.** The optimistic bubble and the server-confirmed bubble must be **the same DOM identity**, or the bubble re-mounts, `@starting-style` fires a second time, and the user sees a flicker at exactly the moment we're trying to build confidence.
- Key on a **client-generated** id that survives confirmation. `chat-shell.tsx` already has the right primitive — `newConversationId()` uses `crypto.randomUUID()`; use the same shape for message ids.
- If pending state needs a visual, transition `opacity` on a `data-pending` attribute (`opacity: 0.7` → `1`, 200ms). **Do not** re-mount and do not swap the key.
- React 19 gives us `useOptimistic` + `useTransition` for this, and `useTransition` is also what activates `<ViewTransition>` — so the optimistic path and the animation path are the same mechanism.

**Exit.** Chat messages never exit in our app (no delete), so build none — Emil's cheapest-tool rule. Conversation rows in the history drawer *can* disappear; those get a symmetric exit ("Exit the way it entered") when that feature lands.

**The unresolvable pair — flag it for a feel-check, don't guess.** `emil-design-eng`, verbatim: *"When items enter and exit a list (like Family's drawer), the opacity change must work well with the height animation. This is often trial and error. There is no formula — you adjust until it feels right."* Our `MessageList` is a flex column inside a Radix `ScrollArea` with `flex-1 min-h-0 overflow-hidden`; each new bubble reflows the container while the previous one is mid-fade. **This cannot be settled from code.** The plan must carry a feel-check step: send three messages in quick succession, watch at 10% playback in the DevTools Animations panel, and look again the next day.

**Virtualization trigger (`pick-ui-library`).** *"Rendering a 1,000+ row list directly → Virtuoso before reaching for pagination hacks."* Not needed today, but name the trigger: if a coach's downline view or a long chat transcript passes ~1,000 rows, reach for `Virtuoso`, and note that `animate-expo` warns entrance animations on virtualized rows are wrong (rows recycle) — animate the container instead.

---

### 4. Skeletons vs spinners vs shimmer

The skills don't give a decision table for this, so here is one derived from their rules, with the source for each row.

| Situation | Use | Why (source) |
|---|---|---|
| We know the final shape, and it's replaced by content of the same shape (admin tables, coach dashboard cards, KB doc list) | **Skeleton** + Suspense reveal | *Preventing a jarring change* + "Content sliding up communicates arrival" (Next guide Step 2) |
| Indeterminate, shapeless wait scoped to a control (button submitting, Sonner loading toast) | **Spinner** | Nothing to placehold; a skeleton would lie about the shape |
| The wait is < ~200ms | **Neither** | A flash of skeleton is worse than nothing — it's a jarring change we introduced |
| SSE token stream (chat) | **Neither — the three-dot indicator** (§2) | The content streams in; a skeleton would be replaced mid-fill |
| Shimmer sweep | **Only if the pulse tests flat**, and only as a translated overlay | See below |

**Never chain skeleton → spinner → content.** Two swaps where one belongs; each swap is a jarring change.

**Our `components/ui/skeleton.tsx:7` uses `animate-pulse`.** That is opacity-only, therefore compositor-safe, therefore fine as-is. **If** we want a true shimmer, implement it as a `transform: translateX()` gradient overlay — **never `background-position`**, which is a paint property every frame:

```css
.shimmer { position: relative; overflow: hidden; }
.shimmer::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, color-mix(in oklch, var(--foreground) 6%, transparent), transparent);
  transform: translateX(-100%);
  animation: sheen 1.4s var(--ease-in-out-strong) infinite;
}
@keyframes sheen { to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .shimmer::after { animation: none; } }
```

`translateX(±100%)` is percentage-relative to the element's own size — Emil's preferred form: *"Prefer percentages over hardcoded pixel values. They are less error-prone and adapt to content."*

**The Suspense reveal is where the real gain is,** and it maps 1:1 onto our admin/coach pages, which already have async server components. Adopt the Next guide's Step 2 asymmetry verbatim in shape, retuned to our budget:

```tsx
<Suspense fallback={<ViewTransition exit="slide-down"><TableSkeleton /></ViewTransition>}>
  <ViewTransition enter="slide-up" default="none">
    <UsageTable />
  </ViewTransition>
</Suspense>
```

`default="none"` is load-bearing — without it, "every transition on the page would trigger every `ViewTransition`'s animation."

**Reduced motion:** skeletons are the canonical "gentler, not zero" case. Keep the static muted block, drop the pulse. Do **not** hide the skeleton — it's the affordance.

---

### 5. Perceived-performance tricks

Ordered by leverage for our app.

**1. Optimistic UI (biggest lever, zero animation).** React 19 `useOptimistic` in `chat-shell.tsx`. The user's bubble lands on submit. Everything else in this document is polish on top of this.

**2. Transition suppression on first paint.** Straight from `prototype/PICKER.md`: *"Enable the slide only after first paint, so load doesn't animate."*

```js
requestAnimationFrame(() => requestAnimationFrame(() => el.setAttribute('data-ready', '')));
```
```css
.thing { /* no transition by default */ }
[data-ready] .thing { transition: transform 200ms var(--ease-out-strong); }
```

**Apply to:** loading a history transcript (`handleSelectConversation` in `chat-shell.tsx` sets 40 messages at once — without suppression, 40 bubbles all fire their `@starting-style` entrance simultaneously, which is both ugly and a real frame-budget spike on a mid-range Android); the admin sidebar active-item highlight; any server-rendered list with an entrance.

**3. `will-change` — narrowly, temporarily.** `apple-design` §11: *"hint with `will-change` where motion is imminent."* **Imminent**, not permanent. Legitimate uses in our app: the sliding indicator on a tab/segmented control (small, always-animating, absolutely positioned — the picker spec does exactly this); a drawer surface on `pointerdown`, removed on settle. **Illegitimate:** blanket `will-change` on message bubbles (memory cost × N, and each promoted layer is real GPU memory on a phone).

**4. Compositor-only props, and the three sanctioned exceptions.** `transform` + `opacity` always. `clip-path` is Emil's sanctioned fourth. `filter: blur()` under 20px for crossfade masking. `height` **only** for accordions — and note our `tw-animate-css` `animate-accordion-down/up` does exactly that, which is the *sanctioned* case and must **not** be reported as a finding (mirrors the modal-origin exemption).

**5. Faster spinner.** 1s → ~650ms. See §2(g).

**6. Instant-after-first tooltips.** *"Once one tooltip is open, hovering over adjacent tooltips should open them instantly with no animation. This feels faster without defeating the purpose of the initial delay."* `.tooltip[data-instant] { transition-duration: 0ms; }`. Relevant to the admin toolbars, where several icon buttons sit side by side.

**7. Kill latency on the input path** (`apple-design` §1) — audit debounces, artificial timers, transition waits.

**8. Mobile-first corollaries** (D2 agents are on phones — this is why `animate-expo` is worth reading even though we ship no RN):
- **"There is no hover."** Every `hover:` affordance needs a press or position equivalent. We have 22 distinct `hover:` utilities and **zero** `@media (hover: hover)` gating — see anti-pattern A6.
- **Feedback on press-in, commit on press-out.** `:active { transform: scale(0.97) }` at 140ms on every pressable.
- **44×44pt minimum touch target**; use `hitSlop`-equivalent padding rather than growing the visual.
- **Tabs never slide.**

---

## Library recommendations

**Headline: the skills' own tool ladder says we need approximately zero new dependencies.** Emil Hard Rule 5: *"Cheapest tool that works. Don't install a motion library for a fade."* And `pick-ui-library` Rule 2: *"Check what's already installed… don't churn the dependency without being asked."*

**We already ship 9 of Emil's curated picks** — `@base-ui/react`, `cmdk`, `sonner`, `input-otp`, `recharts`, `clsx`, `class-variance-authority`, `next-themes`, and `vaul` (his own drawer library). Our stack is already the stack he'd have chosen.

### What the skills recommend, by mechanism

| Mechanism | Skills' verdict | Our verdict |
|---|---|---|
| **CSS transitions** | Top of the ladder. Hover, press, colour, any state toggle driven by a class or attribute. | **Primary tool.** Covers button press, message entrance, indicator handoff, popover retuning, skeleton. |
| **CSS `@starting-style`** | "The modern CSS way to animate element entry without JavaScript." Explicitly replaces the `useEffect(() => setMounted(true))` pattern. | **Adopt** for message and indicator entrances. Fires once by construction — which is exactly what we need for streamed content. `[ASSUMED]` on browser support: widely available in current Chrome/Safari/Firefox, but **verify against caniuse before shipping** and keep the `data-mounted` fallback for anything load-bearing. |
| **CSS animation (keyframes)** | For predetermined motion that must stay smooth while the page is busy. "CSS animations beat JS under load — they run off the main thread." | **Adopt for the thinking indicator specifically.** The page is parsing SSE; this is the textbook case. |
| **WAAPI (`element.animate()`)** | "JavaScript control with CSS performance. Hardware-accelerated, interruptible, and no library needed." | **Keep in reserve.** No current need. If we ever build a `clip-path` progress overlay (hold-to-confirm on a destructive admin action like erasure), this is the tool. |
| **Motion (`motion.dev`)** | "Springs, layout animations, exit animations, gesture-driven values." | **Do NOT add now.** Walk the ladder: springs → no gestures in v1; drag-to-dismiss → **Vaul already does this and is already installed**; exit animations → Radix/base-ui `data-closed` handles them; layout animations → none needed. `emil-design-eng` also records the Vercel war story *against* it: *"the dashboard tab animation used Shared Layout Animations and dropped frames during page loads. Switching to CSS animations (off main thread) fixed it."* If we ever do add it: `[ASSUMED]` React 19 compatible — **run `npm view motion version` and check the peer range first**, use the full `transform` string never `x`/`y`/`scale`, and prefer the mini bundle on a mobile-first app. |
| **`view-transition-name` / React `<ViewTransition>`** | **Not mentioned in any Emil skill.** His vocabulary defines "View transition" and "Shared element transition" as terms, but no skill prescribes the API. | **This is our own call, grounded in the Next 16 docs instead.** Fully verified above. Scope it to the two list→detail descents only. |

### React-19 / Next-16 compatibility flags

| Item | Flag |
|---|---|
| `ViewTransition` from `react` | ⚠️ **Works in Next App Router** (vendored canary `19.3.0-canary-3f0b9e61-20260317`) but **not in bare `react@19.2.4`** → **Vitest will fail**. Types need `import {} from 'react/canary'` once. |
| Sonner + view transitions | ⚠️ Add `import 'sonner/dist/styles.css'` to `app/layout.tsx` in the same commit as the flag. |
| `@starting-style` | ✅ Pure CSS, framework-agnostic, no React interaction. Safest thing in this document. |
| `useReducedMotion()` in code samples | ⚠️ That's Motion's hook, which we don't have. Use `window.matchMedia('(prefers-reduced-motion: reduce)')` or pure CSS. **Prefer pure CSS** — it works in RSC, which most of our components are (`message-list.tsx` is deliberately RSC with no `"use client"`). |
| `next-intl` + View Transitions | ⚠️ `[ASSUMED]` untested interaction. Our locale lives in the route segment (`app/[lang]/`), so a locale switch is a navigation and *will* trigger transitions. Needs a spike before enabling the flag globally. |
| Tailwind 4 `@theme` for motion tokens | ✅ `--ease-*` and `--duration-*` are first-class Tailwind 4 namespaces. CSS-first config, no JS config file needed. |
| `tw-animate-css` | ✅ Keep. Do not rip out — it drives every shadcn `data-open:animate-in`. Retune it (see A10). |

### Nothing to add — with named trigger conditions

`Virtuoso` (>1,000 rows) · `NumberFlow` (animated counters — plausible for the coach dashboard's downline stats; note the vocabulary rule "**Tabular numbers** — Fixed-width digits so numbers don't shift around… **Essential** for tickers, timers, and counters") · `dnd-kit` (drag reordering) · `Liveline` (live streaming charts — our `recharts` usage is static dashboards, so recharts stays correct) · `zustand` (if `chat-shell.tsx`'s ~10 `useState` calls become a prop web — it's close).

---

## Anti-patterns to remove

Findings verified by grep against `app/` and `components/ui/` in this repo. Severity uses `improve-animations`' definitions (HIGH = feel-breaking; MEDIUM = noticeably off; LOW = polish).

| # | Sev | Location | Before | After | Why |
|---|---|---|---|---|---|
| **A1** | HIGH | `app/layout.tsx:50` **and** `app/[lang]/chat/page.tsx:65` — **two `<Toaster />` mounted** | `<Toaster />` in layout + `<Toaster richColors position="top-center" />` in the chat page | Keep **one**, at the root. Move `richColors` / `position="top-center"` onto the layout instance. | `ask-sonner`, verbatim: *"Same toast appears twice → Two Toasters mounted (layout **and** page) — keep one."* Also: *"Never render it per-page or conditionally; a second mounted Toaster duplicates every toast."* **This is a live bug, not a style issue.** |
| **A2** | HIGH | Entire repo — grep for `prefers-reduced-motion` across `app/`, `components/`, `src/` returns **nothing** | No reduced-motion handling anywhere | The `@media (prefers-reduced-motion: reduce)` block in Step 0 | Standard 8. Emil ships it *with* every animation, never as a follow-up. This is the highest-severity accessibility finding in the app. |
| **A3** | HIGH | Entire repo — **22 distinct `hover:` utilities, zero `@media (hover: hover)` gating** | `hover:bg-muted`, `hover:text-foreground`, … ungated | Wrap motion-carrying hover states in `@media (hover: hover) and (pointer: fine)` | *"Touch devices trigger hover on tap, causing false positives."* **D2 agents are on phones** — this is a mobile-first defect, not a desktop nicety. |
| **A4** | HIGH | 10 vendored components: `button.tsx:8`, `badge.tsx:8`, `tabs.tsx:66`, `toggle.tsx`, `switch.tsx`, `accordion.tsx:45`, `navigation-menu.tsx:62`, `progress.tsx:578`, `input-otp.tsx:58`, `sidebar.tsx:469` | `transition-all` | Name the exact properties: `transition-[transform,opacity]`, `transition-colors`, … | `transition: all` is the **first** entry in Emil's escalation triggers and an automatic block: *"animates unintended properties off-GPU."* |
| **A5** | HIGH | `app/[lang]/chat/message-list.tsx:184` | `<div className="… animate-pulse">Thinking…</div>`, then a hard cut to token text | The full §2 prescription: `@starting-style` entrance, three-dot stagger, blur-masked handoff, asymmetric 120/180ms timing | Two findings in one: a 2s ambient loop standing in for a progress signal, and an unmasked crossfade between two distinct objects. **This is the "inhuman" feeling, named.** |
| **A6** | MEDIUM | `components/ui/sheet.tsx:65` — the **only** `ease-in-out` in the codebase | `transition duration-200 ease-in-out` on an entering/exiting surface | `ease-drawer` (`cubic-bezier(0.32, 0.72, 0, 1)`) at `duration-drawer` (400ms) | Standard 3: entering/exiting elements use `ease-out` or a strong custom curve, never `ease-in-out`. A sheet is the exact case `--ease-drawer` exists for — *"This is how Vaul hides a drawer before animating it in."* |
| **A7** | MEDIUM | `components/ui/sheet.tsx:65` | `slide-in-from-bottom-10` (= 10 × `--spacing` = **40px** fixed) | `translateY(100%)` | *"Percentage values in `translate()` are relative to the element's own size… Prefer percentages over hardcoded pixel values. They are less error-prone and adapt to content."* A 40px offset on a full-height sheet barely moves it. |
| **A8** | MEDIUM | `components/ui/button.tsx:8` | `active:not-aria-[haspopup]:translate-y-px` (a **1px** translate) | `active:scale-[0.97]` with `transition-transform duration-press` | *"`scale()` scales children too — the label and icons come along, which is what makes it read as a physical press."* A 1px translate is below the perception threshold; it reads as nothing. `apple-design` §1 makes this the foundation of felt responsiveness. |
| **A9** | MEDIUM | `components/ui/navigation-menu.tsx:90` | `ease-[cubic-bezier(0.22,1,0.36,1)]` — hand-typed, **and a near-duplicate** of Emil's `cubic-bezier(0.23,1,0.32,1)` | `ease-out-strong` token | *"Five hand-typed cubic-beziers that almost match is a consolidation finding."* Also Hard Rule 2: *"No approximated values… Never invent `cubic-bezier(0.4, 0, 0.2, 1)` because it looks familiar."* |
| **A10** | MEDIUM | `tw-animate-css` defaults, inherited by all 13 shadcn components using `animate-in` | `--animate-in: enter … var(--tw-ease, ease) …` → entrances default to **`ease`**, not `ease-out` | Set `--tw-ease: var(--ease-out-strong)` globally, or add an explicit `ease-out-strong` utility per component | Standard 3. Every popover, dropdown, dialog, tooltip, and sheet entrance in the app currently uses the weakest possible curve on the moment the user is watching most. **One-line global fix, app-wide effect — the highest leverage-to-effort item on this list.** |
| **A11** | LOW | `components/ui/navigation-menu.tsx:77,90` — `duration-300` ×2 | 300ms on a dropdown | `duration-popover` (200ms) | Duration table: dropdowns/selects are 150–250ms. At the 300ms ceiling with no stated reason. *"A 180ms dropdown feels more responsive than a 400ms one."* |
| **A12** | LOW | `components/ui/spinner.tsx:6`, `components/ui/sonner.tsx:28` | `animate-spin` (Tailwind default 1s linear) | ~650ms linear | *"A fast-spinning spinner makes loading feel faster (same load time, different perception)."* Free perceived-performance win. |
| **A13** | LOW | `app/globals.css` `@theme inline` | Colours + radii only; **no easing or duration tokens** | Step 0's motion tokens | Category 7 (Cohesion & tokens): *"Curves and durations should live as shared tokens."* Without this, every fix above is a one-off. **Do A13 first.** |

### Traps to avoid *introducing* (we are currently clean — keep it that way)

| Trap | Status | Guard |
|---|---|---|
| `scale(0)` entrances | ✅ **Clean.** `tw-animate-css` bare `zoom-in`/`zoom-out` set `--tw-enter-scale: 0` — but grep confirms every use in the repo is `zoom-in-95` / `zoom-out-95`. | Candidate ESLint/grep rule: ban bare `zoom-in` / `zoom-out`. |
| `transform-origin: center` on trigger-anchored popovers | ✅ **Clean.** All Radix content components already use `origin-(--radix-*-content-transform-origin)`. Emil's origin-awareness rule is satisfied for free. | Don't regress when hand-rolling a popover. **And do not "fix" `dialog.tsx` / `alert-dialog.tsx`** — modals are explicitly exempt: *"Do not report it."* |
| Animating `height` | ✅ **Sanctioned exception.** `animate-accordion-down/up` animates `height`. Emil: *"`height` is tolerated only for accordions, where there's no transform equivalent."* | **Not a finding.** Don't let a reviewer "fix" it. |
| Animating a route transition into `chat` | ✅ None today | 100+/day → **no animation, ever**. |
| Animating on every render / per streamed token | ✅ None today | See §2(e). The single easiest way to make the chat feel *worse* while trying to make it feel better. |
| Driving child transforms from a parent CSS variable | ✅ None today | *"Changing a CSS variable on a parent recalculates styles for all children."* Relevant if we ever add swipe-to-dismiss on message rows. |
| Motion `x`/`y`/`scale` shorthands | ✅ N/A (Motion not installed) | If Motion is ever added, full `transform` string only. |

### Recommended execution order

1. **A13** — motion tokens in `@theme`. Nothing else is durable without it.
2. **A10** — retune `tw-animate-css` easing. One line, app-wide.
3. **A2 + A3** — reduced motion + hover gating. Accessibility floor, and A3 is a mobile-first correctness fix.
4. **A1** — the duplicate `<Toaster />`. A live bug, and a two-line diff.
5. **A4** — de-`transition-all` the 10 vendored components.
6. **A5** — the chat waiting state. Highest *felt* impact; do it after the tokens exist so it's built on them.
7. **A6–A9**, then **A11–A12** polish.
8. **Route transitions (§1)** last, behind a spike — it's the only item needing a config flag, a canary type import, a Vitest decision, and a Sonner stylesheet import.

Every one of these carries a **mandatory feel-check** per `improve-animations`: *"Motion can be mechanically correct and still feel wrong."* Set DevTools Animations playback to 10%, toggle `prefers-reduced-motion` in the Rendering panel, spam the toggle to confirm nothing restarts from zero, test the chat on a real mid-range Android over the LAN, and look again the next day.

---

## Sources

**Primary (HIGH confidence — cloned and read in full):**
- `github.com/emilkowalski/skills` @ `--depth 1`, 2026-08-24 — all 20 files, 3,962 lines. Local clone at `<scratchpad>/emil-skills/`.

**Primary (HIGH confidence — verified in this repo's `node_modules`):**
- `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md` — the four-pattern guide, all CSS quoted above.
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/viewTransition.md` — the flag.
- `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md:400-402` — "the App Router in Next.js 16 uses the latest React Canary release… View Transitions".
- `node_modules/next/dist/compiled/react/cjs/react.production.js` — `exports.version = "19.3.0-canary-3f0b9e61-20260317"`, `exports.ViewTransition = REACT_VIEW_TRANSITION_TYPE`.
- `node_modules/@types/react/canary.d.ts:1-21, 49-77` — `ViewTransitionProps`, and the three ways to load canary types.
- `node_modules/tw-animate-css/dist/tw-animate.css` — `--animate-in` default of `.15s var(--tw-ease, ease)`; bare `zoom-in` = `--tw-enter-scale: 0`.

**Codebase findings (HIGH confidence — grep/node, this session):** `app/globals.css`, `app/layout.tsx`, `app/[lang]/chat/{message-list,chat-shell,page}.tsx`, `components/ui/{button,badge,sheet,navigation-menu,skeleton,spinner,sonner}.tsx`, `package.json`, `tsconfig.json`, `next.config.ts`.

**Marked `[ASSUMED]` — needs verification before acting:**
- `@starting-style` browser-support baseline (check caniuse; keep the `data-mounted` fallback meanwhile).
- `motion` (motion.dev) current version and React 19 peer range — run `npm view motion version` + `npm view motion peerDependencies` before any install.
- `next-intl` × React `<ViewTransition>` interaction — untested; spike before enabling the flag.

**Assumptions log**

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | `@starting-style` is safe to ship for D2's mobile audience | §2, §3, Library recs | Entrances silently don't animate on older WebViews — degrades to instant, which is acceptable. **Low risk.** |
| A2 | `motion` is React-19 compatible | Library recs | We're recommending *against* installing it, so the risk is only realised if someone adds it. **Low risk.** |
| A3 | `next-intl` route-segment locale switching won't conflict with `<ViewTransition>` | §1 | A locale switch could produce a jarring or broken transition. **Medium risk** — hence "spike before enabling". |


