/**
 * What a JSON parse failure is allowed to say about a document this tool did
 * not write.
 *
 * V8 reports a failure two ways and one of them quotes the input back, so a
 * capture short enough to be only a credential is reproduced in full by its own
 * error message. The order of the branches is the whole guard: a document whose
 * own text reads `at position 1` makes V8 quote that phrase, and a helper that
 * looks for the offset first finds it INSIDE the quoted span and slices the
 * document straight back out. Nineteen of thirty-eight tools in this catalog
 * shipped exactly that bug.
 */

import { strict as assert } from 'node:assert'
import test from 'node:test'

import { parseFailureDetail } from '../src/index.mjs'

const UNPARSEABLE = 'the document could not be parsed as JSON'

function detailFor(document) {
  try {
    JSON.parse(document)
  } catch (error) {
    return { message: error.message, detail: parseFailureDetail(error) }
  }
  throw new Error('the fixture parsed, so there is nothing to describe')
}

test('a document whose own text reads "at position 1" is not sliced back out', () => {
  const { message, detail } = detailFor('at position 1')
  assert.match(message, /"at position 1"/u, 'V8 quotes the document')
  assert.equal(detail, "unexpected token 'a' at the start of the document")
  assert.ok(!detail.includes('at position 1'), 'the position branch must not win over the quoting branch')
})

test('a credential-only document is never reproduced', () => {
  const { detail } = detailFor('AKIAIOSFODNN7EXAMPLE')
  assert.equal(detail, "unexpected token 'A' at the start of the document")
  assert.ok(!detail.includes('AKIAIOSFODNN7EXAMPLE'))
})

test('a long document with a sensitive prefix is never reproduced', () => {
  const { message, detail } = detailFor(`password=hunter2 ${'x'.repeat(400)}`)
  assert.match(message, /"password=h"\.\.\./u, 'V8 quotes the first characters')
  assert.equal(detail, "unexpected token 'p' at the start of the document")
  assert.ok(!detail.includes('password'))
})

test('a quoted span containing a newline is still recognised as a quoted span', () => {
  const { message, detail } = detailFor('aaa\nbbb')
  assert.ok(message.includes('\n'), 'the quoted span carries a newline')
  assert.equal(detail, "unexpected token 'a' at the start of the document")
  assert.ok(!detail.includes('bbb'), 'a pattern without the s flag would miss this shape')
})

test('a quoted span taken from the middle of the document is named as such', () => {
  const { detail } = detailFor('{"alpha": ZQXJVBMP7W}')
  assert.equal(detail, "unexpected token 'Z' inside the document")
  assert.ok(!detail.includes('ZQXJVBMP7W'))
})

test('the safe positional form still yields position, line and column', () => {
  const { detail } = detailFor('{"alpha":1,}')
  assert.equal(detail, 'Expected double-quoted property name in JSON at position 11 (line 1 column 12)')
  assert.match(detail, /position \d+/u)
  assert.match(detail, /line \d+ column \d+/u)
})

test('a truncated document keeps its own wording', () => {
  const { detail } = detailFor('{"a":')
  assert.equal(detail, 'Unexpected end of JSON input')
})

test('the backstop catches a wording the branches have never been taught', () => {
  // A future V8 could quote a snippet in a sentence this helper does not know.
  // Any surviving double quote means a snippet survived, whatever the branches
  // above concluded, because V8 quotes JSON punctuation with apostrophes.
  const invented = { message: 'Some new wording about "secret-token-value" in JSON at position 4' }
  assert.equal(parseFailureDetail(invented), UNPARSEABLE)

  const noQuote = { message: "Unexpected non-whitespace character after JSON at position 4 (line 1 column 5)" }
  assert.equal(parseFailureDetail(noQuote), noQuote.message)
})

test('a missing or unusual error object does not stop the run', () => {
  assert.equal(parseFailureDetail(undefined), UNPARSEABLE)
  assert.equal(parseFailureDetail({}), UNPARSEABLE)
  assert.equal(parseFailureDetail({ message: { toString: {} } }), UNPARSEABLE)
})
