// Score run 3 against the Excel (the normalized client sheet the import used).
// usage: node score3.js <results.json> <normalized.json> <new.json> <out.json>
const fs = require('fs')
const [resultsPath, normPath, newPath, outPath] = process.argv.slice(2)
const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'))
const sheetProjects = [
  ...JSON.parse(fs.readFileSync(normPath, 'utf8')).projects,
  ...JSON.parse(fs.readFileSync(newPath, 'utf8')).projects,
]
const heldBack = [
  ...JSON.parse(fs.readFileSync(normPath, 'utf8')).heldBack,
  ...JSON.parse(fs.readFileSync(newPath, 'utf8')).heldBack,
]

const FIELDS = [
  ['area', 'Area', /\b(area|location)\b/i, 'Area'],
  ['developer', 'Developer', /\bdeveloper\b/i, 'Developer'],
  ['landTitle', 'Land Title', /\b(land title|title)\b/i, 'Land Title'],
  ['maintenanceFee', 'Maintenance Fee', /\bmaintenance\b/i, 'Maintenance Fee'],
  ['tenure', 'Tenure', /\btenure\b/i, 'Tenure'],
  ['totalUnits', 'Total Units', /\b(total units|units)\b/i, 'Total Units'],
  ['floors', 'Total Floors', /\b(floors|storeys|stories)\b/i, 'Total Floors/Storeys'],
  ['completion', 'Completion / VP', /\b(completion|vacant possession|vp)\b/i, 'Expected Completion/Vacant Possession (VP)'],
  ['topReasons', 'Top Reasons Why', /\b(top reasons|reasons)\b/i, 'Top Reasons Why'],
  ['furnishing', 'Furnishing', /\bfurnish/i, 'Furnishing'],
  ['carPark', 'Car Park Allocation', /\b(car ?park|parking)\b/i, 'Car Park Allocation'],
]
const GENERIC = new Set(('the and of in with for a to is at by on or as an be per are from date completion expected vp vacant possession ' +
  'total units unit storeys storey floors floor approx approximately about est estimated').split(' '))
const NOT_ON_RECORD = /not on record|not (?:available|stated|provided|specified|listed)|no (?:record|information|data)|being confirmed|not confirmed|check with d2|n\/a\b/i

