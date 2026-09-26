/**
 * Comparing the boxes with the contract.
 *
 * Every expected coordinate here is computed from the contract's own grid, at
 * the width the boxes were recorded at. Nothing is assumed about pixels, and no
 * expectation is carried from one width to another: that is what makes a
 * documented stacking change pass rather than register as a regression.
 *
 * A box the tool could not read, or a width whose viewport does not match the
 * contract's, produces an evidence-missing finding and is never counted as
 * checked. An undetermined edge is not "no claim".
 */

import { describeWidth } from './contract.mjs'
import { EPSILON, overlaps, spanEdges } from './geometry.mjs'
import { parseCaptureInstant, pointerFor, readBox } from './measurements.mjs'
import { at, byCodeUnit, makeFinding, msg, num, sanitize } from './rules.mjs'

function where(context, element = null) {
  return at(context.file, pointerFor(context.route, context.width, element))
}

/**
 * An edge that should sit at a known coordinate.
 *
 * The finding carries the expected coordinate, the measured one and the
 * difference, because a boundary reported without coordinates cannot be acted
 * on: "card-b is misaligned" sends someone back to the measuring setup, while
 * "left edge at 454, expected 448, 6 past it" is a fix.
 */
function edgeCheck(ruleId, side, element, measured, expected, contractWidth, context, findings, column = null) {
  const off = measured - expected
  if (Math.abs(off) <= contractWidth.tolerance + EPSILON) return false
  const direction = off > 0 ? 'past' : 'short of'
  const message = column === null
    ? msg`The ${side} edge of ${element} is at ${num(measured)} at width ${context.width},
        ${num(Math.abs(off))} ${direction} the expected ${num(expected)}.`
    : msg`The ${side} edge of ${element} is at ${num(measured)} at width ${context.width},
        ${num(Math.abs(off))} ${direction} the expected ${num(expected)},
        which is the ${side} edge of column ${num(column)}.`
  findings.push(makeFinding(ruleId, message, where(context, element), {
    evidence: `${side}=${num(measured)} expected=${num(expected)} delta=${num(off)} `
      + `tolerance=${num(contractWidth.tolerance)}`,
    suggestion: `Align the ${side} edge with the contract, or change the contract for this width deliberately.`,
  }))
  return true
}

function overflowChecks(box, contractWidth, context, findings) {
  const { geometry, tolerance } = contractWidth
  const right = box.x + box.width

  const pastViewport = box.x < -tolerance - EPSILON || right > geometry.viewportWidth + tolerance + EPSILON
  if (pastViewport) {
    findings.push(makeFinding(
      'element-overflows-viewport',
      msg`${box.element} spans ${num(box.x)} to ${num(right)} at width ${context.width},
        outside the viewport of ${num(geometry.viewportWidth)}.`,
      where(context, box.element),
      {
        evidence: `x=${num(box.x)} right=${num(right)} viewportWidth=${num(geometry.viewportWidth)}`,
        suggestion: 'Keep the element inside the viewport, or record the width the layout is actually built for.',
      },
    ))
    return
  }

  if (box.x < geometry.contentLeft - tolerance - EPSILON || right > geometry.contentRight + tolerance + EPSILON) {
    findings.push(makeFinding(
      'element-overflows-content',
      msg`${box.element} spans ${num(box.x)} to ${num(right)} at width ${context.width},
        outside the content box of ${num(geometry.contentLeft)} to ${num(geometry.contentRight)}.`,
      where(context, box.element),
      {
        evidence: `x=${num(box.x)} right=${num(right)} content=${num(geometry.contentLeft)}..${num(geometry.contentRight)}`,
        suggestion: 'Keep the element inside the margins, or change the margin in the contract deliberately.',
      },
    ))
  }
}

function gridChecks(box, contractWidth, context, findings) {
  const span = contractWidth.spans.get(box.element)
  const edges = spanEdges(contractWidth.geometry, span)

  edgeCheck(
    'element-misaligned-left', 'left', box.element, box.x, edges.left, contractWidth, context, findings, span.start,
  )
  edgeCheck(
    'element-misaligned-right', 'right', box.element, box.x + box.width, edges.right, contractWidth, context,
    findings, span.end,
  )
}

