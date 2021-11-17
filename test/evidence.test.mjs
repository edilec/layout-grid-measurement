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

test('a stacked width says so in its evidence rather than describing a grid', async () => {
  // The evidence for viewport-width-mismatch comes from describeWidth, which
  // has a branch per stacking -- and every fixture that reached it used the
  // grid width, so the stacked branch was removable in silence. Without it a
  // stacked width is described as "1 columns of 343 with a gutter of 0", which
  // is a grid the contract explicitly says does not apply there: a claim about
  // the contract that the contract does not make.
  const grid = await expectIncomplete(
    measurementDocument((document) => {
      document.routes[0].widths[0].viewportWidth = 1440
      return document
    }),
    contractDocument(),
    'viewport-width-mismatch',
  )
  assert.equal(
    grid.findings.find((entry) => entry.ruleId === 'viewport-width-mismatch').evidence,
    '12 columns of 78 with a gutter of 24 at 1280',
  )

  const stacked = await expectIncomplete(
    measurementDocument((document) => {
      document.routes[0].widths[1].viewportWidth = 414
      return document
    }),
    contractDocument(),
    'viewport-width-mismatch',
  )
  assert.equal(
    stacked.findings.find((entry) => entry.ruleId === 'viewport-width-mismatch').evidence,
    'stacked content 16..359 at 375',
  )
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
  ['not a JSON object', () => '"a string"', '', 'The measurement document is not a JSON object.'],
  ['an unknown top-level key', (d) => ({ ...d, extra: 1 }), '', 'the measurement document holds the unknown key "extra".'],
  ['an unsupported schemaVersion', (d) => ({ ...d, schemaVersion: '9' }), '/schemaVersion', 'Unsupported measurement schemaVersion: 9.'],
  ['capture that is not an object', (d) => ({ ...d, capture: 'fixture' }), '/capture', 'capture must be an object holding id and unit.'],
  ['an unknown key in capture', (d) => { d.capture.extra = 1; return d }, '/capture', 'capture holds the unknown key "extra".'],
  ['a blank capture.id', (d) => { d.capture.id = ''; return d }, '/capture/id', 'capture.id must be at most 128 characters long and hold at least one visible character.'],
  ['a blank capture.unit', (d) => { d.capture.unit = ''; return d }, '/capture/unit', 'capture.unit must name the unit every coordinate is in.'],
  ['routes that are not an array', (d) => { d.routes = {}; return d }, '/routes', 'routes must be an array.'],
  ['a route that is not an object', (d) => { d.routes[0] = 'dashboard'; return d }, '/routes/0', 'A route must be an object.'],
  ['an unknown key in a route', (d) => { d.routes[0].extra = 1; return d }, '/routes/0', 'a route holds the unknown key "extra".'],
  ['a route with a number for a name', (d) => { d.routes[0].name = 7; return d }, '/routes/0', 'A route name must be at most 128 characters long and hold at least one visible character.'],
  ['the same route twice', (d) => { d.routes.push({ ...d.routes[0] }); return d }, '/routes/1', 'Route dashboard appears more than once, so its coverage is ambiguous.'],
  ['widths that are not an array', (d) => { d.routes[0].widths = {}; return d }, '/routes/0', 'Route dashboard: widths must be an array.'],
  ['a width that is not an object', (d) => { d.routes[0].widths[0] = 'wide'; return d }, '/routes/0/widths/0', 'A width must be an object.'],
  ['an unknown key in a width', (d) => { d.routes[0].widths[0].extra = 1; return d }, '/routes/0/widths/0', 'a width holds the unknown key "extra".'],
  ['a width that names nothing', (d) => { delete d.routes[0].widths[0].name; return d }, '/routes/0/widths/0', 'A width name must be at most 128 characters long and hold at least one visible character.'],
  ['two sets of boxes for one width', (d) => { d.routes[0].widths[1].name = 'wide'; return d }, '/routes/0/widths/1', 'Route dashboard holds two sets of boxes for width wide, so its coordinates are ambiguous.'],
  ['boxes that are not an array', (d) => { d.routes[0].widths[0].boxes = {}; return d }, '/routes/0/widths/0', 'A width must hold an array of boxes.'],
])

test('every way a document can be structurally wrong produces a report, never empty stdout', async () => {
  const messages = new Set()
  for (const [what, alter, pointer, message] of MALFORMED_DOCUMENTS) {
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
    // The message matters as much as the rule id: several of these branches are
    // reached by more than one route through readMeasurements, and a sweep that
    // deleted one of them reached the next with a different sentence while the
    // rule id and the pointer stayed the same.
    assert.equal(report.findings[0].message, message, what)
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

/**
 * Every branch of `readBox` that refuses a record, and the sentence it reports.
 */
const MALFORMED_BOXES = Object.freeze([
  ['not an object', () => 'summary-card', 'a box must be an object'],
  ['an unknown key', (b) => ({ ...b, extra: 1 }), 'the box holds the unknown key "extra"'],
  ['a blank element name', (b) => ({ ...b, element: '' }), 'element must be at most 128 characters long and hold at least one visible character'],
  ['no x', (b) => { const { x, ...rest } = b; return rest }, 'x must be a finite number'],
  ['a y that is a string', (b) => ({ ...b, y: '100' }), 'y must be a finite number'],
  ['a negative width', (b) => ({ ...b, width: -1 }), 'width must be 0 or more'],
  ['no height', (b) => { const { height, ...rest } = b; return rest }, 'height must be a finite number'],
])

test('every way a box can be wrong is reported, with the reason', async () => {
  const reasons = new Set()
  for (const [what, alter, reason] of MALFORMED_BOXES) {
    const report = await expectIncomplete(
      measurementDocument(withWideBoxes([alter(box('summary-card', 40, 100, 384, 200)), box('alerts-card', 448, 100, 384, 200)])),
      contractDocument(),
      'box-invalid',
    )
    const finding = report.findings.find((entry) => entry.ruleId === 'box-invalid')
    assert.equal(finding.message, `A box was not compared: ${reason}.`, what)
    reasons.add(finding.message)
  }
  assert.equal(reasons.size, MALFORMED_BOXES.length, 'each row must reach a branch of its own')
})

test('the malformed-box table still covers every branch that refuses a record', async () => {
  // A staleness guard on the table above. `readBox` returns rather than throws,
  // so the branches are counted by their return shape: six of them, one of which
  // reports two different reasons (a missing coordinate and a negative size).
  const source = await readFile(join(ROOT, 'src', 'measurements.mjs'), 'utf8')
  const readBoxBody = source.slice(source.indexOf('export function readBox'), source.indexOf('export function pointerFor'))
  assert.equal((readBoxBody.match(/ok: false/gu) ?? []).length, 5, 'a refusal branch has no row in MALFORMED_BOXES')
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