const stripMd = (s) => String(s ?? '').replace(/\*\*|__|`|\[KB:[^\]]+\]/g, '').replace(/ /g, ' ')
const stem = (w) => w.replace(/(ies)$/, 'y').replace(/(?<=\w{3})s$/, '')
function tokens(s) {
  const t = stripMd(s).toLowerCase().replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/rm(?=\d)/g, ' ')
  return [...new Set((t.match(/[a-z]+|\d+(?:\.\d+)?/g) || []).filter((w) => !GENERIC.has(w) && (w.length >= 2 || /\d/.test(w))).map(stem))]
}
function coverage(expected, text) {
  const exp = tokens(expected)
  if (!exp.length) return { ratio: 1, nums: true, missing: [] }
  const have = new Set(tokens(text))
  const has = (w) => have.has(w) || [...have].some((h) => h.length >= 4 && w.length >= 4 && (h.startsWith(w) || w.startsWith(h)))
  const missing = exp.filter((w) => !has(w))
  const numsExp = exp.filter((w) => /^\d/.test(w))
  return { ratio: 1 - missing.length / exp.length, nums: numsExp.every(has), missing }
}

/** The answer's text for one field: the first line naming it, plus its indented continuation lines. */
function fieldText(lines, re) {
  const head = (l) => stripMd(l).replace(/^\s*(?:[-*•]|\d+[.)]|#+)?\s*/, '').slice(0, 30)
  const leads = (l) => { const m = head(l).match(re); return !!m && m.index === 0 }
  const order = [...lines.keys()].sort((a, b) => Number(!leads(lines[a])) - Number(!leads(lines[b])) || a - b)
  for (const i of order) {
    const l = stripMd(lines[i])
    if (/^\s*\|/.test(l)) continue // a layout-table row is not the field line
    if (!re.test(l)) continue
    const out = [l]
    const own = l.includes(':') ? l.slice(l.indexOf(':') + 1).replace(/[\s:*#\-]/g, '') : ''
    for (let j = i + 1; j < lines.length && out.length < 25; j++) {
      const n = lines[j]
      if (/^\s*(#|---)/.test(n)) break
      if (!own) {
        if (n.trim() === '' && out.length > 1) break
        if (n.trim() !== '') out.push(stripMd(n))
      } else if (/^\s{2,}[-*•]|^\s{2,}\S/.test(n)) out.push(stripMd(n))
      else break
    }
    return out.join(' \n ')
  }
  return null
}

/** Every RM amount in a piece of text, in RM. */
function amounts(text) {
  const out = []
  const re = /(?:rm\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(million|mil|m(?![a-z])|k(?![a-z]))?/gi
  for (const m of stripMd(text).matchAll(re)) {
    let v = Number(m[1].replace(/,/g, ''))
    const u = (m[2] || '').toLowerCase()
    if (u.startsWith('mil') || u === 'm') v *= 1e6
    else if (u === 'k') v *= 1e3
    if (v >= 50_000) out.push(v)
  }
  return out
}
const near = (a, b) => Math.abs(a - b) <= Math.max(1000, b * 0.005)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function answerOf(r) {
  const t = r.text || ''
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a >= 0 && b > a) {
    try { const o = JSON.parse(t.slice(a, b + 1)); return { envelope: o, answer: String(o.answer ?? o.message ?? '') } } catch {}
  }
  return { envelope: null, answer: t }
}

function scoreUnits(p, answer) {
  const lines = answer.split('\n').map(stripMd)
  const cols = { Size: [0, 0, []], Rooms: [0, 0, []], 'Nett Price': [0, 0, []], 'Gross Price': [0, 0, []] }
  const bump = (col, ok, what) => { cols[col][1]++; if (ok) cols[col][0]++; else cols[col][2].push(what) }
  for (const u of p.units) {
    const label = u.label.replace(/^Type\s+/i, '')
    const re = new RegExp(`(^|[^A-Za-z0-9])(type\\s+)?${esc(label)}(?![A-Za-z0-9])`, 'i')
    const rows = []
    lines.forEach((l, i) => {
      if (!re.test(l)) return
      rows.push(l)
      const indent = l.match(/^\s*/)[0].length
      for (let j = i + 1; j < lines.length && lines[j].trim() !== '' && lines[j].match(/^\s*/)[0].length > indent; j++) rows.push(lines[j])
    })
    const row = rows.join(' \n ')
    const held = new Set(u.held || [])
    if (!rows.length) {
      for (const col of Object.keys(cols)) if (col !== 'Rooms' || u.bedrooms != null) bump(col, false, `${u.label}: not listed`)
      continue
    }
    if (u.sizeSqft != null && !held.has('Size')) {
      const sizes = (row.replace(/(\d),(?=\d{3})/g, '$1').match(/\d{3,5}(?=\s*(?:sq|sf|ft|s\.f))/gi) || []).map(Number)
      bump('Size', sizes.includes(u.sizeSqft) || row.replace(/,/g, '').includes(String(u.sizeSqft)), `${u.label}: size ${u.sizeSqft}`)
    }
    if (u.bedrooms != null) {
      bump('Rooms', new RegExp(`\\b${u.bedrooms}\\b`).test(row.replace(/\d{3,}/g, '')) || (u.bedrooms === 0 && /studio/i.test(row)), `${u.label}: ${u.bedrooms} bed`)
    }
    const got = amounts(row)
    const soldOutSaid = /sold\s*out/i.test(row)
    if (u.soldOut) {
      bump('Nett Price', soldOutSaid, `${u.label}: should say sold out`)
    } else {
      if (u.nettMinRM != null && !held.has('Nett')) bump('Nett Price', got.some((v) => near(v, u.nettMinRM)) && (u.nettMaxRM == null || got.some((v) => near(v, u.nettMaxRM))), `${u.label}: nett ${u.nettMinRM}${u.nettMaxRM && u.nettMaxRM !== u.nettMinRM ? '-' + u.nettMaxRM : ''}`)
      if (u.grossMinRM != null && !held.has('Gross')) bump('Gross Price', got.some((v) => near(v, u.grossMinRM)) && (u.grossMaxRM == null || got.some((v) => near(v, u.grossMaxRM))), `${u.label}: gross ${u.grossMinRM}${u.grossMaxRM && u.grossMaxRM !== u.grossMinRM ? '-' + u.grossMaxRM : ''}`)
      if (u.psfRM != null) bump('Gross Price', new RegExp(`(?<!\\d)${u.psfRM}(?!\\d)`).test(row.replace(/,/g, '')), `${u.label}: ${u.psfRM} psf`)
    }
  }
  const out = {}
  for (const [col, [ok, n, miss]] of Object.entries(cols)) {
    const heldHere = p.units.some((u) => (u.held || []).includes(col.split(' ')[0]))
    out[col] = n === 0 ? (heldHere ? 'HELD' : '—') : ok === n ? 'PASS' : ok === 0 ? 'NOT STATED' : 'PARTIAL'
    if (miss.length) out[col + '_detail'] = `${ok}/${n}; missing: ${miss.slice(0, 6).join('; ')}${miss.length > 6 ? ` (+${miss.length - 6})` : ''}`
  }
  return out
}

const report = []
for (const r of Object.values(results)) {
  if (!/^P/.test(r.id)) continue
  const p = sheetProjects.find((x) => x.sheetName === r.name)
  const row = { id: r.id, name: r.name, cells: {}, details: {}, notes: [] }
  if (!p) { row.overall = 'NO SHEET ROW'; report.push(row); continue }
  row.inventoryName = p.inventoryName
  if (r.error) { row.overall = 'ERROR'; row.notes.push(r.error); report.push(row); continue }
  const { answer } = answerOf(r)
  row.answerChars = answer.length
  const detail = (r.calls || []).find((c) => c.tool === 'projectDetail' && c.output && c.output.found)
  row.detailProject = detail ? detail.output.name : null
  row.factSheetAttached = !!(detail && /D2 project facts/.test(detail.output.kbContext || ''))
  if (!detail) row.notes.push('projectDetail not called or found nothing')
  else if (detail.output.name !== p.inventoryName) row.notes.push(`projectDetail opened ${detail.output.name}`)

  const u = scoreUnits(p, answer)
  for (const col of ['Size', 'Rooms', 'Nett Price', 'Gross Price']) {
    row.cells[col] = u[col]
    if (u[col + '_detail']) row.details[col] = u[col + '_detail']
  }
  const lines = answer.split('\n')
  for (const [key, col, re, heldCol] of FIELDS) {
    const exp = p.facts[key]
    const isHeld = heldBack.some((h) => h.docId === p.docId && h.unit === null && h.column === heldCol && h.reason && !/contact details removed/.test(h.reason))
    if (exp == null || String(exp).trim() === '') { row.cells[col] = isHeld ? 'HELD' : '—'; continue }
    const ft = fieldText(lines, re)
    const long = ['topReasons', 'furnishing', 'carPark'].includes(key)
    const inField = ft ? coverage(exp, ft) : null
    const inAll = coverage(exp, answer)
    // The Excel value without its bracketed asides, cut at a new line or a dash aside. Text
    // after a bracket ("... + Mitsui Fudosan") stays, so a dropped second party still counts.
    const core = String(exp).replace(/\([^)]*\)/g, ' ').split(/\n|\s+[—–]\s+|\s+-\s+/)[0].replace(/\s+/g, ' ').replace(/[\s:;,]+$/, '').trim()
    const coreCov = ft && !long && core.length >= 2 && core !== exp ? coverage(core, ft) : null
    // Long list fields: each Excel item's heading (a numbered or bulleted line) must be there.
    const items = long ? String(exp).split('\n').map((l) => l.match(/^\s*(?:\d+[.)]\s*|[-•*]\s+)(.*)/)).filter(Boolean).map((m) => m[1]) : []
    if (items.length >= 2) {
      const block = ft ?? answer
      const found = items.filter((it) => coverage(it, block).ratio >= 0.5)
      row.cells[col] = found.length / items.length >= 0.75 ? 'PASS' : found.length ? 'PARTIAL' : (!ft || NOT_ON_RECORD.test(ft) ? 'NOT STATED' : 'DIFFERS')
      if (row.cells[col] !== 'PASS' || found.length < items.length) row.details[col] = `${found.length}/${items.length} Excel items given; missing: ${items.filter((it) => !found.includes(it)).map((x) => x.slice(0, 50)).join('; ')}`
      continue
    }
    if (inField && inField.ratio >= (long ? 0.5 : 0.6) && inField.nums) row.cells[col] = 'PASS'
    else if (coreCov && coreCov.ratio >= 0.8 && coreCov.nums) { row.cells[col] = 'PASS'; row.details[col] = `core value matches ("${core.slice(0, 60)}"); the Excel's bracketed or extra wording omitted` }
    else if (inAll.ratio >= (long ? 0.6 : 0.85) && inAll.nums) row.cells[col] = 'PASS'
    else if (!ft || NOT_ON_RECORD.test(ft)) { row.cells[col] = 'NOT STATED'; row.details[col] = `Excel: ${String(exp).slice(0, 140)}` }
    else { row.cells[col] = 'DIFFERS'; row.details[col] = `Excel: ${String(exp).slice(0, 140)} | Bot: ${ft.slice(0, 200)}` }
  }
  const vals = Object.values(row.cells)
  row.overall = vals.includes('DIFFERS') ? 'Check' : vals.some((v) => v === 'NOT STATED' || v === 'PARTIAL') ? 'Partial' : 'Pass'
  report.push(row)
}
report.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
fs.writeFileSync(outPath, JSON.stringify(report, null, 1))
const tally = {}
for (const r of report) tally[r.overall] = (tally[r.overall] || 0) + 1
const cellTally = {}
for (const r of report) for (const v of Object.values(r.cells)) cellTally[v] = (cellTally[v] || 0) + 1
console.log('overall', tally, '\ncells', cellTally)
for (const r of report) if (r.overall !== 'Pass') {
  const bad = Object.entries(r.cells).filter(([, v]) => ['DIFFERS', 'NOT STATED', 'PARTIAL'].includes(v)).map(([k, v]) => `${k}=${v}`)
  console.log(`${r.id} ${r.name.slice(0, 34).padEnd(34)} ${r.overall.padEnd(8)} ${bad.join(', ')} ${r.notes.join('; ')}`)
}
