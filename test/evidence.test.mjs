/**
 * Unknown is never a pass.
 *
 * Every way this tool can fail to obtain a coordinate is driven here, and each
 * is asserted to produce `incomplete` and exit 2 rather than a green run or a
 * report that the layout was aligned. The last test is the one that matters
 * most: it removes the membership of `EVIDENCE_MISSING_RULES` that carries the
 * whole guarantee for the warning-severity rules, and shows the run turn green.
 */

import { strict as assert } from 'node:assert'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { EVIDENCE_MISSING_RULES, RULE_SEVERITY, statusFor } from '../src/index.mjs'
import {
  box,
  contractDocument,
  measureFixture,
  measurementDocument,
  reportFrom,
  ruleIds,
  runCli,
  tempDir,
  withWideBoxes,
  writeJson,
} from './helpers.mjs'

async function expectIncomplete(measurements, contract = contractDocument(), expectedRule = null) {
  const result = await measureFixture(measurements, contract)
  const report = reportFrom(result)
  assert.equal(result.code, 2, 'missing evidence exits 2')
  assert.equal(report.status, 'incomplete', 'missing evidence is never a pass')
  if (expectedRule !== null) assert.ok(ruleIds(report).includes(expectedRule), `expected ${expectedRule}, got ${ruleIds(report)}`)
  return report
}

test('a box with a missing coordinate is not compared and not passed', async () => {
  const report = await expectIncomplete(
    measurementDocument(withWideBoxes([
      { element: 'summary-card', x: 40, y: 100, width: 384 },
      box('alerts-card', 448, 100, 384, 200),
    ])),
    contractDocument(),
    'box-invalid',
  )
  assert.match(report.findings[0].message, /height must be a finite number/u)
  assert.equal(report.summary.checked, 3, 'the readable boxes are still compared')
})

test('a negative width is a mistake in the export, not a measurement', async () => {
  await expectIncomplete(
    measurementDocument(withWideBoxes([box('summary-card', 40, 100, -384, 200)])),
    contractDocument(),
    'box-invalid',
  )
})

test('an element the contract expects and nothing recorded is incomplete', async () => {
  const report = await expectIncomplete(
    measurementDocument(withWideBoxes([box('summary-card', 40, 100, 384, 200)])),
    contractDocument(),
    'element-not-measured',
  )
  const finding = report.findings.find((entry) => entry.ruleId === 'element-not-measured')
  assert.equal(finding.severity, 'warning', 'a gap in the evidence is not a misaligned layout')
  assert.match(finding.message, /alerts-card is expected at width wide/u)
})

test('a width the contract declares and nothing recorded is incomplete', async () => {
  const report = await expectIncomplete(
    measurementDocument((document) => {
      document.routes[0].widths = [document.routes[0].widths[0]]
      return document
    }),
    contractDocument(),
    'width-not-measured',
  )
  assert.equal(report.findings.find((entry) => entry.ruleId === 'width-not-measured').severity, 'warning')
})

test('a width the contract does not declare compares nothing', async () => {
  await expectIncomplete(
    measurementDocument((document) => {
      document.routes[0].widths.push({ name: 'ultrawide', viewportWidth: 2560, boxes: [] })
      return document
    }),
    contractDocument(),
    'width-unknown',
  )
})

test('a width recorded at another viewport is not compared against this grid', async () => {
  const report = await expectIncomplete(
    measurementDocument((document) => {
      document.routes[0].widths[0].viewportWidth = 1440
      return document
    }),
    contractDocument(),
    'viewport-width-mismatch',
  )
  const finding = report.findings.find((entry) => entry.ruleId === 'viewport-width-mismatch')
  assert.match(finding.message, /recorded at a viewport of 1440, but the contract computes its columns for 1280/u)
  assert.match(finding.message, /none of its 2 box\(es\) were compared/u)
})

test('a width with no viewport recorded at all is refused rather than assumed', async () => {
  await expectIncomplete(
    measurementDocument((document) => {
      delete document.routes[0].widths[0].viewportWidth
      return document
    }),
    contractDocument(),
    'viewport-width-mismatch',
  )
})