function stackedChecks(box, contractWidth, context, findings) {
  const { geometry, tolerance } = contractWidth
  edgeCheck('element-misaligned-left', 'left', box.element, box.x, geometry.contentLeft, contractWidth, context, findings)

  const off = box.width - geometry.contentWidth
  if (Math.abs(off) > tolerance + EPSILON) {
    findings.push(makeFinding(
      'stacked-element-not-full-width',
      msg`${box.element} is ${num(box.width)} wide at width ${context.width}, which stacks,
        so it was expected to fill the content width of ${num(geometry.contentWidth)}
        (${num(Math.abs(off))} ${off > 0 ? 'wider' : 'narrower'}).`,
      where(context, box.element),
      {
        evidence: `width=${num(box.width)} contentWidth=${num(geometry.contentWidth)} delta=${num(off)}`,
        suggestion: 'Let the element fill the content width here, or declare this width as a grid with a span.',
      },
    ))
  }
}

/**
 * Gutters, and elements sitting on top of one another.
 *
 * At a grid width, two elements are in the same row when their vertical extents
 * overlap; the gap between neighbours in that row is compared with the
 * contract's gutter, but only for elements that are column-adjacent -- a pair
 * with empty columns between them has a gap the contract does not name, and
 * inventing an expectation for it would be a claim rather than a check.
 *
 * At a stacked width the axis turns: the elements are expected to follow one
 * another down the page, so any vertical overlap is reported.
 */
function neighbourChecks(boxes, contractWidth, context, findings) {
  const tolerance = contractWidth.tolerance
  const ordered = [...boxes].sort((a, b) => (a.x - b.x) || byCodeUnit(a.element, b.element))

  if (contractWidth.stacking === 'stacked') {
    const down = [...boxes].sort((a, b) => (a.y - b.y) || byCodeUnit(a.element, b.element))
    for (let index = 1; index < down.length; index += 1) {
      const previous = down[index - 1]
      const current = down[index]
      if (!overlaps(previous.y, previous.y + previous.height, current.y, current.y + current.height, tolerance)) continue
      findings.push(makeFinding(
        'elements-overlap',
        msg`${previous.element} and ${current.element} overlap vertically at width ${context.width}:
          ${previous.element} ends at ${num(previous.y + previous.height)} and ${current.element}
          starts at ${num(current.y)}.`,
        where(context, current.element),
        {
          evidence: `${sanitize(previous.element, 60)}.bottom=${num(previous.y + previous.height)} `
            + `${sanitize(current.element, 60)}.top=${num(current.y)}`,
          suggestion: 'Separate the stacked elements, or record the boxes the layout actually produces.',
        },
      ))
    }
    return
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]
    const current = ordered[index]
    const sameRow = overlaps(previous.y, previous.y + previous.height, current.y, current.y + current.height, 0)
    if (!sameRow) continue

    const gap = current.x - (previous.x + previous.width)
    if (gap < -tolerance - EPSILON) {
      findings.push(makeFinding(
        'elements-overlap',
        msg`${previous.element} and ${current.element} overlap horizontally at width ${context.width}:
          ${previous.element} ends at ${num(previous.x + previous.width)} and ${current.element}
          starts at ${num(current.x)}.`,
        where(context, current.element),
        {
          evidence: `${sanitize(previous.element, 60)}.right=${num(previous.x + previous.width)} `
            + `${sanitize(current.element, 60)}.left=${num(current.x)}`,
          suggestion: 'Separate the elements, or record the boxes the layout actually produces.',
        },
      ))
      continue
    }

    const previousSpan = contractWidth.spans.get(previous.element)
    const currentSpan = contractWidth.spans.get(current.element)
    if (previousSpan.end + 1 !== currentSpan.start) continue

    const off = gap - contractWidth.geometry.gutter
    if (Math.abs(off) <= tolerance + EPSILON) continue
    findings.push(makeFinding(
      'gutter-mismatch',
      msg`The gap between ${previous.element} and ${current.element} is ${num(gap)} at width ${context.width},
        against the contract gutter of ${num(contractWidth.geometry.gutter)}
        (${num(Math.abs(off))} ${off > 0 ? 'wider' : 'narrower'}).`,
      where(context, current.element),
      {
        evidence: `gap=${num(gap)} gutter=${num(contractWidth.geometry.gutter)} delta=${num(off)}`,
        suggestion: 'Set the gap to the contract gutter, or change the gutter for this width deliberately.',
      },
    ))
  }
}

/**
 * Check one route at one width.
 *
 * Returns how many boxes were actually compared. A box that was skipped -- an
 * unreadable record, a duplicate, an element this width does not expect -- is
 * not one of them.
 */
