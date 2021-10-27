/**
 * What an untrusted string may do to the report.
 *
 * Four tools in this catalog stripped the C0 range and the two separators and
 * let the C1 range through, where U+0085 forges a line just as a newline does.
 * Another sanitised its evidence field carefully and let an identifier carrying
 * a newline forge whole lines. So every class is tested, and each is tested
 * arriving through an element name -- an identifier -- as well as through an
 * excerpt.
 *
 * Every control character in this file is written as escape text. A raw byte in
 * the source would make the test pass for the wrong reason.
 */

import { strict as assert } from 'node:assert'
import test from 'node:test'

import { describeValue, isRenderableString, makeFinding, msg, sanitize } from '../src/index.mjs'
import { box, contractDocument, measureFixture, measurementDocument, reportFrom, withWideBoxes } from './helpers.mjs'

const CLASSES = Object.freeze([
  ['C0 NUL', '\u0000'],
  ['C0 line feed', '\u000A'],
  ['C0 escape', '\u001B'],
  ['DEL', '\u007F'],
  ['C1 next line', '\u0085'],
  ['C1 control sequence introducer', '\u009B'],
  ['line separator', '\u2028'],
  ['paragraph separator', '\u2029'],
  ['bidi left-to-right mark', '\u200E'],
  ['bidi right-to-left mark', '\u200F'],
  ['bidi left-to-right embedding', '\u202A'],
  ['bidi right-to-left override', '\u202E'],
  ['bidi left-to-right isolate', '\u2066'],
  ['bidi pop directional isolate', '\u2069'],
])

test('every control class is stripped from a sanitised string', () => {
  for (const [name, character] of CLASSES) {
    const flattened = sanitize(`before${character}after`)
    assert.equal(flattened, 'before after', name)
    assert.ok(!flattened.includes(character), name)
  }
})

function everyString(value, into = []) {
  if (typeof value === 'string') into.push(value)
  else if (Array.isArray(value)) for (const entry of value) everyString(entry, into)
  else if (value !== null && typeof value === 'object') for (const entry of Object.values(value)) everyString(entry, into)
  return into
}

async function runWithElementName(name) {
  const contract = contractDocument((document) => {
    document.elements = [name, 'alerts-card']
    document.widths[0].spans = { [name]: { start: 1, end: 4 }, 'alerts-card': { start: 5, end: 8 } }
    document.widths[1].elements = [name, 'alerts-card']
    return document
  })
  const measurements = measurementDocument(withWideBoxes([
    box(name, 46, 100, 384, 200),
    box('alerts-card', 448, 100, 384, 200),
  ]))
  measurements.routes[0].widths[1].boxes = [
    box(name, 16, 100, 343, 200),
    box('alerts-card', 16, 320, 343, 200),
  ]
  return measureFixture(measurements, contract)
}

test('every control class is stripped when it arrives through an identifier', async () => {
  // Checking the serialised payload is not enough: JSON.stringify escapes a
  // control character on its way out, so the string inside the report is
  // inspected directly, and the human summary is compared against a benign run
  // line for line -- a forged line is exactly what these characters buy.
  const benign = await runWithElementName('summary-card')
  const benignLines = benign.stderr.split('\n').length

  for (const [name, character] of CLASSES) {
    const result = await runWithElementName(`summary${character}card`)
    for (const text of everyString(reportFrom(result))) {
      assert.ok(!text.includes(character), `${name} survived into a report string: ${JSON.stringify(text)}`)
    }
    assert.equal(result.stderr.split('\n').length, benignLines, `${name} forged a line in the human summary`)
  }
})

test('a separator is escaped in the rendered payload as well as stripped', async () => {
  const measurements = measurementDocument((document) => {
    document.capture.id = 'dashboard\u2028audit'
    return document
  })
  const result = await measureFixture(measurements, contractDocument())
  assert.ok(!result.stdout.includes('\u2028'), 'stdout never carries a raw line separator')
})

test('a value that cannot be converted to a primitive costs nothing', () => {
  const hostile = { toString: {} }
  assert.throws(() => String(hostile), /Cannot convert object to primitive value/u)
  assert.equal(describeValue(hostile), '[object]')
  assert.equal(sanitize(hostile), '[object]')
  assert.equal(sanitize([1, 2, 3]), '[array]', 'an array is described by its shape, not reproduced')
  assert.equal(sanitize(undefined), 'undefined')
  assert.equal(sanitize(null), 'null')
  assert.equal(String(msg`id ${hostile} seen`), 'id [object] seen')
})

test('a document holding a value that cannot be stringified still produces a report', async () => {
  // JSON cannot express { toString: {} } directly, but an element name that is
  // an object reaches the same code path: the run must report, not abort.
  const measurements = measurementDocument(withWideBoxes([
    { ...box('summary-card', 40, 100, 384, 200), element: { toString: {} } },
  ]))
  const result = await measureFixture(measurements, contractDocument())
  assert.notEqual(result.stdout, '', 'stdout must not be empty')
  const report = reportFrom(result)
  assert.equal(report.status, 'incomplete')
  assert.equal(result.code, 2)
})

test('a string that renders as nothing is not a renderable name', () => {
  for (const [name, character] of CLASSES) {
    assert.equal(isRenderableString(character.repeat(3)), false, name)
  }

  // trim removes ECMAScript whitespace only, so every one of these survives it:
  // a schema check of `value.trim().length > 0` accepts a name that renders as
  // nothing at all. That is the sibling bug this helper exists to avoid.
  for (const survivor of ['\u0000', '\u001B', '\u007F', '\u0085', '\u009B', '\u200E', '\u202E', '\u2066']) {
    assert.ok(survivor.repeat(3).trim().length > 0, 'trim is the wrong question')
    assert.equal(isRenderableString(survivor.repeat(3)), false)
  }
  assert.equal(isRenderableString(''), false)
  assert.equal(isRenderableString('   '), false)
  assert.equal(isRenderableString('save-button'), true)
  assert.equal(isRenderableString(42), false)
  assert.equal(isRenderableString('x'.repeat(1000)), false, 'a name is bounded')
})

test('an identifier that renders as nothing is refused rather than reported as empty', async () => {
  const measurements = measurementDocument(withWideBoxes([
    { ...box('summary-card', 40, 100, 384, 200), element: '\u200E\u200F' },
  ]))
  const result = await measureFixture(measurements, contractDocument())
  const report = reportFrom(result)
  assert.equal(report.status, 'incomplete')
  assert.ok(report.findings.some((finding) => finding.ruleId === 'box-invalid'))
})

test('evidence and suggestions are bounded and flattened too', () => {
  const finding = makeFinding(
    'element-misaligned-left',
    msg`bounded`,
    { file: 'measurements.json' },
    { evidence: `${'e'.repeat(400)}\u0085tail` },
  )
  assert.ok(finding.evidence.length <= 200)
  assert.ok(finding.evidence.endsWith('...'))
  assert.ok(!finding.evidence.includes('\u0085'))
})
