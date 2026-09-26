/**
 * Reading the measurement document -- the evidence.
 *
 * The document is an export from somebody else's measuring setup. This tool
 * opens no browser, resolves no host and visits nothing: a route inside it is
 * an opaque name the exporter chose, not an address, and a bounding box is a
 * number this tool was handed rather than one it took.
 *
 * Nothing here throws on bad evidence. A document that is malformed, or a box
 * whose coordinates are missing, produces a finding that marks the run
 * incomplete. A coordinate the tool did not obtain never satisfies a check and
 * is never reported as an aligned one.
 */

import { isRecord } from './contract.mjs'
import { MAX_ID_LENGTH, at, isRenderableString, makeFinding, msg, num, pointerToken, sanitize } from './rules.mjs'

export const MEASUREMENTS_SCHEMA_VERSION = '1'

/**
 * Why `isRenderableString` refused a name, in words the report may use.
 *
 * These sentences used to say the name must be "visible once rendered", which
 * names the report's own rendering -- but `render` is one of the words this
 * tool may not use about itself, so `msg` threw and a document with an unnamed
 * route aborted the run with empty stdout, the shape reserved for a
 * configuration error. The wording says what the check does instead.
 */
const NAME_REQUIREMENT = (field) =>
  `${field} must be at most ${MAX_ID_LENGTH} characters long and hold at least one visible character`

const DOCUMENT_KEYS = Object.freeze(['schemaVersion', 'capture', 'routes'])
const META_KEYS = Object.freeze(['id', 'unit', 'capturedAt'])
const ROUTE_KEYS = Object.freeze(['name', 'widths'])
const WIDTH_KEYS = Object.freeze(['name', 'viewportWidth', 'boxes'])
const BOX_KEYS = Object.freeze(['element', 'x', 'y', 'width', 'height'])

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/u
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/u

/**
 * Read `capturedAt` strictly.
 *
 * `new Date(string)` accepts a great deal and guesses a time zone for some of
 * it, so the two accepted spellings are matched by pattern and every field is
 * checked to round-trip. A date the tool cannot read is not a date it may
 * assume is recent.
 */
export function parseCaptureInstant(value) {
  if (typeof value !== 'string') return { ok: false }
  const dateOnly = DATE_ONLY.exec(value)
  const dateTime = dateOnly === null ? DATE_TIME.exec(value) : null
  const parts = dateOnly ?? dateTime
  if (parts === null) return { ok: false }
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  const [hour, minute, second] = dateOnly === null
    ? [Number(parts[4]), Number(parts[5]), Number(parts[6])]
    : [0, 0, 0]
  const millisecond = dateOnly === null && parts[7] !== undefined ? Number(parts[7].padEnd(3, '0')) : 0
  if (month < 1 || month > 12 || day < 1 || day > 31) return { ok: false }
  if (hour > 23 || minute > 59 || second > 59) return { ok: false }
  const ms = Date.UTC(year, month - 1, day, hour, minute, second, millisecond)
  const back = new Date(ms)
  if (back.getUTCFullYear() !== year || back.getUTCMonth() + 1 !== month || back.getUTCDate() !== day) {
    return { ok: false }
  }
  return { ok: true, ms }
}

function keyProblem(object, known, label) {
  for (const key of Object.keys(object)) {
    if (!known.includes(key)) return `${label} holds the unknown key "${sanitize(key, 60)}"`
  }
  return null
}

function finiteProblem(value, label, { min = null } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `${label} must be a finite number`
  if (min !== null && value < min) return `${label} must be ${min} or more`
  return null
}

/**
 * Validate one bounding box.
 *
 * A box is four numbers and the name of what they describe. `x` and `y` may be
 * negative -- an element pushed off the left edge is exactly the sort of thing
 * worth reporting -- but a width or height that is negative is not a
 * measurement, it is a mistake in the export.
 */
export function readBox(raw) {
  if (!isRecord(raw)) return { ok: false, reason: 'a box must be an object' }
  const unknown = keyProblem(raw, BOX_KEYS, 'the box')
  if (unknown !== null) return { ok: false, reason: unknown }
  if (!isRenderableString(raw.element)) {
    return { ok: false, reason: NAME_REQUIREMENT('element') }
  }
  const element = raw.element
  for (const key of ['x', 'y']) {
    const problem = finiteProblem(raw[key], key)
    if (problem !== null) return { ok: false, element, reason: problem }
  }
  for (const key of ['width', 'height']) {
    const problem = finiteProblem(raw[key], key, { min: 0 })
    if (problem !== null) return { ok: false, element, reason: problem }
  }
  return { ok: true, box: { element, x: raw.x, y: raw.y, width: raw.width, height: raw.height } }
}

/** A documented field path: /routes/<route>/widths/<width>/boxes/<element>. */
export function pointerFor(route, width = null, element = null) {
  let pointer = `/routes/${pointerToken(route)}`
  if (width !== null) pointer += `/widths/${pointerToken(width)}`
  if (element !== null) pointer += `/boxes/${pointerToken(element)}`
  return pointer
}

