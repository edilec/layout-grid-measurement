/** The comparisons themselves, driven through the library entry point. */

import { strict as assert } from 'node:assert'
import test from 'node:test'

import { compareLayout, readMeasurements, validateContract } from '../src/index.mjs'
import {
  NOW,
  box,
  contractDocument,
  measurementDocument,
  withMobileBoxes,
  withWideBoxes,
} from './helpers.mjs'

function compare(measurementAlter = (d) => d, contractAlter = (d) => d) {
  const contract = validateContract(contractDocument(contractAlter))
  const structure = readMeasurements(measurementDocument(measurementAlter), 'measurements.json')
  assert.equal(structure.ok, true, 'the fixture measurements must be structurally readable')
  return compareLayout({ measurements: structure.measurements, contract, file: 'measurements.json', now: NOW })
}

function ids(report) {
  return report.findings.map((finding) => finding.ruleId)
}

test('the fixture matches its contract, so every failure below means something', () => {
  const report = compare()
  assert.deepEqual(ids(report), [])
  assert.equal(report.status, 'pass')
  assert.equal(report.summary.checked, 4)
})

test('a left edge off its column is reported and a right edge off its column is reported separately', () => {
  const leftOnly = compare(withWideBoxes([
    box('summary-card', 40, 100, 384, 200),
    box('alerts-card', 448, 100, 390, 200),
  ]))
  assert.deepEqual(ids(leftOnly), ['element-misaligned-right'], 'only the right edge moved')

  const bothEdges = compare(withWideBoxes([
    box('summary-card', 40, 100, 384, 200),
    box('alerts-card', 460, 100, 384, 200),
  ]))
  assert.deepEqual(ids(bothEdges).sort(), ['element-misaligned-left', 'element-misaligned-right', 'gutter-mismatch'])
})

test('a gutter is checked only between column-adjacent elements', () => {
  const contract = (document) => {
    document.widths[0].spans = {
      'summary-card': { start: 1, end: 4 },
      'alerts-card': { start: 9, end: 12 },
    }
    return document
  }
  // 40..424 and 856..1240: the gap between them is four columns and five
  // gutters, not one gutter, and the contract does not name it.
  const report = compare(withWideBoxes([
    box('summary-card', 40, 100, 384, 200),
    box('alerts-card', 856, 100, 384, 200),
  ]), contract)
  assert.deepEqual(ids(report), [], 'no expectation is invented for a gap the contract does not name')
})

test('a gutter that is wrong between column-adjacent elements is reported with the difference', () => {
  const report = compare(withWideBoxes([
    box('summary-card', 40, 100, 380, 200),
    box('alerts-card', 448, 100, 384, 200),
  ]))
  assert.deepEqual(ids(report).sort(), ['element-misaligned-right', 'gutter-mismatch'])
  const gutter = report.findings.find((finding) => finding.ruleId === 'gutter-mismatch')
  assert.equal(gutter.evidence, 'gap=28 gutter=24 delta=4')
})

test('elements in different rows are not compared with each other', () => {
  const report = compare(withWideBoxes([
    box('summary-card', 40, 100, 384, 200),
    box('alerts-card', 448, 400, 384, 200),
  ]))
  assert.deepEqual(ids(report), [], 'a gutter is a within-row measurement')

  // The case above passes whether or not the row test is applied, because two
  // column-adjacent elements have a gap of exactly the gutter wherever they sit
  // vertically. This one does not: the two elements occupy the SAME columns, one
  // below the other, so dropping the row test reports them as overlapping
  // horizontally -- which is what a two-row layout looks like from above.
  const stackedInTheSameColumns = compare(
    withWideBoxes([
      box('summary-card', 40, 100, 384, 200),
      box('alerts-card', 40, 400, 384, 200),
    ]),
    (contract) => {
      contract.widths[0].spans['alerts-card'] = { start: 1, end: 4 }
      return contract
    },
  )
  assert.deepEqual(
    ids(stackedInTheSameColumns),
    [],
    'two elements in the same columns and different rows do not overlap',
  )
})

