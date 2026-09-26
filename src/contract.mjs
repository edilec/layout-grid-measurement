/**
 * The layout contract: validation and the geometry it implies.
 *
 * The contract is the policy. It declares the widths that must be covered, the
 * grid at each of them, which elements the layout is made of, and what each
 * element is supposed to span. A problem with it means the run never had a
 * subject, so every failure here is a `ContractError`: stdout stays empty and
 * the process exits 2.
 *
 * A width declares its `stacking`, and that is how a responsive change is
 * DOCUMENTED rather than discovered. At a `grid` width, every element's span is
 * declared and its edges are checked against the column edges. At a `stacked`
 * width, spans do not apply: every element is expected to fill the content
 * width and to sit clear of its neighbours. A layout that stacks at the
 * smallest width therefore passes, because the contract said it would -- and
 * the same measurements fail at a width still declared `grid`.
 */

import { gridGeometry, geometryProblem } from './geometry.mjs'
import { MAX_ID_LENGTH, byCodeUnit, isRenderableString, num, sanitize } from './rules.mjs'

export const CONTRACT_SCHEMA_VERSION = '1'

/** Bounds on the contract document itself. Exceeding one is a ContractError. */
export const MAX_CONTRACT_BYTES = 1000000
export const MAX_WIDTHS = 32
export const MAX_ELEMENTS = 512
export const MAX_COLUMNS = 64

/** Every limit here is enforced; exceeding one is reported, never truncated. */
export const DEFAULT_LIMITS = Object.freeze({
  maxBoxes: 20000,
  maxMeasurementBytes: 8000000,
  maxRoutes: 500,
  maxWidths: 4000,
})

export const LIMIT_NAMES = Object.freeze(Object.keys(DEFAULT_LIMITS).sort(byCodeUnit))

export const STACKINGS = Object.freeze(['grid', 'stacked'])

const CONTRACT_KEYS = Object.freeze([
  'schemaVersion', 'unit', 'tolerance', 'maxMeasurementAgeDays', 'elements', 'widths', 'limits',
])
const WIDTH_KEYS = Object.freeze(['name', 'viewportWidth', 'stacking', 'grid', 'spans', 'elements', 'tolerance'])
const GRID_KEYS = Object.freeze(['columns', 'gutter', 'margin'])
const SPAN_KEYS = Object.freeze(['start', 'end'])

/** A problem with the contract or the invocation, not with the evidence. */
export class ContractError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ContractError'
  }
}

export function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireKnownKeys(object, known, label) {
  for (const key of Object.keys(object)) {
    if (!known.includes(key)) {
      throw new ContractError(`Unknown key "${sanitize(key, 60)}" in ${label}. Known keys: ${known.join(', ')}`)
    }
  }
}

function requireFinite(value, label, { min = null, integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ContractError(`${label} must be a finite number`)
  }
  if (integer && !Number.isInteger(value)) throw new ContractError(`${label} must be a whole number`)
  if (min !== null && value < min) throw new ContractError(`${label} must be ${min} or more`)
  return value
}

function requireName(value, label) {
  if (!isRenderableString(value)) {
    throw new ContractError(
      `${label} must be a name at most ${MAX_ID_LENGTH} characters long that holds at least one visible character`,
    )
  }
  return value
}

function readGrid(source, label) {
  if (!isRecord(source)) throw new ContractError(`${label} must declare columns, gutter and margin`)
  requireKnownKeys(source, GRID_KEYS, label)
  const columns = requireFinite(source.columns, `${label}.columns`, { min: 1, integer: true })
  if (columns > MAX_COLUMNS) {
    throw new ContractError(`${label}.columns is ${columns}, over the bound of ${MAX_COLUMNS}`)
  }
  return {
    columns,
    gutter: requireFinite(source.gutter, `${label}.gutter`, { min: 0 }),
    margin: requireFinite(source.margin, `${label}.margin`, { min: 0 }),
  }
}

function readSpans(source, label, vocabulary, columns) {
  if (!isRecord(source)) {
    throw new ContractError(`${label} must be an object mapping each element at this width to its span`)
  }
  const spans = new Map()
  for (const [element, value] of Object.entries(source)) {
    const spanLabel = `${label}.${sanitize(element, 60)}`
    requireName(element, `${label} key`)
    if (!vocabulary.has(element)) {
      throw new ContractError(`${spanLabel} names an element the contract's elements list does not declare`)
    }
    if (!isRecord(value)) throw new ContractError(`${spanLabel} must declare start and end`)
    requireKnownKeys(value, SPAN_KEYS, spanLabel)
    const start = requireFinite(value.start, `${spanLabel}.start`, { min: 1, integer: true })
    const end = requireFinite(value.end, `${spanLabel}.end`, { min: 1, integer: true })
    if (end < start) throw new ContractError(`${spanLabel}.end is before ${spanLabel}.start`)
    if (end > columns) {
      throw new ContractError(`${spanLabel}.end is column ${end}, past the ${columns} columns declared here`)
    }
    spans.set(element, { start, end })
  }
  if (spans.size === 0) throw new ContractError(`${label} must declare at least one element`)
  return spans
}

function readWidthElements(source, label, vocabulary) {
  if (!Array.isArray(source) || source.length === 0) {
    throw new ContractError(`${label} must be a non-empty array naming the elements expected at this width`)
  }
  const expected = new Set()
  for (const element of source) {
    requireName(element, `each ${label} entry`)
    if (!vocabulary.has(element)) {
      throw new ContractError(`${label} names "${sanitize(element, 60)}" which the contract's elements list does not declare`)
    }
    if (expected.has(element)) throw new ContractError(`${label} names "${sanitize(element, 60)}" more than once`)
    expected.add(element)
  }
  return expected
}

