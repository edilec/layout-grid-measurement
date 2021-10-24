/**
 * layout-grid-measurement
 *
 * Read a document of bounding boxes that somebody else exported at a set of
 * viewport widths, and compare columns, gutters, alignment and overflow with a
 * layout contract.
 *
 * Three rules govern the design, and they matter more than the arithmetic:
 *
 * 1. THE MEASUREMENTS ARE AN INPUT. This tool collects nothing. It opens no
 *    browser, drives no page, resolves no host and opens no socket. The
 *    measurement document is the only evidence there is, a route inside it is
 *    an opaque name rather than an address, and a finding may not phrase itself
 *    as though the tool had looked at a layout itself.
 * 2. A RESPONSIVE CHANGE IS DOCUMENTED, NOT DISCOVERED. Each width in the
 *    contract declares its own stacking and its own grid, and no expectation is
 *    carried from one width to another. A layout that stacks into one column at
 *    the smallest width passes because the contract says it stacks there -- and
 *    the same boxes fail at a width still declared a grid.
 * 3. UNKNOWN IS NEVER A PASS. A box that could not be read, an element the
 *    contract expects and nothing measured, a width recorded at a viewport the
 *    contract does not compute for, measurements too old to describe the layout
 *    now -- each marks the run incomplete and exits 2. None of them satisfies a
 *    check, and an undetermined edge is never reported as an aligned one.
 *
 * The contract is the policy: a problem with it means the run never had a
 * subject, so it leaves stdout empty and exits 2. The measurements are the
 * evidence: a problem with them is a finding inside an `incomplete` report,
 * because a consumer needs to know which coordinate was not obtained.
 */

import { readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

import { ageChecks, checkWidth } from './checks.mjs'
import {
  CONTRACT_SCHEMA_VERSION,
  ContractError,
  DEFAULT_LIMITS,
  LIMIT_NAMES,
  MAX_CONTRACT_BYTES,
  STACKINGS,
  validateContract,
} from './contract.mjs'
import { MEASUREMENTS_SCHEMA_VERSION, pointerFor, readMeasurements } from './measurements.mjs'
import {
  EVIDENCE_MISSING_RULES,
  LINE_SEPARATORS,
  RULE_IDS,
  RULE_SEVERITY,
  at,
  byCodeUnit,
  makeFinding,
  marksEvidenceMissing,
  msg,
  num,
  parseFailureDetail,
  sanitize,
  severityFor,
  sortFindings,
  statusFor,
} from './rules.mjs'

export { ageChecks, checkWidth } from './checks.mjs'
export {
  CONTRACT_SCHEMA_VERSION,
  ContractError,
  DEFAULT_LIMITS,
  LIMIT_NAMES,
  MAX_COLUMNS,
  MAX_CONTRACT_BYTES,
  MAX_ELEMENTS,
  MAX_WIDTHS,
  STACKINGS,
  describeWidth,
  isRecord,
  validateContract,
} from './contract.mjs'
export { EPSILON, columnLeft, geometryProblem, gridGeometry, overlaps, spanEdges } from './geometry.mjs'
export {
  MEASUREMENTS_SCHEMA_VERSION,
  parseCaptureInstant,
  pointerFor,
  readBox,
  readMeasurements,
} from './measurements.mjs'
export {
  EVIDENCE_LIMIT,
  EVIDENCE_MISSING_RULES,
  FORBIDDEN_CLAIMS,
  LINE_SEPARATORS,
  MAX_ID_LENGTH,
  RULE_IDS,
  RULE_SEVERITY,
  SEVERITIES,
  SafeMessage,
  assertNoForbiddenClaim,
  at,
  byCodeUnit,
  compareFindings,
  describeValue,
  findForbiddenClaim,
  isRenderableString,
  makeFinding,
  marksEvidenceMissing,
  msg,
  num,
  parseFailureDetail,
  pointerToken,
  sanitize,
  severityFor,
  sortFindings,
  statusFor,
} from './rules.mjs'

export const TOOL_ID = 'layout-grid-measurement'
export const REPORT_SCHEMA_VERSION = '1'

/**
 * Printed in every report, whatever the verdict.
 *
 * It is a top-level string rather than a finding because it is true of the run
 * as a whole: the tool did not observe the layout, and a consumer reading only
 * the findings should still be told so.
 */
export const DISCLAIMER =
  'This report describes a document of bounding boxes that was supplied to it. This tool collects nothing: it opens '
  + 'no browser, drives no page and resolves no host, a route here is an opaque name from the measurements rather '
  + 'than an address, and every expected coordinate is computed from the supplied contract.'

/**
 * Read a file as UTF-8, strictly.
 *
 * `fatal: true` is the point: a file whose bytes are not UTF-8 is reported as
 * undecodable and encoding validity is never inferred from the decoded text. A
 * document that legitimately contains U+FFFD is evidence of nothing. The
 * contract goes through the same path, because a policy file that quietly
 * accepts broken bytes is the same defect one directory over.
 */
export async function readTextBounded(file, maxBytes) {
  let info
  try {
    info = await stat(file)
  } catch (error) {
    return { status: 'unreadable', reason: error.code ?? 'unknown error', text: null }
  }
  if (!info.isFile()) return { status: 'unreadable', reason: 'not a regular file', text: null }
  if (info.size > maxBytes) {
    return { status: 'too-large', reason: `${info.size} bytes exceeds the ${maxBytes} byte limit`, text: null }
  }
  let bytes
  try {
    bytes = await readFile(file)
  } catch (error) {
    return { status: 'unreadable', reason: error.code ?? 'unknown error', text: null }
  }
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return { status: 'not-utf8', reason: 'the bytes are not valid UTF-8', text: null }
  }
  return { status: 'ok', reason: null, text }
}

