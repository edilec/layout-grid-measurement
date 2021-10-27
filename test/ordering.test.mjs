/**
 * Ordering is observable, and it is pinned behaviourally.
 *
 * A source scan for `.localeCompare(` is not a determinism test: substituting
 * `Intl.Collator` produces identical collation drift with different source
 * text. So the inputs here are chosen because code-unit order and collation
 * order genuinely disagree about them -- `Z` before `a`, `a-b` before `a_b`,
 * `README` before `assets` -- and the exact emitted order is asserted.
 */

import { strict as assert } from 'node:assert'
import test from 'node:test'

import { byCodeUnit, compareFindings } from '../src/index.mjs'
import { box, contractDocument, measureFixture, measurementDocument, reportFrom, withWideBoxes } from './helpers.mjs'

const NAMES = Object.freeze(['assets', 'a_b', 'a-card', 'a-b', 'Z-card', 'README'])

/** Every name spans columns 1-2, and every box is misaligned at both widths. */
function fixtureWithNames() {
  const contract = contractDocument((document) => {
    document.elements = [...NAMES]
    document.widths[0].spans = Object.fromEntries(NAMES.map((name) => [name, { start: 1, end: 2 }]))
    document.widths[1].elements = [...NAMES]
    return document
  })
  const measurements = measurementDocument((document) => {
    document.routes[0].widths[0].boxes = NAMES.map((name, index) => box(name, 46, index * 300, 180, 200))
    document.routes[0].widths[1].boxes = NAMES.map((name, index) => box(name, 20, index * 300, 343, 200))
    return document
  })
  return { contract, measurements }
}

test('findings are emitted in code-unit order, which differs from collation here', async () => {
  const { contract, measurements } = fixtureWithNames()
  const report = reportFrom(await measureFixture(measurements, contract))

  const wide = report.findings
    .filter((finding) => finding.location.pointer.includes('/widths/wide/'))
    .map((finding) => finding.location.pointer.split('/').at(-1))

  assert.deepEqual([...new Set(wide)], ['README', 'Z-card', 'a-b', 'a-card', 'a_b', 'assets'])

  const collated = [...NAMES].sort((a, b) => new Intl.Collator('en').compare(a, b))
  assert.notDeepEqual(collated, [...new Set(wide)], 'the fixture is only a test if the two orders disagree')
})

test('a width name orders before an element name, because the pointer is compared first', async () => {
  const { contract, measurements } = fixtureWithNames()
  const report = reportFrom(await measureFixture(measurements, contract))
  const widths = report.findings.map((finding) => finding.location.pointer.split('/')[4])
  assert.deepEqual([...new Set(widths)], ['mobile', 'wide'], 'mobile precedes wide by code unit')
})

test('the sort keys apply in order: file, then pointer, then rule, then message', () => {
  const finding = (file, pointer, ruleId, message) => ({ ruleId, severity: 'error', message, location: { file, pointer } })

  assert.ok(compareFindings(finding('a.json', '/z', 'z-rule', 'z'), finding('b.json', '/a', 'a-rule', 'a')) < 0)
  assert.ok(compareFindings(finding('a.json', '/a', 'z-rule', 'z'), finding('a.json', '/b', 'a-rule', 'a')) < 0)
  assert.ok(compareFindings(finding('a.json', '/a', 'a-rule', 'z'), finding('a.json', '/a', 'b-rule', 'a')) < 0)
  assert.ok(compareFindings(finding('a.json', '/a', 'a-rule', 'a'), finding('a.json', '/a', 'a-rule', 'b')) < 0)
  assert.equal(compareFindings(finding('a.json', '/a', 'a-rule', 'a'), finding('a.json', '/a', 'a-rule', 'a')), 0)
})

test('two findings on one element are ordered by their rule id', async () => {
  const measurements = measurementDocument(withWideBoxes([
    box('summary-card', 40, 100, 384, 200),
    box('alerts-card', 460, 100, 384, 200),
  ]))
  const report = reportFrom(await measureFixture(measurements, contractDocument()))
  const onAlerts = report.findings
    .filter((finding) => finding.location.pointer.endsWith('/alerts-card'))
    .map((finding) => finding.ruleId)

  assert.deepEqual(onAlerts, ['element-misaligned-left', 'element-misaligned-right', 'gutter-mismatch'])
})

test('byCodeUnit orders by code unit and nothing else', () => {
  assert.equal(byCodeUnit('Z', 'a'), -1, 'Z (0x5A) precedes a (0x61)')
  assert.equal(byCodeUnit('a-b', 'a_b'), -1, '- (0x2D) precedes _ (0x5F)')
  // The pair that produced a real ordering difference in this catalog.
  assert.equal(byCodeUnit('MAX_DUPLICATE_URLS', 'MAX_DUPLICATE_URL_ENTRIES'), -1, 'S (0x53) precedes _ (0x5F)')
  assert.ok(
    new Intl.Collator('en').compare('MAX_DUPLICATE_URLS', 'MAX_DUPLICATE_URL_ENTRIES') > 0,
    'collation puts them the other way round, which is the whole point',
  )
  assert.equal(byCodeUnit('same', 'same'), 0)
})

test('the same inputs produce byte-identical stdout twice', async () => {
  const { contract, measurements } = fixtureWithNames()
  const first = await measureFixture(measurements, contract)
  const second = await measureFixture(measurements, contract)
  assert.equal(first.stdout, second.stdout)
})
