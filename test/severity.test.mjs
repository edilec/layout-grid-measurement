/**
 * Severity, pinned behaviourally.
 *
 * Every rule is driven through the real CLI with a real input and the
 * observable outcome is asserted: the severity the finding carries, the report
 * status, and the process exit code.
 *
 * The expectations in `OUTCOME` below are LITERALS, and that is the whole
 * point. This test used to read RULE_SEVERITY and EVIDENCE_MISSING_RULES to
 * work out what to expect -- so it asked the source what the source should do,
 * and a mutation sweep walked straight through it: flipping a severity in the
 * code and in the README rule table together left all 121 tests green, with
 * element-misaligned-right quietly demoted from exit 1 to exit 0. Deleting a
 * rule from EVIDENCE_MISSING_RULES went the same way, turning exit 2 into
 * exit 1.
 *
 * A literal exit code is not a declaration that can be edited into agreement
 * with the others: changing it is deleting the test.
 *
 * Driving every rule also proves the catalog holds no rule the tool cannot
 * reach, which is how a documentation overclaim starts.
 */

import { strict as assert } from 'node:assert'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { EVIDENCE_MISSING_RULES, RULE_IDS, RULE_SEVERITY, severityFor } from '../src/index.mjs'
import {
  box,
  contractDocument,
  measureFixture,
  measurementDocument,
  reportFrom,
  runCli,
  tempDir,
  withMobileBoxes,
  withWideBoxes,
  writeJson,
} from './helpers.mjs'

const PAIR = [box('summary-card', 40, 100, 384, 200), box('alerts-card', 448, 100, 384, 200)]

/**
 * What each rule must actually do: the severity it carries, and the status --
 * and therefore the exit code -- of a run in which it is the only thing found.
 */
const OUTCOME = Object.freeze({
  'box-invalid':                      ['error', 'incomplete'],
  'box-limit-exceeded':               ['error', 'incomplete'],
  'duplicate-box':                    ['error', 'incomplete'],
  'element-misaligned-left':          ['error', 'fail'],
  'element-misaligned-right':         ['error', 'fail'],
  'element-not-measured':             ['warning', 'incomplete'],
  'element-overflows-content':        ['error', 'fail'],
  'element-overflows-viewport':       ['error', 'fail'],
  'element-unknown':                  ['info', 'pass'],
  'elements-overlap':                 ['error', 'fail'],
  'gutter-mismatch':                  ['error', 'fail'],
  'measurements-age-unknown':         ['warning', 'incomplete'],
  'measurements-invalid':             ['error', 'incomplete'],
  'measurements-not-utf8':            ['error', 'incomplete'],
  'measurements-stale':               ['warning', 'incomplete'],
  'measurements-too-large':           ['error', 'incomplete'],
  'measurements-unparsable':          ['error', 'incomplete'],
  'measurements-unreadable':          ['error', 'incomplete'],
  'no-boxes-checked':                 ['error', 'incomplete'],
  'route-limit-exceeded':             ['error', 'incomplete'],
  'stacked-element-not-full-width':   ['error', 'fail'],
  'unit-unsupported':                 ['error', 'incomplete'],
  'viewport-width-mismatch':          ['error', 'incomplete'],
  'width-limit-exceeded':             ['error', 'incomplete'],
  'width-not-measured':               ['warning', 'incomplete'],
  'width-unknown':                    ['error', 'incomplete'],
})

/** The README's exit code table, as the process reports it. */
const EXIT = Object.freeze({ pass: 0, fail: 1, incomplete: 2 })

