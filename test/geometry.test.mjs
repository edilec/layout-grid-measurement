/**
 * The column arithmetic, checked against numbers worked out by hand rather than
 * against the same expression written twice.
 */

import { strict as assert } from 'node:assert'
import test from 'node:test'

import { columnLeft, geometryProblem, gridGeometry, overlaps, spanEdges } from '../src/index.mjs'

const WIDE = gridGeometry({ viewportWidth: 1280, columns: 12, gutter: 24, margin: 40 })

test('a twelve column grid at 1280 with 40 margins and 24 gutters', () => {
  assert.equal(WIDE.contentLeft, 40)
  assert.equal(WIDE.contentWidth, 1200, '1280 - 2 * 40')
  assert.equal(WIDE.contentRight, 1240)
  assert.equal(WIDE.columnWidth, 78, '(1200 - 11 * 24) / 12')
  assert.equal(geometryProblem(WIDE), null)
})

test('column edges step by a column plus a gutter', () => {
  assert.equal(columnLeft(WIDE, 1), 40)
  assert.equal(columnLeft(WIDE, 2), 142, '40 + 78 + 24')
  assert.equal(columnLeft(WIDE, 12), 1162, '40 + 11 * 102')
  assert.equal(columnLeft(WIDE, 12) + WIDE.columnWidth, WIDE.contentRight, 'the last column ends the content box')
})

test('a span covers its start column through its end column, gutters included', () => {
  assert.deepEqual(spanEdges(WIDE, { start: 1, end: 4 }), { left: 40, right: 424 })
  assert.deepEqual(spanEdges(WIDE, { start: 5, end: 8 }), { left: 448, right: 832 })
  assert.deepEqual(spanEdges(WIDE, { start: 9, end: 12 }), { left: 856, right: 1240 })
  assert.deepEqual(spanEdges(WIDE, { start: 7, end: 7 }), { left: 652, right: 730 }, 'a single column span')
})

test('the gap between two adjacent spans is exactly one gutter', () => {
  const first = spanEdges(WIDE, { start: 1, end: 4 })
  const second = spanEdges(WIDE, { start: 5, end: 8 })
  assert.equal(second.left - first.right, WIDE.gutter)
})

test('a grid that cannot exist is named rather than used', () => {
  const noContent = gridGeometry({ viewportWidth: 100, columns: 4, gutter: 8, margin: 60 })
  assert.match(geometryProblem(noContent), /leave no content width/u)

  const noColumns = gridGeometry({ viewportWidth: 320, columns: 12, gutter: 32, margin: 16 })
  assert.match(geometryProblem(noColumns), /leave no width for a column/u)

  const exactlyZero = gridGeometry({ viewportWidth: 200, columns: 2, gutter: 180, margin: 0 })
  assert.equal(exactlyZero.columnWidth, 10)
  assert.equal(geometryProblem(exactlyZero), null, 'a narrow but positive column is legitimate')
})

test('a single column grid is the whole content box', () => {
  const mobile = gridGeometry({ viewportWidth: 375, columns: 1, gutter: 0, margin: 16 })
  assert.equal(mobile.columnWidth, 343)
  assert.deepEqual(spanEdges(mobile, { start: 1, end: 1 }), { left: 16, right: 359 })
})

test('intervals overlap only when they share more than the tolerance', () => {
  assert.equal(overlaps(0, 10, 10, 20, 0), false, 'touching is not overlapping')
  assert.equal(overlaps(0, 10, 9, 20, 0), true)
  assert.equal(overlaps(0, 10, 9.5, 20, 0.5), false, 'half a unit is within a tolerance of half a unit')
  assert.equal(overlaps(0, 10, 9.4, 20, 0.5), true)
  assert.equal(overlaps(0, 10, 20, 30, 0), false)
})