test('elements sitting on top of one another are reported on the axis they overlap', () => {
  const sideBySide = compare(withWideBoxes([
    box('summary-card', 40, 100, 420, 200),
    box('alerts-card', 448, 100, 384, 200),
  ]))
  assert.ok(ids(sideBySide).includes('elements-overlap'))
  const horizontal = sideBySide.findings.find((finding) => finding.ruleId === 'elements-overlap')
  assert.match(horizontal.message, /overlap horizontally/u)
  assert.equal(horizontal.evidence, 'summary-card.right=460 alerts-card.left=448')

  const stacked = compare(withMobileBoxes([
    box('summary-card', 16, 100, 343, 200),
    box('alerts-card', 16, 280, 343, 200),
  ]))
  const vertical = stacked.findings.find((finding) => finding.ruleId === 'elements-overlap')
  assert.match(vertical.message, /overlap vertically/u)
  assert.equal(vertical.evidence, 'summary-card.bottom=300 alerts-card.top=280')
})

test('an element outside the margins is reported, and one off the viewport is reported as that', () => {
  const pastMargin = compare(withWideBoxes([
    box('summary-card', 40, 100, 384, 200),
    box('alerts-card', 448, 100, 800, 200),
  ]))
  assert.ok(ids(pastMargin).includes('element-overflows-content'))
  const content = pastMargin.findings.find((finding) => finding.ruleId === 'element-overflows-content')
  assert.equal(content.evidence, 'x=448 right=1248 content=40..1240')

  const pastViewport = compare(withWideBoxes([
    box('summary-card', 40, 100, 384, 200),
    box('alerts-card', 448, 100, 900, 200),
  ]))
  assert.ok(ids(pastViewport).includes('element-overflows-viewport'))
  assert.ok(
    !ids(pastViewport).includes('element-overflows-content'),
    'off the screen is reported once, as the more serious of the two',
  )
})

test('an element pushed off the left edge is reported', () => {
  const report = compare(withWideBoxes([
    box('summary-card', -20, 100, 384, 200),
    box('alerts-card', 448, 100, 384, 200),
  ]))
  assert.ok(ids(report).includes('element-overflows-viewport'))
})

test('a stacked element is checked for the content width and the content left edge', () => {
  const narrow = compare(withMobileBoxes([
    box('summary-card', 16, 100, 300, 200),
    box('alerts-card', 16, 320, 343, 200),
  ]))
  assert.deepEqual(ids(narrow), ['stacked-element-not-full-width'])

  const indented = compare(withMobileBoxes([
    box('summary-card', 30, 100, 343, 200),
    box('alerts-card', 16, 320, 343, 200),
  ]))
  assert.deepEqual(ids(indented).sort(), ['element-misaligned-left', 'element-overflows-content'])
})

test('a per-width tolerance overrides the contract default at that width only', () => {
  const loose = (document) => {
    document.widths[0].tolerance = 8
    return document
  }
  const measurements = withWideBoxes([
    box('summary-card', 40, 100, 384, 200),
    box('alerts-card', 454, 100, 384, 200),
  ])
  assert.deepEqual(compare(measurements, loose), compare(measurements, loose))
  assert.deepEqual(compare(measurements, loose).findings, [], '6 off is inside a tolerance of 8')
  assert.ok(compare(measurements).findings.length > 0, 'and outside the default of 0.5')

  const looseMobileOnly = (document) => {
    document.widths[1].tolerance = 50
    return document
  }
  assert.ok(compare(measurements, looseMobileOnly).findings.length > 0, 'the mobile tolerance does not reach wide')
})

test('an element the contract does not expect at a width is reported and not checked', () => {
  const report = compare(withWideBoxes([
    box('summary-card', 40, 100, 384, 200),
    box('alerts-card', 448, 100, 384, 200),
    box('debug-overlay', 0, 0, 5, 5),
  ]))
  assert.deepEqual(ids(report), ['element-unknown'])
  assert.equal(report.findings[0].severity, 'info')
  assert.equal(report.status, 'pass', 'an element the contract does not govern is not a failure')
  assert.equal(report.summary.checked, 4, 'and it is not counted as compared')
})

test('an element the contract expects at one width only is not demanded at the other', () => {
  const contract = (document) => {
    document.widths[1].elements = ['summary-card']
    return document
  }
  const measurements = withMobileBoxes([box('summary-card', 16, 100, 343, 200)])
  const report = compare(measurements, contract)
  assert.deepEqual(ids(report), [], 'a layout may drop an element at a width the contract says so')
})
