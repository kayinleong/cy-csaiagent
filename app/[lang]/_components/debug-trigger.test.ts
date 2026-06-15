/**
 * app/[lang]/_components/debug-trigger.test.ts — easter-egg unlock predicate.
 *
 * Proves isUnlockKeypress only counts a deliberate "e" press and never fires
 * while the user is typing into a form field.
 */

import { describe, it, expect } from 'vitest'
import {
  isUnlockKeypress,
  DEBUG_UNLOCK_KEY,
  DEBUG_UNLOCK_COUNT,
} from './debug-trigger'

describe('debug-trigger constants', () => {
  it('unlocks on "e" pressed 5 times', () => {
    expect(DEBUG_UNLOCK_KEY).toBe('e')
    expect(DEBUG_UNLOCK_COUNT).toBe(5)
  })
})

describe('isUnlockKeypress', () => {
  it('counts the unlock key with no target', () => {
    expect(isUnlockKeypress('e', null)).toBe(true)
  })

  it('is case-insensitive (capslock / Shift)', () => {
    expect(isUnlockKeypress('E', null)).toBe(true)
  })

  it('ignores any other key', () => {
    expect(isUnlockKeypress('a', null)).toBe(false)
    expect(isUnlockKeypress('Enter', null)).toBe(false)
  })

  it('does NOT count while typing in an input', () => {
    expect(isUnlockKeypress('e', { tagName: 'INPUT' })).toBe(false)
  })

  it('does NOT count while typing in a textarea', () => {
    expect(isUnlockKeypress('e', { tagName: 'TEXTAREA' })).toBe(false)
  })

  it('does NOT count while typing in a select', () => {
    expect(isUnlockKeypress('e', { tagName: 'SELECT' })).toBe(false)
  })

  it('does NOT count in a contenteditable element', () => {
    expect(isUnlockKeypress('e', { tagName: 'DIV', isContentEditable: true })).toBe(false)
  })

  it('counts when focus is on a non-editable element', () => {
    expect(isUnlockKeypress('e', { tagName: 'BUTTON' })).toBe(true)
  })
})
