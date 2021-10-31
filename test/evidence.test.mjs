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
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { EVIDENCE_MISSING_RULES, RULE_SEVERITY, findForbiddenClaim, statusFor } from '../src/index.mjs'
import {
  ROOT,
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

/**
 * Every branch of `readMeasurements` that refuses a document, with the field
 * path it reports. The table is exhaustive on purpose, and the test below
 * checks that it still is.
 *
 * The reason it is exhaustive: two of these branches used to abort the run with
 * EMPTY stdout and exit 2 -- the shape the contract reserves for a
 * configuration error -- because their own wording tripped the tool's
 * forbidden-claim guard. The five-case version of this test drove neither.
 */
const MALFORMED_DOCUMENTS = Object.freeze([
  ['not a JSON object', () => '"a string"', ''],
  ['an unknown top-level key', (d) => ({ ...d, extra: 1 }), ''],
  ['an unsupported schemaVersion', (d) => ({ ...d, schemaVersion: '9' }), '/schemaVersion'],
  ['capture that is not an object', (d) => ({ ...d, capture: 'fixture' }), '/capture'],
  ['an unknown key in capture', (d) => { d.capture.extra = 1; return d }, '/capture'],
  ['a blank capture.id', (d) => { d.capture.id = ''; return d }, '/capture/id'],
  ['a blank capture.unit', (d) => { d.capture.unit = ''; return d }, '/capture/unit'],
  ['routes that are not an array', (d) => { d.routes = {}; return d }, '/routes'],
  ['a route that is not an object', (d) => { d.routes[0] = 'dashboard'; return d }, '/routes/0'],
  ['an unknown key in a route', (d) => { d.routes[0].extra = 1; return d }, '/routes/0'],
  ['a route with a number for a name', (d) => { d.routes[0].name = 7; return d }, '/routes/0'],
  ['the same route twice', (d) => { d.routes.push({ ...d.routes[0] }); return d }, '/routes/1'],
  ['widths that are not an array', (d) => { d.routes[0].widths = {}; return d }, '/routes/0'],
  ['a width that is not an object', (d) => { d.routes[0].widths[0] = 'wide'; return d }, '/routes/0/widths/0'],
  ['an unknown key in a width', (d) => { d.routes[0].widths[0].extra = 1; return d }, '/routes/0/widths/0'],
  ['a width that names nothing', (d) => { delete d.routes[0].widths[0].name; return d }, '/routes/0/widths/0'],
  ['two sets of boxes for one width', (d) => { d.routes[0].widths[1].name = 'wide'; return d }, '/routes/0/widths/1'],
  ['boxes that are not an array', (d) => { d.routes[0].widths[0].boxes = {}; return d }, '/routes/0/widths/0'],
])

test('every way a document can be structurally wrong produces a report, never empty stdout', async () => {
  const messages = new Set()
  for (const [what, alter, pointer] of MALFORMED_DOCUMENTS) {
    const result = await measureFixture(alter(measurementDocument()), contractDocument())
    assert.notEqual(
      result.stdout,
      '',
      `${what}: bad evidence must carry a report, not the empty stdout reserved for a configuration error`,
    )
    const report = reportFrom(result)
    assert.equal(result.code, 2, what)
    assert.equal(report.status, 'incomplete', what)
    assert.deepEqual(ruleIds(report), ['measurements-invalid'], what)
    assert.equal(report.findings[0].location.pointer, pointer, what)
    assert.equal(findForbiddenClaim(report.findings[0].message), null, `${what}: ${report.findings[0].message}`)
    messages.add(report.findings[0].message)
  }
  assert.equal(messages.size, MALFORMED_DOCUMENTS.length, 'each row must reach a branch of its own')
})

test('the malformed-document table still covers every branch that refuses a document', async () => {
  // A staleness guard on the table above, not a substitute for it: the test
  // that matters drives all 18 rows through the CLI. This one fails when a
  // branch is added and left undriven, which is how the last two got in.
  const source = await readFile(join(ROOT, 'src', 'measurements.mjs'), 'utf8')
  const branches = source.match(/return invalid\(/gu) ?? []
  assert.equal(branches.length, MALFORMED_DOCUMENTS.length, 'a refusal branch has no row in MALFORMED_DOCUMENTS')
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