/**
 * Turn a parsed measurement document into routes, widths and raw boxes, with a
 * finding for everything that could not be read.
 *
 * `ok: false` means nothing at all could be read, and the caller must not go on
 * to report that the layout was aligned.
 */
export function readMeasurements(document, file) {
  const findings = []
  const invalid = (message, pointer, suggestion) => {
    findings.push(makeFinding('measurements-invalid', message, at(file, pointer), { suggestion }))
    return { ok: false, findings }
  }

  if (!isRecord(document)) {
    return invalid(msg`The measurement document is not a JSON object.`, '', 'Export the measurements again.')
  }
  const unknown = keyProblem(document, DOCUMENT_KEYS, 'the measurement document')
  if (unknown !== null) return invalid(msg`${unknown}.`, '', `Known keys: ${DOCUMENT_KEYS.join(', ')}.`)
  if (document.schemaVersion !== MEASUREMENTS_SCHEMA_VERSION) {
    return invalid(
      msg`Unsupported measurement schemaVersion: ${document.schemaVersion === undefined ? 'missing' : document.schemaVersion}.`,
      '/schemaVersion',
      `This tool reads measurement schemaVersion ${MEASUREMENTS_SCHEMA_VERSION}.`,
    )
  }
  if (!isRecord(document.capture)) {
    return invalid(msg`capture must be an object holding id and unit.`, '/capture', 'Add the capture metadata.')
  }
  const metaKeys = keyProblem(document.capture, META_KEYS, 'capture')
  if (metaKeys !== null) return invalid(msg`${metaKeys}.`, '/capture', `Known keys: ${META_KEYS.join(', ')}.`)
  if (!isRenderableString(document.capture.id)) {
    return invalid(
      msg`capture.id must be at most ${num(MAX_ID_LENGTH)} characters long and hold at least one visible character.`,
      '/capture/id',
      'Name the capture.',
    )
  }
  if (!isRenderableString(document.capture.unit)) {
    return invalid(msg`capture.unit must name the unit every coordinate is in.`, '/capture/unit', 'Declare the unit.')
  }

  if (!Array.isArray(document.routes)) {
    return invalid(msg`routes must be an array.`, '/routes', 'Correct the measurement document.')
  }

  const routes = []
  const seenRoutes = new Set()
  for (const [routeIndex, rawRoute] of document.routes.entries()) {
    const routeLabel = `/routes/${routeIndex}`
    if (!isRecord(rawRoute)) return invalid(msg`A route must be an object.`, routeLabel, 'Correct the document.')
    const routeKeys = keyProblem(rawRoute, ROUTE_KEYS, 'a route')
    if (routeKeys !== null) return invalid(msg`${routeKeys}.`, routeLabel, `Known keys: ${ROUTE_KEYS.join(', ')}.`)
    if (!isRenderableString(rawRoute.name)) {
      return invalid(
        msg`A route name must be at most ${num(MAX_ID_LENGTH)} characters long and hold at least one visible character.`,
        routeLabel,
        'Name the route.',
      )
    }
    if (seenRoutes.has(rawRoute.name)) {
      return invalid(
        msg`Route ${rawRoute.name} appears more than once, so its coverage is ambiguous.`,
        routeLabel,
        'Describe each route once.',
      )
    }
    seenRoutes.add(rawRoute.name)
    if (!Array.isArray(rawRoute.widths)) {
      return invalid(msg`Route ${rawRoute.name}: widths must be an array.`, routeLabel, 'Correct the document.')
    }

    const widths = []
    const seenWidths = new Set()
    for (const [widthIndex, rawWidth] of rawRoute.widths.entries()) {
      const widthLabel = `${routeLabel}/widths/${widthIndex}`
      if (!isRecord(rawWidth)) return invalid(msg`A width must be an object.`, widthLabel, 'Correct the document.')
      const widthKeys = keyProblem(rawWidth, WIDTH_KEYS, 'a width')
      if (widthKeys !== null) return invalid(msg`${widthKeys}.`, widthLabel, `Known keys: ${WIDTH_KEYS.join(', ')}.`)
      if (!isRenderableString(rawWidth.name)) {
        return invalid(
          msg`A width name must be at most ${num(MAX_ID_LENGTH)} characters long and hold at least one visible character.`,
          widthLabel,
          'Name the width.',
        )
      }
      if (seenWidths.has(rawWidth.name)) {
        return invalid(
          msg`Route ${rawRoute.name} holds two sets of boxes for width ${rawWidth.name}, so its coordinates are ambiguous.`,
          widthLabel,
          'Record each width once per route.',
        )
      }
      seenWidths.add(rawWidth.name)
      if (!Array.isArray(rawWidth.boxes)) {
        return invalid(msg`A width must hold an array of boxes.`, widthLabel, 'Correct the document.')
      }
      widths.push({ name: rawWidth.name, viewportWidth: rawWidth.viewportWidth, rawBoxes: rawWidth.boxes })
    }
    routes.push({ name: rawRoute.name, widths })
  }

  return {
    ok: true,
    findings,
    measurements: {
      id: document.capture.id,
      unit: document.capture.unit,
      capturedAt: document.capture.capturedAt,
      routes,
    },
  }
}