function readWidth(source, index, vocabulary, defaultTolerance) {
  const label = `widths[${index}]`
  if (!isRecord(source)) throw new ContractError(`${label} must be an object`)
  requireKnownKeys(source, WIDTH_KEYS, label)
  const name = requireName(source.name, `${label}.name`)
  const viewportWidth = requireFinite(source.viewportWidth, `${label}.viewportWidth`, { min: 1 })

  const stacking = source.stacking
  if (!STACKINGS.includes(stacking)) {
    throw new ContractError(
      `${label}.stacking must be one of ${STACKINGS.join(', ')}, which is how a responsive change is documented`,
    )
  }

  const grid = readGrid(source.grid, `${label}.grid`)
  const geometry = gridGeometry({ viewportWidth, ...grid })
  const problem = geometryProblem(geometry)
  if (problem !== null) throw new ContractError(`${label} declares a grid that cannot exist: ${problem}`)

  // Each width names the elements it expects exactly once, in the form its
  // stacking gives meaning to. A stacked width has nowhere to put a span, and a
  // grid width would leave a bare element name unchecked -- either would read
  // as coverage the tool does not perform.
  let spans = new Map()
  let expected
  if (stacking === 'grid') {
    if (source.elements !== undefined) {
      throw new ContractError(
        `${label} is a grid, so ${label}.spans already names the elements expected here; remove ${label}.elements`,
      )
    }
    spans = readSpans(source.spans, `${label}.spans`, vocabulary, grid.columns)
    expected = new Set(spans.keys())
  } else {
    if (source.spans !== undefined) {
      throw new ContractError(
        `${label} is declared stacked, so a span would not be checked; `
        + `name the elements in ${label}.elements rather than let ${label}.spans read as coverage`,
      )
    }
    expected = readWidthElements(source.elements, `${label}.elements`, vocabulary)
  }

  const tolerance = source.tolerance === undefined
    ? defaultTolerance
    : requireFinite(source.tolerance, `${label}.tolerance`, { min: 0 })

  return { name, viewportWidth, stacking, geometry, spans, expected, tolerance }
}

/**
 * Validate the contract.
 *
 * Everything decidable from the contract alone is decided here, before the
 * measurements are opened: an unknown key, an impossible grid, a span that runs
 * off the end of its own column count, and a stacked width that also declares
 * spans nobody would check.
 */
export function validateContract(document) {
  if (!isRecord(document)) throw new ContractError('The contract must be a JSON object')
  requireKnownKeys(document, CONTRACT_KEYS, 'the contract')
  if (document.schemaVersion !== CONTRACT_SCHEMA_VERSION) {
    throw new ContractError(
      `Unsupported contract schemaVersion: ${document.schemaVersion === undefined ? 'missing' : sanitize(document.schemaVersion, 40)}`,
    )
  }
  const unit = requireName(document.unit, 'unit')

  if (!Array.isArray(document.elements) || document.elements.length === 0) {
    throw new ContractError('elements must be a non-empty array naming every element the contract governs')
  }
  if (document.elements.length > MAX_ELEMENTS) {
    throw new ContractError(`elements names ${document.elements.length} elements, over the bound of ${MAX_ELEMENTS}`)
  }
  const elements = new Set()
  for (const element of document.elements) {
    requireName(element, 'each elements entry')
    if (elements.has(element)) {
      throw new ContractError(`elements names "${sanitize(element, 60)}" more than once`)
    }
    elements.add(element)
  }

  const tolerance = document.tolerance === undefined
    ? 0
    : requireFinite(document.tolerance, 'tolerance', { min: 0 })

  if (!Array.isArray(document.widths) || document.widths.length === 0) {
    throw new ContractError('widths must be a non-empty array')
  }
  if (document.widths.length > MAX_WIDTHS) {
    throw new ContractError(`widths declares ${document.widths.length} widths, over the bound of ${MAX_WIDTHS}`)
  }
  const widths = new Map()
  for (const [index, source] of document.widths.entries()) {
    const width = readWidth(source, index, elements, tolerance)
    if (widths.has(width.name)) {
      throw new ContractError(`widths declares "${sanitize(width.name, 60)}" more than once`)
    }
    widths.set(width.name, width)
  }

  let maxMeasurementAgeDays = null
  if (document.maxMeasurementAgeDays !== undefined) {
    maxMeasurementAgeDays = requireFinite(document.maxMeasurementAgeDays, 'maxMeasurementAgeDays', { min: 1, integer: true })
  }

  const limits = { ...DEFAULT_LIMITS }
  if (document.limits !== undefined) {
    if (!isRecord(document.limits)) throw new ContractError('limits must be an object')
    for (const [name, value] of Object.entries(document.limits)) {
      if (!LIMIT_NAMES.includes(name)) {
        throw new ContractError(`Unknown limit "${sanitize(name, 60)}". Known limits: ${LIMIT_NAMES.join(', ')}`)
      }
      limits[name] = requireFinite(value, `limits.${name}`, { min: 1, integer: true })
    }
  }

  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    unit,
    tolerance,
    elements,
    widths,
    maxMeasurementAgeDays,
    limits,
  }
}

/** A human-readable description of one width's grid, for a finding's evidence. */
export function describeWidth(width) {
  if (width.stacking === 'stacked') {
    return `stacked content ${num(width.geometry.contentLeft)}..${num(width.geometry.contentRight)}`
  }
  return `${num(width.geometry.columns)} columns of ${num(width.geometry.columnWidth)} `
    + `with a gutter of ${num(width.geometry.gutter)}`
}