/** Load and validate the contract. Every failure here is a ContractError. */
export async function loadContract(contractPath) {
  const absolute = resolve(process.cwd(), contractPath)
  const read = await readTextBounded(absolute, MAX_CONTRACT_BYTES)
  if (read.status !== 'ok') throw new ContractError(`Could not load the contract: ${read.reason}`)
  let document
  try {
    document = JSON.parse(read.text)
  } catch (error) {
    // V8 quotes the document it choked on -- the whole file when the file is
    // short -- so the contract's own bytes would reach stderr through this
    // message. `parseFailureDetail` keeps the position and discards the quote;
    // the sanitising pass stays, because every untrusted string gets one.
    throw new ContractError(`The contract is not valid JSON: ${sanitize(parseFailureDetail(error), 200)}`)
  }
  return validateContract(document)
}

const EMPTY_COUNTS = Object.freeze({ checked: 0, routes: 0, widths: 0, boxes: 0 })

export function buildReport(findings, counts) {
  const sorted = sortFindings(findings)
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: TOOL_ID,
    status: statusFor(sorted),
    disclaimer: DISCLAIMER,
    summary: {
      checked: counts.checked,
      errors: sorted.filter((finding) => finding.severity === 'error').length,
      warnings: sorted.filter((finding) => finding.severity === 'warning').length,
      info: sorted.filter((finding) => finding.severity === 'info').length,
      routes: counts.routes,
      widths: counts.widths,
      boxes: counts.boxes,
    },
    findings: sorted,
  }
}

/**
 * Compare one measurement document with one contract.
 *
 * `now` is a parameter with a documented override. A tool that reads the wall
 * clock unconditionally cannot be tested against a staleness deadline, and a
 * verdict that depends on an unrecorded reading is not reproducible.
 */
export function compareLayout({ measurements, contract, file, now = Date.now() }) {
  const findings = []

  if (measurements.unit !== contract.unit) {
    findings.push(makeFinding(
      'unit-unsupported',
      msg`The measurements are in ${measurements.unit} but the contract is written in ${contract.unit},
        so no coordinate was compared.`,
      at(file, '/capture/unit'),
      { suggestion: 'Export the measurements in the unit the contract declares, or write the contract in that unit.' },
    ))
    return buildReport(findings, EMPTY_COUNTS)
  }

  ageChecks(measurements, contract, file, now, findings)

  const routeCount = measurements.routes.length
  let widthCount = 0
  let boxCount = 0
  for (const route of measurements.routes) {
    widthCount += route.widths.length
    for (const width of route.widths) boxCount += width.rawBoxes.length
  }

  const over = [
    ['route-limit-exceeded', routeCount, contract.limits.maxRoutes, 'routes', 'maxRoutes'],
    ['box-limit-exceeded', boxCount, contract.limits.maxBoxes, 'boxes', 'maxBoxes'],
  ].find(([, seen, limit]) => seen > limit)
  if (over !== undefined) {
    const [ruleId, seen, limit, what, limitName] = over
    findings.push(makeFinding(
      ruleId,
      msg`The measurements hold ${num(seen)} ${what}, over the limit of ${num(limit)}; nothing was compared.`,
      at(file, '/routes'),
      { suggestion: `Raise limits.${limitName} deliberately, or split the measurements.` },
    ))
    return buildReport(findings, { checked: 0, routes: routeCount, widths: widthCount, boxes: boxCount })
  }

  let checked = 0
  for (const route of measurements.routes) {
    const covered = new Set()
    for (const measuredWidth of route.widths) {
      covered.add(measuredWidth.name)
      const contractWidth = contract.widths.get(measuredWidth.name)
      if (contractWidth === undefined) {
        findings.push(makeFinding(
          'width-unknown',
          msg`Route ${route.name} holds boxes for width ${measuredWidth.name}, which the contract does not declare,
            so its ${num(measuredWidth.rawBoxes.length)} box(es) were not compared.`,
          at(file, pointerFor(route.name, measuredWidth.name)),
          {
            evidence: `declared widths: ${[...contract.widths.keys()].sort(byCodeUnit).join(', ')}`,
            suggestion: 'Declare the width in the contract, or leave it out of the measurements.',
          },
        ))
        continue
      }
      const context = { file, route: route.name, width: measuredWidth.name }
      checked += checkWidth(measuredWidth, contractWidth, context, findings)
    }

    for (const name of [...contract.widths.keys()].sort(byCodeUnit)) {
      if (covered.has(name)) continue
      findings.push(makeFinding(
        'width-not-measured',
        msg`Route ${route.name} was not recorded at width ${name}, which the contract declares,
          so its layout there was not established.`,
        at(file, pointerFor(route.name)),
        { suggestion: 'Record every route at every width the contract declares, or shorten the contract.' },
      ))
    }
  }

  if (checked === 0 && !findings.some((finding) => marksEvidenceMissing(finding.ruleId))) {
    findings.push(makeFinding(
      'no-boxes-checked',
      msg`No box was compared, so there is no evidence to pass or fail on.`,
      at(file, '/routes'),
      { suggestion: 'Supply measurements that record at least one element the contract expects.' },
    ))
  }

  return buildReport(findings, { checked, routes: routeCount, widths: widthCount, boxes: boxCount })
}

