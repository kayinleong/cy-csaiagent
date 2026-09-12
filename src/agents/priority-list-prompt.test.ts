/**
 * src/agents/priority-list-prompt.test.ts — admin Priority List injection, and the
 * Finder's two-format output contract (quick-kayinleong-090).
 *
 * One feature spanning two agents, so one file. The Finder and the Coach receive the
 * SAME admin text with deliberately DIFFERENT framing — the Finder may act on it, the
 * Coach may only avoid contradicting it — and that asymmetry is the thing most likely
 * to be lost in a later edit, so it is asserted directly.
 */

import { describe, it, expect } from 'vitest'
import { buildFinderSystemPrompt } from './finder/prompt'
import { buildCoachSystemPrompt } from './coach/prompt'

const ADMIN_TEXT = 'Always lead with Royal Suites in Damansara Heights, then Accent PJ.'

describe('Finder — Priority List injection', () => {
  it('omits the section entirely when no priority list is configured', () => {
    const prompt = buildFinderSystemPrompt()
    expect(prompt).not.toContain('D2 Priority List')
  })

  it('omits the section for empty and whitespace-only text', () => {
    expect(buildFinderSystemPrompt({ priorityList: '' })).not.toContain('D2 Priority List')
    expect(buildFinderSystemPrompt({ priorityList: '   \n ' })).not.toContain('D2 Priority List')
  })

  it('injects the admin text verbatim', () => {
    const prompt = buildFinderSystemPrompt({ priorityList: ADMIN_TEXT })
    expect(prompt).toContain('## D2 Priority List')
    expect(prompt).toContain(ADMIN_TEXT)
  })

  it('states that the list only ORDERS what the tools returned — it cannot add a project', () => {
    // This is the sentence standing between an admin preference and a fabrication.
    const prompt = buildFinderSystemPrompt({ priorityList: ADMIN_TEXT })
    expect(prompt).toContain('cannot add a project the tool did not return')
    expect(prompt).toContain('cannot revive a sold-out one')
  })

  it('keeps project NAMES pinned to the tool result even when the admin spells one differently', () => {
    const prompt = buildFinderSystemPrompt({ priorityList: ADMIN_TEXT })
    expect(prompt).toContain('Never let the priority text change how a project is NAMED')
  })

  it('places the priority section BEFORE the Output Format block', () => {
    // The JSON contract is recency-sensitive; admin free text landing after it was
    // folding itself into the output shape.
    const prompt = buildFinderSystemPrompt({ priorityList: ADMIN_TEXT })
    expect(prompt.indexOf('## D2 Priority List')).toBeLessThan(prompt.indexOf('## Output Format'))
  })

  it('coexists with lead context without either section clobbering the other', () => {
    const prompt = buildFinderSystemPrompt({
      leadContext: { criteria: { priceMax: 800000 } },
      priorityList: ADMIN_TEXT,
    })
    expect(prompt).toContain('## Returning Lead Context')
    expect(prompt).toContain('## D2 Priority List')
  })
})

describe('Finder — the single-project DETAIL format', () => {
  const prompt = buildFinderSystemPrompt()

  it('mandates the format and forbids summarising', () => {
    expect(prompt).toContain('## The single-project DETAIL format (MANDATORY - use it exactly)')
    expect(prompt).toContain('DO NOT SUMMARISE')
  })

  it('carries all 14 fact-sheet labels, in the order the source document defines', () => {
    const labels = [
      'Project Name', 'Location', 'Developer', 'Land Tenure', 'Land Title',
      'No. of Blocks', 'Total Units', 'Size Built-up', 'No. of Bedroom', 'Carpark',
      'Price Value', 'Price Psf', 'Maintenance Fee', 'Completion',
    ]
    expect(prompt).toContain(labels.join(', ') + '.')
  })

  it('requires a TABLE for the fact sheet, because plain lines do not survive rendering', () => {
    // react-markdown runs remark-gfm only — no remark-breaks — so single newlines
    // collapse into one paragraph. See app/[lang]/chat/markdown-message.tsx.
    expect(prompt).toContain('two-column markdown table')
    expect(prompt).toContain('It must be a TABLE')
  })

  it('names the other two sections with the exact headings the source document uses', () => {
    expect(prompt).toContain('### 2. LAYOUT SUMMARY BREAKDOWN')
    expect(prompt).toContain("### 3. TOP REASONS WHY (followed by the project's real name)")
  })

  it('requires a missing value to be declared, never guessed or borrowed', () => {
    expect(prompt).toContain('not on record')
    expect(prompt).toContain('Emit all 14 rows every time')
    expect(prompt).toContain('never carry a value across from a comparable project')
  })

  it('forbids synthesising a layout table from the project-wide size envelope', () => {
    expect(prompt).toContain('No layout table on record')
    expect(prompt).toContain('that span is the outer envelope of the whole project, not a layout')
  })

  it('routes a shortlist to matches, never to the prose answer field', () => {
    // A shortlist written into "answer" replaces the rendered result table with an essay.
    expect(prompt).toContain('goes in matches, NEVER in "answer"')
  })
})

describe('Coach — Priority List injection is AWARENESS, not an instruction to act', () => {
  it('omits the section when unset', () => {
    expect(buildCoachSystemPrompt()).not.toContain('D2 Priority List')
    expect(buildCoachSystemPrompt(undefined, '')).not.toContain('D2 Priority List')
  })

  it('injects the admin text verbatim when set', () => {
    const prompt = buildCoachSystemPrompt(undefined, ADMIN_TEXT)
    expect(prompt).toContain('## D2 Priority List')
    expect(prompt).toContain(ADMIN_TEXT)
  })

  it('tells the Coach it is context, NOT something to act on', () => {
    // The Coach has no inventory tools. Acting on this text means naming projects with
    // zero grounding — the exact failure the grounding rules exist to prevent.
    const prompt = buildCoachSystemPrompt(undefined, ADMIN_TEXT)
    expect(prompt).toContain('It is NOT something you act on')
    expect(prompt).toContain('you never produce a property shortlist')
  })

  it('routes any real recommendation request to the Finder', () => {
    const prompt = buildCoachSystemPrompt(undefined, ADMIN_TEXT)
    expect(prompt).toContain('tell them to use Finder')
  })

  it('does not present the list as inventory', () => {
    const prompt = buildCoachSystemPrompt(undefined, ADMIN_TEXT)
    expect(prompt).toContain('Never present this list as inventory')
  })

  it('leaves the Coach prose contract intact — injection must not turn it into a JSON agent', () => {
    const prompt = buildCoachSystemPrompt(undefined, ADMIN_TEXT)
    expect(prompt).toContain('Do NOT return JSON')
    expect(prompt.indexOf('## D2 Priority List')).toBeLessThan(prompt.indexOf('## Output format'))
  })

  it('still injects journey context alongside the priority list', () => {
    const prompt = buildCoachSystemPrompt(
      { journeyStage: 'week-1', currentCheckpoint: 'ren-tag' },
      ADMIN_TEXT,
    )
    expect(prompt).toContain('## Current Journey Position')
    expect(prompt).toContain('## D2 Priority List')
  })
})
