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

import { describeValue, isRenderableString, makeFinding, msg, renderReport, sanitize } from '../src/index.mjs'
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
  // This test used to set capture.id -- a field that never reaches the report --
  // and assert that stdout held no raw separator, which was true whether or not
  // renderReport escaped anything. Deleting the escaping left the suite green.
  //
  // Both halves of the name are checked now. Stripping: an element name is an
  // identifier that does reach the report, and the separator must be gone from
  // the string itself. Escaping: renderReport is exported, a consumer may hand
  // it a report it assembled itself, and inside a JavaScript string literal
  // U+2028 and U+2029 are line terminators -- so the payload must carry the
  // escape text, losslessly.
  const result = await measureFixture(
    measurementDocument(withWideBoxes([box('summary\u2028card', 40, 100, 384, 200)])),
    contractDocument(),
  )
  assert.ok(!result.stdout.includes('\u2028'), 'stdout never carries a raw line separator')
  assert.ok(
    reportFrom(result).findings.some((finding) => /\bsummary card\b/u.test(finding.message)),
    'the separator was stripped from the identifier, not passed on',
  )

  for (const [name, character, escape] of [
    ['line separator', '\u2028', '\\u2028'],
    ['paragraph separator', '\u2029', '\\u2029'],
  ]) {
    const assembled = {
      schemaVersion: '1',
      tool: 'layout-grid-measurement',
      status: 'fail',
      disclaimer: 'x',
      summary: { checked: 1, errors: 1, warnings: 0, info: 0, routes: 1, widths: 1, boxes: 1 },
      findings: [{
        ruleId: 'element-misaligned-left',
        severity: 'error',
        message: `summary${character}card`,
        location: { file: 'measurements.json', pointer: '/routes/dashboard' },
      }],
    }
    const rendered = renderReport(assembled)
    assert.ok(!rendered.includes(character), `${name} survived into the payload raw`)
    assert.ok(rendered.includes(escape), `${name} is not escaped in the payload`)
    assert.deepEqual(JSON.parse(rendered), assembled, `${name}: the escape must be lossless`)
  }
})

test('a name holding ~ or / is escaped as a JSON Pointer rather than pasted into one', async () => {
  // The README promises the pointer is a field path "with `~` and `/` inside a
  // name escaped as JSON Pointer requires". The escaping worked and nothing
  // defended it: removing both replaces left every test green, so a pointer that
  // silently stopped being a valid JSON Pointer would have shipped.
  const result = await measureFixture(
    measurementDocument((document) => {
      document.routes[0].name = 'a/b~c'
      return document
    }),
    contractDocument((document) => {
      document.elements = ['x/y~z', ...document.elements]
      document.widths[0].spans = { 'x/y~z': { start: 1, end: 4 } }
      document.widths[1].elements = ['x/y~z']
      return document
    }),
  )
  const report = reportFrom(result)
  const finding = report.findings.find((entry) => entry.location.pointer.includes('~1y'))
  assert.ok(finding !== undefined, `no pointer named the element: ${report.findings.map((f) => f.location.pointer)}`)
  assert.equal(finding.location.pointer, '/routes/a~1b~0c/widths/mobile/boxes/x~1y~0z')

  // RFC 6901 in reverse: ~1 back to /, then ~0 back to ~. Unescaping the
  // pointer must give back the names the documents used, token for token.
  const tokens = finding.location.pointer.split('/').slice(1)
    .map((token) => token.replace(/~1/gu, '/').replace(/~0/gu, '~'))
  assert.deepEqual(tokens, ['routes', 'a/b~c', 'widths', 'mobile', 'boxes', 'x/y~z'])
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
  // The name used to be half true: the body checked the evidence and never
  // looked at a suggestion, and a suggestion was the one string that reached
  // output without crossing the sanitiser. Both are checked here now, and
  // makeFinding sanitises the suggestion, so the sentence is true rather than
  // narrowed to what the body happened to do.
  const finding = makeFinding(
    'element-misaligned-left',
    msg`bounded`,
    { file: 'measurements.json' },
    { evidence: `${'e'.repeat(400)}\u0085tail`, suggestion: `${'s'.repeat(400)}\u0085tail` },
  )
  assert.ok(finding.evidence.length <= 200)
  assert.ok(finding.evidence.endsWith('...'))
  assert.ok(!finding.evidence.includes('\u0085'))

  assert.ok(finding.suggestion.length <= 200)
  assert.ok(finding.suggestion.endsWith('...'))
  assert.ok(!finding.suggestion.includes('\u0085'))

  const plain = makeFinding('element-misaligned-left', msg`bounded`, { file: 'measurements.json' })
  assert.equal('suggestion' in plain, false, 'a finding built without one carries no suggestion key')
})

test('a finding carries into the report the suggestion it was built with', async () => {
  // Nothing asserted this. Rewriting makeFinding so that no finding ever
  // carried a suggestion left all 129 tests green, and every report lost a
  // field the README documents -- along with the forbidden-claim check on the
  // suggestion, which the only test that looked at one made vacuous by reading
  // `finding.suggestion ?? ''`.
  const report = reportFrom(await measureFixture(
    measurementDocument(withWideBoxes([box('summary-card', 40, 100, 384, 200)])),
    contractDocument(),
  ))
  const finding = report.findings.find((entry) => entry.ruleId === 'element-not-measured')
  assert.equal(finding.suggestion, 'Record a box for every element the contract expects at this width.')

  assert.throws(
    () => makeFinding('element-misaligned-left', msg`x`, { file: 'm.json' }, { suggestion: 'Check how it rendered' }),
    /A finding suggestion may not claim this tool observed an interface/u,
    'the suggestion is checked for the claims this tool may not make',
  )
})
