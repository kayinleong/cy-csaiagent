/**
 * app/[lang]/(admin)/integrations/integrations-shell.test.ts — SC-01 no-send invariant (RED scaffold).
 *
 * Phase 6 builds ONLY a static Integrations management SHELL under System & Compliance
 * — a registry/placeholder panel. The v1 hard constraints "No WhatsApp Business API in
 * v1" and "No auto-send, ever" REMAIN IN FORCE (06-CONTEXT lock). The shell must NOT
 * imply or enable any send / auto-send / connect behaviour: no send button, no connect
 * handler, no toggle/Switch, no form, no onClick that wires an outbound action.
 *
 * This is a STATIC SOURCE invariant: it reads the integrations page module source as
 * a string and asserts the forbidden affordance tokens are ABSENT (T-06-03 — compliance
 * breach mitigation). Referencing the forbidden tokens here (send/connect/authorize/
 * onClick/Switch) is intentional — the test asserts they do NOT appear in the shell.
 *
 * RED-BY-DESIGN: `app/[lang]/(admin)/integrations/page.tsx` does not exist yet (SC-01,
 * a later wave) → the source read throws ENOENT and the spec fails. Once SC-01 lands a
 * send-free static panel, the source read succeeds and the absence assertions pass.
 *
 * Logic-only: reads a file from disk; no emulator, no network, no render.
 *
 * Requirements: SC-01, 06-CONTEXT "Integrations" lock, CLAUDE.md "No auto-send, ever".
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Path to the Integrations shell page (created by SC-01; absent in Wave 0 → RED). */
const SHELL_PATH = resolve(
  process.cwd(),
  'app/[lang]/(admin)/integrations/page.tsx',
)

/**
 * Forbidden affordance tokens. The Integrations shell is a static registry only;
 * any of these in its source implies a send / connect / activate path — a hard
 * compliance violation (no WABA, no auto-send). Word-boundary regexes avoid false
 * positives on innocuous substrings.
 */
const FORBIDDEN_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'onClick handler', re: /\bonClick\b/ },
  { label: 'send affordance', re: /\bsend\b/i },
  { label: 'connect affordance', re: /\bconnect\b/i },
  { label: 'authorize affordance', re: /\bauthoriz/i },
  { label: 'enable affordance', re: /\benable\b/i },
  { label: 'Switch toggle', re: /\bSwitch\b/ },
  { label: 'form element', re: /<form\b|\bonSubmit\b/i },
]

function readShellSource(): string {
  // Throws ENOENT in Wave 0 (file absent) — the intended red bar.
  return readFileSync(SHELL_PATH, 'utf8')
}

describe('Integrations shell — no send/auto-send affordance (SC-01, T-06-03)', () => {
  it('the Integrations page source exists (SC-01)', () => {
    // RED today: file does not exist yet (SC-01 lands in a later wave).
    expect(() => readShellSource()).not.toThrow()
  })

  for (const { label, re } of FORBIDDEN_PATTERNS) {
    it(`contains NO ${label} (no-send invariant)`, () => {
      const source = readShellSource()
      expect(re.test(source)).toBe(false)
    })
  }
})
