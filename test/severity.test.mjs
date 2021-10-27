/**
 * Severity, pinned behaviourally.
 *
 * A severity table asserted against a hand-written expected-value map is three
 * declarations agreeing with each other, and a coordinated edit of all three
 * passes. So every rule is driven through the real CLI with a real input and
 * the observable outcome is asserted -- the report status and the process exit
 * code. An exit code cannot be edited.
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
    assert.equal(finding.severity, RULE_SEVERITY[ruleId], `${ruleId} severity`)

    if (EVIDENCE_MISSING.has(ruleId)) {
      assert.equal(report.status, 'incomplete', `${ruleId} must mark the run incomplete`)
      assert.equal(result.code, 2, `${ruleId} must exit 2`)
    } else if (finding.severity === 'error') {
      assert.equal(report.status, 'fail', `${ruleId} must fail the run`)
      assert.equal(result.code, 1, `${ruleId} must exit 1`)
    } else {
      assert.equal(report.status, 'pass', `${ruleId} alone must not fail the run`)
      assert.equal(result.code, 0, `${ruleId} must exit 0`)
    }
  }
})

test('the catalog and the table describe the same rules, in both directions', () => {
  assert.deepEqual(RULE_IDS, [...RULE_IDS].sort(), 'the catalog is in code-unit order')
  assert.deepEqual(RULE_IDS, Object.keys(RULE_SEVERITY).sort(), 'no rule has a severity without being listed')
  assert.deepEqual([...Object.keys(TRIGGERS), ...FILE_LEVEL].sort(), [...RULE_IDS])
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
