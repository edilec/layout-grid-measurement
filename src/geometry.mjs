/**
 * Column arithmetic.
 *
 * Everything this file computes comes from the layout contract: a viewport
 * width, a margin, a column count and a gutter. It knows nothing about pixels
 * as such and holds no default -- a contract that does not declare a grid is
 * refused rather than given one.
 *
 * The one rule worth stating: a grid whose columns would be zero or negative
 * wide is arithmetically impossible, not merely unusual. Reporting boxes as
 * misaligned against an impossible grid would blame the measurements for a
 * mistake in the contract, so it is refused before any box is read.
 */

/** Floating-point slack only. It is not a tolerance, and it is not a pixel. */
export const EPSILON = 1e-9

/**
 * The geometry one width's grid describes.
 *
 * `contentLeft` is the first column's left edge, `contentRight` the last
 * column's right edge, and `columnWidth` what is left of the content box once
 * the gutters between the columns are taken out.
 */
export function gridGeometry({ viewportWidth, columns, gutter, margin }) {
  const contentWidth = viewportWidth - 2 * margin
  const columnWidth = (contentWidth - gutter * (columns - 1)) / columns
  return {
    viewportWidth,
    columns,
    gutter,
    margin,
    contentLeft: margin,
    contentWidth,
    contentRight: margin + contentWidth,
    columnWidth,
  }
}

/** Whether a geometry describes a grid that can exist. */
export function geometryProblem(geometry) {
  if (geometry.contentWidth <= 0) {
    return `the margins of ${geometry.margin} leave no content width inside a viewport of ${geometry.viewportWidth}`
  }
  if (geometry.columnWidth <= 0) {
    return `${geometry.columns} columns with a gutter of ${geometry.gutter} leave no width for a column `
      + `inside a content width of ${geometry.contentWidth}`
  }
  return null
}

/** The left edge of a 1-based column index. */
export function columnLeft(geometry, index) {
  return geometry.contentLeft + (index - 1) * (geometry.columnWidth + geometry.gutter)
}

/** The outer edges of a span, inclusive of both the start and the end column. */
export function spanEdges(geometry, span) {
  return {
    left: columnLeft(geometry, span.start),
    right: columnLeft(geometry, span.end) + geometry.columnWidth,
  }
}

/** Whether two closed intervals overlap by more than the tolerance. */
export function overlaps(aStart, aEnd, bStart, bEnd, tolerance) {
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart) > tolerance + EPSILON
}