test('the same element recorded twice at one width is ambiguous and neither box is used', async () => {
  const report = await expectIncomplete(
    measurementDocument(withWideBoxes([
      box('summary-card', 40, 100, 384, 200),
      box('summary-card', 46, 100, 384, 200),
      box('alerts-card', 448, 100, 384, 200),
    ])),
    contractDocument(),
    'duplicate-box',
  )
  assert.ok(
    !ruleIds(report).includes('element-misaligned-left'),
    'the second box is not quietly judged; the element is reported as ambiguous',
  )
  assert.ok(ruleIds(report).includes('element-not-measured'), 'and its position is treated as unestablished')
})

test('measurements in another unit compare nothing', async () => {
  const report = await expectIncomplete(
    measurementDocument((document) => {
      document.capture.unit = 'rem'
      return document
    }),
    contractDocument(),
    'unit-unsupported',
  )
  assert.equal(report.summary.checked, 0)
  assert.equal(report.findings.length, 1, 'nothing else is reported about coordinates that were never compared')
})

test('measurements holding no route at all are reported rather than passed', async () => {
  const report = await expectIncomplete(
    measurementDocument((document) => {
      document.routes = []
      return document
    }),
    contractDocument(),
    'no-boxes-checked',
  )
  assert.equal(report.summary.checked, 0)
})

test('a document that cannot be read is reported as unread, never as absent', async () => {
  const dir = await tempDir()
  const contractPath = await writeJson(dir, 'contract.json', contractDocument())
  const result = await runCli(['--measurements', join(dir, 'missing.json'), '--contract', contractPath])
  const report = reportFrom(result)
  assert.equal(result.code, 2)
  assert.equal(report.status, 'incomplete')
  assert.deepEqual(ruleIds(report), ['measurements-unreadable'])
  assert.match(report.findings[0].message, /ENOENT/u)
})

test('a document whose bytes are not UTF-8 is reported as undecodable', async () => {
  const dir = await tempDir()
  const measurementsPath = join(dir, 'measurements.json')
  await writeFile(measurementsPath, Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]))
  const contractPath = await writeJson(dir, 'contract.json', contractDocument())
  const result = await runCli(['--measurements', measurementsPath, '--contract', contractPath])
  assert.equal(result.code, 2)
  assert.deepEqual(ruleIds(reportFrom(result)), ['measurements-not-utf8'])
})

test('a document that is not valid JSON is reported without reproducing it', async () => {
  const result = await measureFixture('{"schemaVersion": AKIAIOSFODNN7EXAMPLE}', contractDocument())
  const report = reportFrom(result)
  assert.equal(result.code, 2)
  assert.deepEqual(ruleIds(report), ['measurements-unparsable'])
  assert.ok(!report.findings[0].message.includes('AKIAIOSFODNN7EXAMPLE'), 'the document is never quoted back')
})

test('a structurally wrong document is reported as invalid rather than compared', async () => {
  for (const [what, alter] of [
    ['not an object', () => '"a string"'],
    ['wrong schemaVersion', (document) => ({ ...document, schemaVersion: '9' })],
    ['unknown key', (document) => ({ ...document, extra: 1 })],
    ['routes not an array', (document) => ({ ...document, routes: {} })],
    ['a repeated route', (document) => ({ ...document, routes: [document.routes[0], document.routes[0]] })],
  ]) {
    const result = await measureFixture(alter(measurementDocument()), contractDocument())
    const report = reportFrom(result)
    assert.equal(result.code, 2, what)
    assert.equal(report.status, 'incomplete', what)
    assert.deepEqual(ruleIds(report), ['measurements-invalid'], what)
  }
})

test('every warning-severity evidence rule depends on its membership of EVIDENCE_MISSING_RULES', () => {
  // Defect class 3: where the accompanying finding is not an error, membership
  // of this list is the ONLY thing preventing a pass. Removing it here is the
  // same edit as deleting it from the source.
  const warnings = EVIDENCE_MISSING_RULES.filter((ruleId) => RULE_SEVERITY[ruleId] === 'warning')
  assert.ok(warnings.length >= 1, 'the guarantee is vacuous if every evidence rule is an error')

  for (const ruleId of warnings) {
    assert.equal(statusFor([{ ruleId, severity: 'warning', message: 'x', location: {} }]), 'incomplete', ruleId)
    assert.equal(
      statusFor([{ ruleId: 'element-unknown', severity: 'info', message: 'x', location: {} }]),
      'pass',
      `a non-error finding outside the list passes, so ${ruleId} rests on that list`,
    )
  }
})