/**
 * Run one comparison.
 *
 * Throws `ContractError` when the run never had a subject. Everything that went
 * wrong with the evidence comes back inside the report.
 */
export async function measureProject({ measurements, contract, now }) {
  const policy = await loadContract(contract)
  const measurementsPath = resolve(process.cwd(), measurements)
  const file = sanitize(basename(measurementsPath), 200)

  const read = await readTextBounded(measurementsPath, policy.limits.maxMeasurementBytes)
  if (read.status !== 'ok') {
    const ruleId = read.status === 'too-large'
      ? 'measurements-too-large'
      : read.status === 'not-utf8' ? 'measurements-not-utf8' : 'measurements-unreadable'
    return buildReport([makeFinding(
      ruleId,
      msg`The measurements were not read: ${read.reason}.`,
      at(file, null),
      {
        suggestion: read.status === 'too-large'
          ? 'Raise limits.maxMeasurementBytes deliberately, or split the document.'
          : 'Export the measurements as UTF-8 JSON at the path given to --measurements.',
      },
    )], EMPTY_COUNTS)
  }

  let document
  try {
    document = JSON.parse(read.text)
  } catch (error) {
    return buildReport([makeFinding(
      'measurements-unparsable',
      msg`The measurements are not valid JSON: ${parseFailureDetail(error)}.`,
      at(file, null),
      { suggestion: 'Correct the JSON. Nothing was read from this file.' },
    )], EMPTY_COUNTS)
  }

  const structure = readMeasurements(document, file)
  if (!structure.ok) return buildReport(structure.findings, EMPTY_COUNTS)
  return compareLayout({ measurements: structure.measurements, contract: policy, file, now })
}

const SEPARATOR_PATTERN = new RegExp(`[${LINE_SEPARATORS}]`, 'gu')
const SEPARATOR_ESCAPES = new Map(
  [...LINE_SEPARATORS].map((character) => [
    character,
    `\\u${character.codePointAt(0).toString(16).padStart(4, '0')}`,
  ]),
)

/**
 * Serialise the report for stdout.
 *
 * `JSON.stringify` leaves U+2028 and U+2029 raw, and inside a JavaScript string
 * literal those two are line terminators. The payload parses as JSON either
 * way, but an identifier carrying one would break a consumer that evaluates the
 * payload as JavaScript, so both are escaped here as well as stripped upstream.
 */
export function renderReport(report) {
  const json = JSON.stringify(report, null, 2)
  return `${json.replace(SEPARATOR_PATTERN, (character) => SEPARATOR_ESCAPES.get(character))}\n`
}

export function exitCodeFor(report) {
  if (report.status === 'pass') return 0
  if (report.status === 'fail') return 1
  return 2
}

/** A human summary. It goes to stderr, because stdout carries only the report. */
export function formatSummary(report) {
  const lines = report.findings.map((finding) => {
    const place = [finding.location.file, finding.location.pointer]
      .filter((part) => part !== undefined && part !== '')
      .map((part) => sanitize(part, 200))
      .join(' ')
    return `${finding.severity.toUpperCase().padEnd(7)} ${sanitize(finding.ruleId, 40).padEnd(30)} ${place}`
  })
  lines.push('')
  lines.push(
    `${report.summary.boxes} box(es) recorded across ${report.summary.routes} route(s) `
    + `and ${report.summary.widths} width(s); ${report.summary.checked} compared.`,
  )
  lines.push(
    `${report.summary.errors} error, ${report.summary.warnings} warning, ${report.summary.info} info. `
    + `Status ${report.status}.`,
  )
  lines.push(report.disclaimer)
  return `${lines.join('\n')}\n`
}

/** Exported so the rule catalog and the limits can be asserted against the docs. */
export const CATALOG = Object.freeze({
  ruleIds: RULE_IDS,
  severity: RULE_SEVERITY,
  evidenceMissing: EVIDENCE_MISSING_RULES,
  limits: DEFAULT_LIMITS,
  limitNames: LIMIT_NAMES,
  stackings: STACKINGS,
  severityFor,
  contractSchemaVersion: CONTRACT_SCHEMA_VERSION,
  measurementsSchemaVersion: MEASUREMENTS_SCHEMA_VERSION,
  reportSchemaVersion: REPORT_SCHEMA_VERSION,
})