export function checkWidth(measuredWidth, contractWidth, context, findings) {
  if (measuredWidth.viewportWidth !== contractWidth.viewportWidth) {
    findings.push(makeFinding(
      'viewport-width-mismatch',
      msg`Width ${contractWidth.name} was recorded at a viewport of
        ${typeof measuredWidth.viewportWidth === 'number' ? num(measuredWidth.viewportWidth) : 'an unreadable value'},
        but the contract computes its columns for ${num(contractWidth.viewportWidth)},
        so none of its ${num(measuredWidth.rawBoxes.length)} box(es) were compared.`,
      where(context),
      {
        evidence: `${describeWidth(contractWidth)} at ${num(contractWidth.viewportWidth)}`,
        suggestion: 'Record the width at the viewport the contract declares, or change the contract deliberately.',
      },
    ))
    return 0
  }

  const boxes = []
  const seen = new Set()
  const duplicated = new Set()
  for (const [index, raw] of measuredWidth.rawBoxes.entries()) {
    const read = readBox(raw)
    if (!read.ok) {
      const element = read.element === undefined ? `#${index}` : read.element
      findings.push(makeFinding(
        'box-invalid',
        msg`A box was not compared: ${read.reason}.`,
        where(context, element),
        { suggestion: 'Correct the measurement document so every coordinate is present and numeric.' },
      ))
      continue
    }
    if (seen.has(read.box.element)) {
      duplicated.add(read.box.element)
      continue
    }
    seen.add(read.box.element)
    boxes.push(read.box)
  }

  for (const element of [...duplicated].sort(byCodeUnit)) {
    findings.push(makeFinding(
      'duplicate-box',
      msg`${element} is recorded more than once at width ${context.width},
        so which box describes it is ambiguous and none of them was used.`,
      where(context, element),
      { suggestion: 'Record each element once per width.' },
    ))
  }
  const ambiguous = new Set(duplicated)
  const usable = boxes.filter((box) => !ambiguous.has(box.element))

  const compared = []
  for (const box of usable.sort((a, b) => byCodeUnit(a.element, b.element))) {
    if (!contractWidth.expected.has(box.element)) {
      findings.push(makeFinding(
        'element-unknown',
        msg`${box.element} was recorded at width ${context.width}, which the contract does not expect there,
          so nothing was checked for it.`,
        where(context, box.element),
        {
          evidence: `expected here: ${[...contractWidth.expected].sort(byCodeUnit).join(', ')}`,
          suggestion: 'Add the element to this width in the contract, or leave it out of the measurements.',
        },
      ))
      continue
    }
    overflowChecks(box, contractWidth, context, findings)
    if (contractWidth.stacking === 'grid') gridChecks(box, contractWidth, context, findings)
    else stackedChecks(box, contractWidth, context, findings)
    compared.push(box)
  }

  neighbourChecks(compared, contractWidth, context, findings)

  for (const element of [...contractWidth.expected].sort(byCodeUnit)) {
    if (compared.some((box) => box.element === element)) continue
    findings.push(makeFinding(
      'element-not-measured',
      msg`${element} is expected at width ${context.width} and no box for it was compared,
        so its position there was not established.`,
      where(context, element),
      { suggestion: 'Record a box for every element the contract expects at this width.' },
    ))
  }

  return compared.length
}

/**
 * Whether the measurements are recent enough to conclude from.
 *
 * The clock is a parameter. A tool that reads the wall clock cannot be tested
 * against a deadline, and a report whose verdict depends on an unrecorded
 * reading is not reproducible.
 */
export function ageChecks(measurements, contract, file, now, findings) {
  if (contract.maxMeasurementAgeDays === null) return
  const instant = parseCaptureInstant(measurements.capturedAt)
  if (!instant.ok) {
    findings.push(makeFinding(
      'measurements-age-unknown',
      msg`The contract requires the measurements to be at most ${num(contract.maxMeasurementAgeDays)} day(s) old,
        but capture.capturedAt is
        ${measurements.capturedAt === undefined ? 'absent' : 'not a date this tool can read'},
        so their age was not established.`,
      at(file, '/capture/capturedAt'),
      { suggestion: 'Record capturedAt as YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ when exporting the measurements.' },
    ))
    return
  }
  const ageDays = (now - instant.ms) / 86400000
  if (ageDays > contract.maxMeasurementAgeDays) {
    findings.push(makeFinding(
      'measurements-stale',
      msg`The measurements are ${num(Math.floor(ageDays))} day(s) old, over the
        ${num(contract.maxMeasurementAgeDays)} day(s) the contract allows,
        so they were not treated as evidence about the layout now.`,
      at(file, '/capture/capturedAt'),
      {
        evidence: `capturedAt=${sanitize(measurements.capturedAt, 40)} `
          + `maxMeasurementAgeDays=${num(contract.maxMeasurementAgeDays)}`,
        suggestion: 'Export fresh measurements, or raise maxMeasurementAgeDays deliberately.',
      },
    ))
  }
}
