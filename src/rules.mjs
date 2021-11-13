/**
 * The rule catalog, the severity table, and everything that turns findings into
 * a status.
 *
 * Four defences live here, and each exists because its absence produced a green
 * build over a real failure somewhere in this catalog:
 *
 * 1. Severity is declared exactly once, in `RULE_SEVERITY`. Every finding takes
 *    its severity from that table and an unknown rule id throws rather than
 *    defaulting to something harmless.
 * 2. `status` is derived from the findings, not from a mutable flag. A run that
 *    could not obtain the evidence a verdict needs is `incomplete`, and there is
 *    no single assignment whose deletion would let an unchecked element pass.
 *    Four of the evidence-missing rules are `warning` severity on purpose: for
 *    those, membership of `EVIDENCE_MISSING_RULES` is the only thing standing
 *    between a gap in the evidence and a green run.
 * 3. A finding's message must be built with the `msg` tagged template. The
 *    template's own literals are checked against the words this tool is not
 *    entitled to use -- it reads a measurement capture somebody else exported
 *    and never opens a browser -- and the interpolated values, which come from
 *    untrusted documents, are sanitised.
 * 4. `sanitize` is the single boundary every untrusted string crosses, so it
 *    must survive a value that cannot be converted to a primitive at all.
 */

/** Deterministic order: UTF-16 code unit, never locale collation. */
export function byCodeUnit(a, b) {
  return a === b ? 0 : a < b ? -1 : 1
}

export const SEVERITIES = Object.freeze(['error', 'warning', 'info'])

/** The one place a severity is written down. */
export const RULE_SEVERITY = Object.freeze({
  'box-invalid': 'error',
  'box-limit-exceeded': 'error',
  'duplicate-box': 'error',
  'element-misaligned-left': 'error',
  'element-misaligned-right': 'error',
  'element-not-measured': 'warning',
  'element-overflows-content': 'error',
  'element-overflows-viewport': 'error',
  'element-unknown': 'info',
  'elements-overlap': 'error',
  'gutter-mismatch': 'error',
  'measurements-age-unknown': 'warning',
  'measurements-invalid': 'error',
  'measurements-not-utf8': 'error',
  'measurements-stale': 'warning',
  'measurements-too-large': 'error',
  'measurements-unparsable': 'error',
  'measurements-unreadable': 'error',
  'no-boxes-checked': 'error',
  'route-limit-exceeded': 'error',
  'stacked-element-not-full-width': 'error',
  'unit-unsupported': 'error',
  'viewport-width-mismatch': 'error',
  'width-limit-exceeded': 'error',
  'width-not-measured': 'warning',
  'width-unknown': 'error',
})

export const RULE_IDS = Object.freeze(Object.keys(RULE_SEVERITY).sort(byCodeUnit))

/**
 * Rules that mean the tool did not obtain the evidence a verdict would need.
 * Any one of them makes the whole report `incomplete` and the process exit 2,
 * whatever the rule's own severity happens to be.
 *
 * `element-not-measured`, `width-not-measured`, `measurements-stale` and
 * `measurements-age-unknown` are the reason this list is not decoration. All
 * four are `warning` severity, because a gap in the evidence is not a
 * misaligned layout -- so membership here is the only thing preventing a green
 * run over an element whose box was never recorded, or over coordinates too old
 * to describe the layout now.
 */
export const EVIDENCE_MISSING_RULES = Object.freeze([
  'box-invalid',
  'box-limit-exceeded',
  'duplicate-box',
  'element-not-measured',
  'measurements-age-unknown',
  'measurements-invalid',
  'measurements-not-utf8',
  'measurements-stale',
  'measurements-too-large',
  'measurements-unparsable',
  'measurements-unreadable',
  'no-boxes-checked',
  'route-limit-exceeded',
  'unit-unsupported',
  'viewport-width-mismatch',
  'width-limit-exceeded',
  'width-not-measured',
  'width-unknown',
].sort(byCodeUnit))

const EVIDENCE_MISSING_SET = new Set(EVIDENCE_MISSING_RULES)

export const EVIDENCE_LIMIT = 200
export const MAX_ID_LENGTH = 128

export function severityFor(ruleId) {
  const severity = RULE_SEVERITY[ruleId]
  if (severity === undefined) throw new Error(`Unknown ruleId "${ruleId}"`)
  return severity
}

export function marksEvidenceMissing(ruleId) {
  severityFor(ruleId)
  return EVIDENCE_MISSING_SET.has(ruleId)
}

/**
 * Words this tool is not entitled to use about its own work.
 *
 * It reads a measurement document that somebody else exported. It opens no
 * browser, resolves no host and visits nothing: a route in the document is an
 * opaque name, not an address, and a bounding box is a number somebody handed
 * it. A finding that says otherwise would describe a capability this tool does
 * not have, so the phrasing is checked at construction time rather than at
 * review time.
 */
