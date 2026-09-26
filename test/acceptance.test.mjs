/**
 * The acceptance criteria, item by item.
 *
 *   "A misaligned card boundary fails with coordinates; a documented mobile
 *    stacking change passes."
 *
 * Both halves are driven through the real CLI, so what is asserted is what a
 * consumer observes: the exit code, the report on stdout, and the coordinates
 * in the finding.
 */

import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  WIDE,
  box,
  contractDocument,
  measureFixture,
  measurementDocument,
  reportFrom,
  ruleIds,
  withMobileBoxes,
  withWideBoxes,
} from './helpers.mjs'

test('a misaligned card boundary fails, and the finding carries the coordinates', async () => {
  const measurements = measurementDocument(withWideBoxes([
    box('summary-card', WIDE.left, 100, 384, 200),
    box('alerts-card', 454, 100, 384, 200), // six past the left edge of column 5
  ]))

  const result = await measureFixture(measurements, contractDocument())
  const report = reportFrom(result)

  assert.equal(result.code, 1, 'a misaligned boundary is a failed contract, not an incomplete run')
  assert.equal(report.status, 'fail')

  const left = report.findings.find((finding) => finding.ruleId === 'element-misaligned-left')
  assert.ok(left !== undefined, `expected element-misaligned-left, got ${ruleIds(report)}`)
  assert.equal(left.severity, 'error')
  assert.equal(
    left.message,
    'The left edge of alerts-card is at 454 at width wide, 6 past the expected 448, '
    + 'which is the left edge of column 5.',
  )
  assert.equal(left.evidence, 'left=454 expected=448 delta=6 tolerance=0.5')
  assert.equal(left.location.pointer, '/routes/dashboard/widths/wide/boxes/alerts-card')

  const right = report.findings.find((finding) => finding.ruleId === 'element-misaligned-right')
  assert.equal(right.evidence, 'right=838 expected=832 delta=6 tolerance=0.5')

  const gutter = report.findings.find((finding) => finding.ruleId === 'gutter-mismatch')
  assert.equal(gutter.evidence, 'gap=30 gutter=24 delta=6', 'the gutter it was pushed out of is reported too')
})

test('a card on its column edges does not fail, so the misalignment test is not tautological', async () => {
  const result = await measureFixture(measurementDocument(), contractDocument())
  assert.equal(result.code, 0)
  assert.equal(reportFrom(result).status, 'pass')
  assert.equal(reportFrom(result).summary.checked, 4)
})

test('a boundary inside the contract tolerance is not a finding, and one outside it is', async () => {
  const within = measurementDocument(withWideBoxes([
    box('summary-card', WIDE.left, 100, 384, 200),
    box('alerts-card', 448.5, 100, 383.5, 200),
  ]))
  assert.equal((await measureFixture(within, contractDocument())).code, 0, '0.5 off is within a tolerance of 0.5')

  const outside = measurementDocument(withWideBoxes([
    box('summary-card', WIDE.left, 100, 384, 200),
    box('alerts-card', 448.6, 100, 383.4, 200),
  ]))
  const report = reportFrom(await measureFixture(outside, contractDocument()))
  // 0.6 off moves the edge and widens the gutter by the same amount; both are
  // outside the tolerance, and both are true.
  assert.deepEqual(ruleIds(report), ['element-misaligned-left', 'gutter-mismatch'])
})

test('a documented mobile stacking change passes', async () => {
  // The same two cards are side by side at 1280 and stacked full width at 375.
  // The contract declares mobile as stacked, so the change is expected.
  const result = await measureFixture(measurementDocument(), contractDocument())
  const report = reportFrom(result)

  assert.equal(result.code, 0)
  assert.equal(report.status, 'pass')
  assert.deepEqual(report.findings, [])
})

test('the same stacking is a failure at a width the contract still calls a grid', async () => {
  // Nothing about the measurements changed. Only the contract did: mobile is
  // now declared a grid of two columns, and stacked full-width cards do not fit
  // it. If the tool carried an expectation between widths, or guessed that a
  // narrow viewport stacks, these two runs would agree.
  const gridAtMobile = contractDocument((document) => {
    document.widths[1] = {
      name: 'mobile',
      viewportWidth: 375,
      stacking: 'grid',
      grid: { columns: 2, gutter: 8, margin: 16 },
      spans: {
        'summary-card': { start: 1, end: 1 },
        'alerts-card': { start: 2, end: 2 },
      },
    }
    return document
  })

  const result = await measureFixture(measurementDocument(), gridAtMobile)
  const report = reportFrom(result)

  assert.equal(result.code, 1)
  assert.equal(report.status, 'fail')
  assert.ok(ruleIds(report).includes('element-misaligned-right'), ruleIds(report).join(', '))
})

test('a stacked width refuses to carry spans, so it cannot read as coverage it does not perform', async () => {
  const contradictory = contractDocument((document) => {
    document.widths[1].spans = { 'summary-card': { start: 1, end: 1 } }
    return document
  })
  const result = await measureFixture(measurementDocument(), contradictory)
  assert.equal(result.code, 2)
  assert.equal(result.stdout, '', 'a contradictory contract is a configuration error')
  assert.match(result.stderr, /declared stacked, so a span would not be checked/u)
})

test('a card that stops short of the content width at a stacked width fails with coordinates', async () => {
  const measurements = measurementDocument(withMobileBoxes([
    box('summary-card', 16, 100, 343, 200),
    box('alerts-card', 16, 320, 300, 200),
  ]))
  const report = reportFrom(await measureFixture(measurements, contractDocument()))
  const finding = report.findings.find((entry) => entry.ruleId === 'stacked-element-not-full-width')

  assert.ok(finding !== undefined, ruleIds(report).join(', '))
  assert.equal(finding.evidence, 'width=300 contentWidth=343 delta=-43')
  assert.match(finding.message, /300 wide at width mobile, which stacks/u)
})