/** One reachable input per rule: [measurements, contract]. */
const TRIGGERS = Object.freeze({
  'box-invalid': () => [
    measurementDocument(withWideBoxes([{ element: 'summary-card', x: 40, y: 100, width: 384 }])),
    contractDocument(),
  ],
  'box-limit-exceeded': () => [
    measurementDocument(),
    contractDocument((d) => { d.limits = { maxBoxes: 1 }; return d }),
  ],
  'duplicate-box': () => [
    measurementDocument(withWideBoxes([PAIR[0], PAIR[0], PAIR[1]])),
    contractDocument(),
  ],
  'element-misaligned-left': () => [
    measurementDocument(withWideBoxes([PAIR[0], box('alerts-card', 454, 100, 378, 200)])),
    contractDocument(),
  ],
  'element-misaligned-right': () => [
    measurementDocument(withWideBoxes([PAIR[0], box('alerts-card', 448, 100, 390, 200)])),
    contractDocument(),
  ],
  'element-not-measured': () => [
    measurementDocument(withWideBoxes([PAIR[0]])),
    contractDocument(),
  ],
  'element-overflows-content': () => [
    measurementDocument(withWideBoxes([PAIR[0], box('alerts-card', 448, 100, 800, 200)])),
    contractDocument(),
  ],
  'element-overflows-viewport': () => [
    measurementDocument(withWideBoxes([PAIR[0], box('alerts-card', 448, 100, 900, 200)])),
    contractDocument(),
  ],
  'element-unknown': () => [
    measurementDocument(withWideBoxes([...PAIR, box('debug-overlay', 0, 0, 4, 4)])),
    contractDocument(),
  ],
  'elements-overlap': () => [
    measurementDocument(withWideBoxes([box('summary-card', 40, 100, 420, 200), PAIR[1]])),
    contractDocument(),
  ],
  'gutter-mismatch': () => [
    measurementDocument(withWideBoxes([box('summary-card', 40, 100, 380, 200), PAIR[1]])),
    contractDocument(),
  ],
  'measurements-age-unknown': () => [
    measurementDocument((d) => { delete d.capture.capturedAt; return d }),
    contractDocument((d) => { d.maxMeasurementAgeDays = 30; return d }),
  ],
  'measurements-invalid': () => [
    measurementDocument((d) => ({ ...d, extra: 1 })),
    contractDocument(),
  ],
  'measurements-stale': () => [
    measurementDocument((d) => { d.capture.capturedAt = '2024-01-01'; return d }),
    contractDocument((d) => { d.maxMeasurementAgeDays = 30; return d }),
  ],
  'measurements-too-large': () => [
    measurementDocument(),
    contractDocument((d) => { d.limits = { maxMeasurementBytes: 1 }; return d }),
  ],
  'measurements-unparsable': () => ['{"schemaVersion": oops}', contractDocument()],
  'no-boxes-checked': () => [
    measurementDocument((d) => { d.routes = []; return d }),
    contractDocument(),
  ],
  'route-limit-exceeded': () => [
    measurementDocument((d) => { d.routes.push({ ...d.routes[0], name: 'second' }); return d }),
    contractDocument((d) => { d.limits = { maxRoutes: 1 }; return d }),
  ],
  'stacked-element-not-full-width': () => [
    measurementDocument(withMobileBoxes([
      box('summary-card', 16, 100, 300, 200),
      box('alerts-card', 16, 320, 343, 200),
    ])),
    contractDocument(),
  ],
  'unit-unsupported': () => [
    measurementDocument((d) => { d.capture.unit = 'rem'; return d }),
    contractDocument(),
  ],
  'viewport-width-mismatch': () => [
    measurementDocument((d) => { d.routes[0].widths[0].viewportWidth = 1440; return d }),
    contractDocument(),
  ],
  'width-limit-exceeded': () => [
    measurementDocument(),
    contractDocument((d) => { d.limits = { maxWidths: 1 }; return d }),
  ],
  'width-not-measured': () => [
    measurementDocument((d) => { d.routes[0].widths = [d.routes[0].widths[0]]; return d }),
    contractDocument(),
  ],
  'width-unknown': () => [
    measurementDocument((d) => {
      d.routes[0].widths.push({ name: 'ultrawide', viewportWidth: 2560, boxes: [] })
      return d
    }),
    contractDocument(),
  ],
})

/** The two rules whose trigger is the file itself rather than its content. */
async function runFileLevel(ruleId) {
  const dir = await tempDir()
  const contractPath = await writeJson(dir, 'contract.json', contractDocument())
  if (ruleId === 'measurements-unreadable') {
    return runCli(['--measurements', join(dir, 'absent.json'), '--contract', contractPath])
  }
  const measurementsPath = join(dir, 'measurements.json')
  await writeFile(measurementsPath, Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]))
  return runCli(['--measurements', measurementsPath, '--contract', contractPath])
}

const FILE_LEVEL = Object.freeze(['measurements-not-utf8', 'measurements-unreadable'])
const EVIDENCE_MISSING = new Set(EVIDENCE_MISSING_RULES)

test('every rule in the catalog is reachable, and its severity decides the exit code', async () => {
  for (const ruleId of RULE_IDS) {
    const result = FILE_LEVEL.includes(ruleId)
      ? await runFileLevel(ruleId)
      : await measureFixture(...TRIGGERS[ruleId]())

    const report = reportFrom(result)
    const finding = report.findings.find((entry) => entry.ruleId === ruleId)
    assert.ok(finding !== undefined, `${ruleId} was not reachable: got ${report.findings.map((f) => f.ruleId)}`)

    const [severity, status] = OUTCOME[ruleId]
    assert.equal(finding.severity, severity, `${ruleId} must carry severity ${severity}`)
    assert.equal(RULE_SEVERITY[ruleId], severity, `${ruleId}: the table disagrees with what the run emitted`)
    assert.equal(report.status, status, `${ruleId} alone must make the run ${status}`)
    assert.equal(result.code, EXIT[status], `${ruleId} must exit ${EXIT[status]}`)
    assert.equal(
      EVIDENCE_MISSING.has(ruleId),
      status === 'incomplete',
      `${ruleId}: membership of EVIDENCE_MISSING_RULES is what decides between incomplete and the rest`,
    )
  }
})

test('the catalog and the table describe the same rules, in both directions', () => {
  assert.deepEqual(RULE_IDS, [...RULE_IDS].sort(), 'the catalog is in code-unit order')
  assert.deepEqual(RULE_IDS, Object.keys(RULE_SEVERITY).sort(), 'no rule has a severity without being listed')
  assert.deepEqual([...Object.keys(TRIGGERS), ...FILE_LEVEL].sort(), [...RULE_IDS])
  assert.deepEqual(Object.keys(OUTCOME).sort(), [...RULE_IDS], 'every rule states the outcome it must produce')
  for (const ruleId of EVIDENCE_MISSING_RULES) {
    assert.ok(RULE_IDS.includes(ruleId), `${ruleId} is evidence-missing but not a rule`)
  }
})

test('an unknown rule id throws rather than defaulting to something harmless', () => {
  assert.throws(() => severityFor('not-a-rule'), /Unknown ruleId/u)
})

test('every severity in the table is one this report may carry', () => {
  for (const severity of Object.values(RULE_SEVERITY)) {
    assert.ok(['error', 'warning', 'info'].includes(severity), severity)
  }
})