export const FORBIDDEN_CLAIMS = Object.freeze([
  'browser', 'browsers', 'render', 'renders', 'rendered', 'rendering',
  'screenshot', 'screenshots', 'navigate', 'navigated', 'navigation',
  'fetch', 'fetched', 'fetches', 'visit', 'visited', 'crawl', 'crawled',
  'we measured', 'this tool measured', 'loaded the page', 'opened the page',
  'devtools', 'viewport was resized', 'layout was computed', 'reflow',
])

const FORBIDDEN_PATTERN = new RegExp(
  `\\b(?:${FORBIDDEN_CLAIMS.map((term) => term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')})\\b`,
  'iu',
)

export function findForbiddenClaim(text) {
  const match = FORBIDDEN_PATTERN.exec(describeValue(text))
  return match === null ? null : match[0]
}

export function assertNoForbiddenClaim(text, what) {
  const term = findForbiddenClaim(text)
  if (term !== null) {
    throw new Error(
      `${what} may not claim this tool observed an interface directly: "${term}". `
      + 'It reads a measurement capture and nothing else.',
    )
  }
}

/**
 * U+2028 and U+2029, written as escape text so that no editor, transfer or
 * copy-paste can quietly turn the escape into the character it names.
 */
export const LINE_SEPARATORS = '\u2028\u2029'

/**
 * Everything stripped from an untrusted string before it reaches output.
 *
 * `\p{Cc}` is C0, DEL and C1 -- U+0085 and U+009B forge lines in a human
 * report just as a newline does. `\p{Cf}` is the bidi controls and the other
 * invisible format characters, which reorder or hide displayed text. The two
 * separators are neither class and have to be named.
 */
const UNSAFE_CHARACTERS = new RegExp(`[\\p{Cc}\\p{Cf}${LINE_SEPARATORS}]`, 'gu')

/**
 * Describe any value as a string without ever letting it stop the run.
 *
 * `String({ toString: {} })` throws `Cannot convert object to primitive value`,
 * and a capture document is JSON this tool did not write: `{"id": {"toString":
 * {}}}` parses into exactly that. Tools in an earlier batch aborted on it with
 * empty stdout. A value that will not convert is described by its shape and
 * never reproduced.
 */
export function describeValue(value) {
  if (typeof value === 'string') return value
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return '[array]'
  try {
    return String(value)
  } catch {
    return typeof value === 'function' ? '[function]' : '[object]'
  }
}

/**
 * A bounded, control-character-free rendering of an untrusted string.
 *
 * Element names, route names, width names and unit names all arrive from input
 * documents and all reach the report and the human summary, so every one of
 * them passes through here -- not only the `evidence` field. A shipped tool
 * in this catalog sanitised its evidence carefully and let an identifier
 * carrying a newline forge whole lines in the report.
 */
