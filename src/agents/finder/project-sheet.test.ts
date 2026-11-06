/**
 * src/agents/finder/project-sheet.test.ts — the project sheet parsers (quick-kayinleong-103).
 *
 * The write-up shapes here are the live corpus's (2026-11-06), with made-up names, numbers
 * and invite codes.
 */

import { describe, expect, it } from 'vitest'
import {
  buildProjectSheet,
  cleanContactName,
  extractProjectContacts,
  extractWhatsappGroupUrl,
  sheetLinks,
} from './project-sheet'
import { ProjectSheetSchema } from './schema'

const WRITE_UP = [
  'Project PIC: Alex',
  '',
  'Project WhatsApp Link: https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv?mode=ems_copy_c',
  '(Only JOIN the group if you are actively involved in marketing.)',
  '',
  'Quick Facts:',
  'Project Name: Example Residensi',
  'Developer: Example Sdn Bhd',
].join('\n')

describe('extractWhatsappGroupUrl', () => {
  it('returns the invite without its share-tracking query', () => {
    expect(extractWhatsappGroupUrl(WRITE_UP)).toBe('https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv')
  })

  it('reads an invite glued to the note that follows it', () => {
    expect(
      extractWhatsappGroupUrl('Project WhatsApp Link: https://chat.whatsapp.com/Zz9Yy8Xx7Ww6Vv5Uu4(Only JOIN'),
    ).toBe('https://chat.whatsapp.com/Zz9Yy8Xx7Ww6Vv5Uu4')
  })

  it('is null when there is no invite, including a personal wa.me link', () => {
    expect(extractWhatsappGroupUrl('Project WhatsApp Link: (Only JOIN the group if …)')).toBeNull()
    expect(extractWhatsappGroupUrl('Project PIC: Alex https://wa.me/60123456789')).toBeNull()
    expect(extractWhatsappGroupUrl('')).toBeNull()
  })
})

describe('cleanContactName — only the name survives', () => {
  it.each([
    ['Alex', 'Alex'],
    ['Alex Tan', 'Alex Tan'],
    ['Alex 0123456789', 'Alex'],
    ['Alex, +60 12-345 6789', 'Alex'],
    ['Alex  +60123456789', 'Alex'],
    ['Alex Tan | 012-345 6789', 'Alex Tan'],
    ['Alex Tan 012-3456789', 'Alex Tan'],
    ['Alex https://wa.me/60123456789', 'Alex'],
    ['Alex Tan https://wa.link/a1b2c', 'Alex Tan'],
    ['Alex (L3)', 'Alex'],
    ['Alex Tan (HP 01 2345)', 'Alex Tan'],
    ['Alex, 012 345 6789 / Ben Lee', 'Alex / Ben Lee'],
    ['Alex, +60 12-345 6789 & Ben Lee, +60 12-987 6543', 'Alex & Ben Lee'],
  ])('%s → %s', (raw, name) => {
    const cleaned = cleanContactName(raw)
    expect(cleaned).toBe(name)
    expect(cleaned).not.toMatch(/\d/)
  })

  it('rejects a value with no name in it', () => {
    expect(cleanContactName('')).toBeNull()
    expect(cleanContactName(' +60 12-345 6789 ')).toBeNull()
    expect(cleanContactName('https://wa.me/60123456789')).toBeNull()
  })
})

describe('extractProjectContacts', () => {
  it('reads PIC, leader and co-leader lines in order, names only', () => {
    const text = [
      'Project Leader: Alex 0123456789',
      'Project co-leader: Ben, +60 12-345 6789',
      'Co-leader: Cara Lim',
      'PIC: Dan Ong 012-3456789',
      'Project PIC: Alex',
    ].join('\n')
    expect(extractProjectContacts(text)).toEqual([
      { role: 'leader', name: 'Alex' },
      { role: 'co_leader', name: 'Ben' },
      { role: 'co_leader', name: 'Cara Lim' },
      { role: 'pic', name: 'Dan Ong' },
      { role: 'pic', name: 'Alex' },
    ])
  })

  it('skips a label with nothing after it, and repeats', () => {
    const text = ['Project PIC:', 'Project WhatsApp Link: https://chat.whatsapp.com/x', 'PIC: Alex', 'PIC: Alex'].join('\n')
    expect(extractProjectContacts(text)).toEqual([{ role: 'pic', name: 'Alex' }])
  })

  it('does not read a sentence that only mentions a leader', () => {
    expect(extractProjectContacts('Developer: a market leader in KL')).toEqual([])
  })
})

describe('sheetLinks', () => {
  const drive = (id: string) => `https://drive.google.com/drive/folders/${id}`
  it('keeps the Skool links, project links first, and leaves out WhatsApp archive media', () => {
    const links = sheetLinks([
      { type: 'whatsapp-media', url: 'https://firebasestorage.googleapis.com/v0/b/x/o/a.jpg' },
      { type: 'reels', url: drive('r') },
      { type: 'project-info', url: drive('p') },
      { type: 'fb-ads', url: drive('f') },
      { type: 'drive', url: drive('d') },
      { type: 'fb-ads', url: drive('f') },
      { type: 'project-info', url: 'collateral/pid/info.pdf' },
    ])
    expect(links).toEqual([
      { type: 'project-info', url: drive('p'), group: 'project' },
      { type: 'drive', url: drive('d'), group: 'project' },
      { type: 'reels', url: drive('r'), group: 'marketing' },
      { type: 'fb-ads', url: drive('f'), group: 'marketing' },
    ])
  })

  it('caps the list at 12', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ type: 'drive', url: drive(`f${i}`) }))
    expect(sheetLinks(many)).toHaveLength(12)
  })
})

describe('buildProjectSheet', () => {
  it('builds a sheet the client schema accepts', () => {
    const sheet = buildProjectSheet(
      { projectId: 'pid-1', name: 'Example Residensi', description: WRITE_UP },
      [{ type: 'project-info', url: 'https://drive.google.com/drive/folders/p' }],
    )
    expect(sheet).toEqual({
      projectId: 'pid-1',
      name: 'Example Residensi',
      contacts: [{ role: 'pic', name: 'Alex' }],
      whatsappGroupUrl: 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv',
      links: [{ type: 'project-info', url: 'https://drive.google.com/drive/folders/p', group: 'project' }],
    })
    expect(ProjectSheetSchema.safeParse(sheet).success).toBe(true)
  })

  it('a write-up with none of it gives an empty sheet, not an error', () => {
    const sheet = buildProjectSheet({ projectId: 'pid-2', name: 'Bare', description: '' }, [])
    expect(sheet.contacts).toEqual([])
    expect(sheet.whatsappGroupUrl).toBeNull()
    expect(sheet.links).toEqual([])
  })
})

describe('ProjectSheetSchema rejects what the client must never render', () => {
  const base = { projectId: 'p', name: 'n' }
  it('a WhatsApp URL that is not a group invite', () => {
    expect(ProjectSheetSchema.safeParse({ ...base, whatsappGroupUrl: 'https://wa.me/60123456789' }).success).toBe(false)
    expect(ProjectSheetSchema.safeParse({ ...base, whatsappGroupUrl: 'javascript:alert(1)' }).success).toBe(false)
  })
  it('a link that is not a URL', () => {
    expect(
      ProjectSheetSchema.safeParse({ ...base, links: [{ type: 'drive', url: 'collateral/x.pdf', group: 'project' }] })
        .success,
    ).toBe(false)
  })
})