export function sanitize(value, limit = EVIDENCE_LIMIT) {
  const flat = describeValue(value)
    .replace(UNSAFE_CHARACTERS, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return flat.length > limit ? `${flat.slice(0, limit - 3)}...` : flat
}

/**
 * Whether a value is a string that still says something once rendered.
 *
 * `value.trim().length > 0` is the wrong question and has shipped as a bug:
 * `trim` removes ECMAScript whitespace only, so a string of U+0001 or U+200E
 * passes it and then renders as nothing at all. Validate what will be rendered.
 */
export function isRenderableString(value, limit = MAX_ID_LENGTH) {
  return typeof value === 'string' && value.length <= limit && sanitize(value, limit) !== ''
}

/** A number as a report prints it: finite, bounded, no exponent surprises. */
export function num(value) {
  if (!Number.isFinite(value)) return describeValue(value)
  const rounded = Math.round(value * 10000) / 10000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

const UNPARSEABLE = 'the document could not be parsed as JSON'

/** Where V8 puts the offending offset. Safe: an offset says nothing about content. */
const POSITION = /at position \d+(?: \(line \d+ column \d+\))?/u

/**
 * The shape that quotes the input. Recognised FIRST, and the order is the whole
 * guard: a document whose own text reads `at position 1` makes V8 write
 * `Unexpected token 'a', "at position 1" is not valid JSON`, so looking for the
 * offset first finds that phrase INSIDE the quoted span and slices the document
 * straight back out. The `s` flag matters too -- the quoted span can carry a
 * newline, and a non-dotAll pattern silently fails to recognise the shape it is
 * there to catch. A leading `...` means the quoted run came from the middle of
 * the document rather than its start.
 */
const QUOTES_THE_INPUT = /^Unexpected token (.+?), (\.\.\.)?".*"(?:\.\.\.)? is not valid JSON$/su

function describeParseFailure(message) {
  const quoting = QUOTES_THE_INPUT.exec(message)
  if (quoting !== null) {
    const where = quoting[2] === undefined ? 'at the start of the document' : 'inside the document'
    return `unexpected token ${quoting[1]} ${where}`
  }
  const position = POSITION.exec(message)
  if (position !== null) return message.slice(0, position.index + position[0].length)
  if (message === 'Unexpected end of JSON input') return message
  return UNPARSEABLE
}

/**
 * Say what a `JSON.parse` failure was, without reproducing the document.
 *
 * V8 reports a parse failure two ways and one of them quotes the input back:
 * `Unexpected token 'A', "AKIAIOSFODNN7EXAMPLE" is not valid JSON`. A document
 * short enough to be only a credential is therefore reproduced in full by its
 * own error message, and `sanitize` does not stop that -- it strips control
 * characters and cuts from the end, while the quoted input sits at the front.
 *
 * The closing guard is deliberate belt and braces and is why this function is
 * safe against wordings it has never seen: across the measured corpus of V8
 * parse messages, every message carrying no quoted snippet carries no double
 * quote at all, because V8 quotes JSON punctuation with apostrophes. A double
 * quote surviving to the end therefore means a snippet survived, whatever the
 * branches above concluded, and the generic sentence is used instead.
 */
export function parseFailureDetail(error) {
  const message = describeValue(error?.message ?? '')
  const detail = describeParseFailure(message)
  return detail.includes('"') ? UNPARSEABLE : detail
}

/** A message whose literals have been checked and whose values are sanitised. */
export class SafeMessage {
  constructor(text) {
    this.text = text
    Object.freeze(this)
  }

  toString() {
    return this.text
  }
}

/**
 * Build a finding message.
 *
 * The tagged-template split is the point: `strings` is this tool's own voice
 * and is checked for claims it is not entitled to make, while `values` come
 * from input documents and are only sanitised. An element literally named
 * `browser-chrome` must not stop the run, and a sentence this tool wrote saying
 * it rendered a page must not ship.
 */
export function msg(strings, ...values) {
  let out = ''
  for (let index = 0; index < strings.length; index += 1) {
    // Runs of whitespace in the tool's own literals collapse to one space, so a
    // sentence may be wrapped across source lines without wrapping the report,
    // and so a phrase this tool may not use cannot be hidden by a line break.
    const literal = strings[index].replace(/\s+/gu, ' ')
    assertNoForbiddenClaim(literal, 'A finding message')
    out += literal
    if (index < values.length) out += sanitize(values[index])
  }
  return new SafeMessage(out)
}

export function at(file, pointer) {
  const location = {}
  if (file !== null && file !== undefined) location.file = file
  if (pointer !== null && pointer !== undefined) location.pointer = pointer
  return location
}

/** JSON Pointer escaping, applied to an already sanitised token. */
export function pointerToken(value) {
  return sanitize(value, MAX_ID_LENGTH).replace(/~/gu, '~0').replace(/\//gu, '~1')
}

export function makeFinding(ruleId, message, location, extra = {}) {
  if (!(message instanceof SafeMessage)) {
    throw new Error(`Finding "${ruleId}" must build its message with the msg tagged template`)
  }
  const finding = { ruleId, severity: severityFor(ruleId), message: message.text, location }
  if (extra.evidence !== undefined) finding.evidence = sanitize(extra.evidence)
  if (extra.suggestion !== undefined) {
    assertNoForbiddenClaim(extra.suggestion, 'A finding suggestion')
    // The suggestion crosses the same boundary as everything else that reaches
    // output. Every call site builds it from this tool's own literals today, so
    // sanitising changes no byte of any current report -- which is exactly why
    // it was the one string that skipped the boundary, and exactly the shape of
    // an invariant that is true only by accident. JSON.stringify escapes a
    // newline but not U+0085 or a bidi override.
    finding.suggestion = sanitize(extra.suggestion)
  }
  return finding
}

/** Findings sort by (file, pointer, ruleId, message), each by code unit. */
export function compareFindings(a, b) {
  return (
    byCodeUnit(a.location.file ?? '', b.location.file ?? '')
    || byCodeUnit(a.location.pointer ?? '', b.location.pointer ?? '')
    || byCodeUnit(a.ruleId, b.ruleId)
    || byCodeUnit(a.message, b.message)
  )
}

export function sortFindings(findings) {
  return [...findings].sort(compareFindings)
}

/**
 * Status is a function of the findings alone.
 *
 * Missing evidence outranks everything, including an error: a run that checked
 * half its widths has not established that the half it checked is the whole
 * story. There is no flag to delete.
 */
export function statusFor(findings) {
  for (const finding of findings) {
    if (EVIDENCE_MISSING_SET.has(finding.ruleId)) return 'incomplete'
  }
  for (const finding of findings) {
    if (finding.severity === 'error') return 'fail'
  }
  return 'pass'
}
