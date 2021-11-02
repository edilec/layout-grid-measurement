/**
 * The contract is the policy, so every problem with it is a configuration
 * error: stdout stays empty and the run exits 2.
 *
 * A one-character typo in a key must not turn a real failure into a green run,
 * so unknown keys are refused everywhere rather than ignored -- and a contract
 * that reads as coverage the tool would not perform is refused too.
 */

import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  ContractError,
  DEFAULT_LIMITS,
  LIMIT_NAMES,
  MAX_COLUMNS,
  MAX_CONTRACT_BYTES,
  MAX_ELEMENTS,
  MAX_WIDTHS,
  STACKINGS,
  validateContract,
} from '../src/index.mjs'
import { contractDocument, measureFixture, measurementDocument, runCli, tempDir, writeJson } from './helpers.mjs'

function refuses(alter, pattern) {
  assert.throws(() => validateContract(contractDocument(alter)), (error) => {
    assert.ok(error instanceof ContractError, `expected a ContractError, got ${error.name}`)
    assert.match(error.message, pattern)
    return true
  })
}

test('the fixture contract is valid, so the refusals below mean something', () => {
  const contract = validateContract(contractDocument())
  assert.equal(contract.unit, 'px')
  assert.equal(contract.tolerance, 0.5)
  assert.deepEqual([...contract.widths.keys()], ['wide', 'mobile'])
  assert.deepEqual([...contract.elements].sort(), ['alerts-card', 'summary-card'])
  assert.equal(contract.maxMeasurementAgeDays, null)
  assert.deepEqual(contract.limits, { ...DEFAULT_LIMITS })
})

test('an unknown key is refused wherever it appears', () => {
  refuses((d) => { d.width = []; return d }, /Unknown key "width"/u)
  refuses((d) => { d.widths[0].breakpoint = 'lg'; return d }, /Unknown key "breakpoint"/u)
  refuses((d) => { d.widths[0].grid.rows = 3; return d }, /Unknown key "rows"/u)
  refuses((d) => { d.widths[0].spans['summary-card'].span = 4; return d }, /Unknown key "span"/u)
  refuses((d) => { d.limits = { maxBox: 4 }; return d }, /Unknown limit "maxBox"/u)
})

test('an unsupported schemaVersion is refused rather than guessed at', () => {
  refuses((d) => { d.schemaVersion = '2'; return d }, /Unsupported contract schemaVersion: 2/u)
  refuses((d) => { delete d.schemaVersion; return d }, /Unsupported contract schemaVersion: missing/u)
})

test('a grid that cannot exist is refused before a box is read', () => {
  refuses((d) => { d.widths[0].grid.margin = 700; return d }, /leave no content width/u)
  refuses((d) => { d.widths[0].grid.gutter = 200; return d }, /leave no width for a column/u)
})

test('a span that runs off its own column count is refused', () => {
  refuses((d) => { d.widths[0].spans['alerts-card'].end = 13; return d }, /past the 12 columns declared here/u)
  refuses((d) => { d.widths[0].spans['alerts-card'].end = 1; return d }, /end is before/u)
  refuses((d) => { d.widths[0].spans['alerts-card'].start = 0; return d }, /start must be 1 or more/u)
  refuses((d) => { d.widths[0].spans['alerts-card'].start = 1.5; return d }, /start must be a whole number/u)
})

test('a span for an element the contract does not declare is refused', () => {
  refuses(
    (d) => { d.widths[0].spans['ghost-card'] = { start: 9, end: 12 }; return d },
    /names an element the contract's elements list does not declare/u,
  )
  refuses(
    (d) => { d.widths[1].elements = ['ghost-card']; return d },
    /which the contract's elements list does not declare/u,
  )
})

test('each width names the elements it expects exactly once, in the form its stacking gives meaning to', () => {
  refuses((d) => { d.widths[1].spans = { 'summary-card': { start: 1, end: 1 } }; return d },
    /declared stacked, so a span would not be checked/u)
  refuses((d) => { d.widths[0].elements = ['summary-card']; return d },
    /is a grid, so .* already names the elements expected here/u)
  refuses((d) => { delete d.widths[0].spans; return d }, /must be an object mapping each element/u)
  refuses((d) => { delete d.widths[1].elements; return d }, /must be a non-empty array naming the elements/u)
  refuses((d) => { d.widths[1].elements = []; return d }, /must be a non-empty array naming the elements/u)
})

test('a stacking the tool does not implement is refused rather than approximated', () => {
  refuses((d) => { d.widths[0].stacking = 'masonry'; return d }, /must be one of grid, stacked/u)
  refuses((d) => { delete d.widths[0].stacking; return d }, /must be one of grid, stacked/u)
  assert.deepEqual(STACKINGS, ['grid', 'stacked'])
})

test('a duplicate width or element is refused', () => {
  refuses((d) => { d.widths.push(d.widths[0]); return d }, /declares "wide" more than once/u)
  refuses((d) => { d.elements.push('summary-card'); return d }, /names "summary-card" more than once/u)
  refuses((d) => { d.widths[1].elements = ['summary-card', 'summary-card']; return d }, /more than once/u)
})

test('a tolerance that is not a usable number is refused', () => {
  refuses((d) => { d.tolerance = -1; return d }, /tolerance must be 0 or more/u)
  refuses((d) => { d.tolerance = '0.5'; return d }, /tolerance must be a finite number/u)
  refuses((d) => { d.widths[0].tolerance = -1; return d }, /tolerance must be 0 or more/u)
  assert.equal(validateContract(contractDocument((d) => { delete d.tolerance; return d })).tolerance, 0)
})

test('limits are validated and every documented limit name is accepted', () => {
  for (const name of LIMIT_NAMES) {
    const contract = validateContract(contractDocument((d) => { d.limits = { [name]: 7 }; return d }))
    assert.equal(contract.limits[name], 7, name)
  }
  refuses((d) => { d.limits = { maxRoutes: 0 }; return d }, /maxRoutes must be 1 or more/u)
  refuses((d) => { d.limits = { maxRoutes: 1.5 }; return d }, /maxRoutes must be a whole number/u)
})

test('every bound on the contract itself bites at its documented value', async () => {
  // MAX_WIDTHS and MAX_COLUMNS had a test. MAX_ELEMENTS and MAX_CONTRACT_BYTES
  // did not, so raising either to an absurd value left the whole suite green and
  // a bound the README promises could have vanished. Each bound is driven at N
  // and at N + 1, because a bound asserted only from above is satisfied by a
  // guard that refuses everything.
  const elements = (count) => Array.from({ length: count }, (_, index) => `element-${index}`)

  assert.equal(
    validateContract(contractDocument((d) => {
      d.elements = [...d.elements, ...elements(MAX_ELEMENTS - d.elements.length)]
      return d
    })).elements.size,
    MAX_ELEMENTS,
    'the documented number of elements is accepted',
  )
  refuses((d) => {
    d.elements = [...d.elements, ...elements(MAX_ELEMENTS + 1 - d.elements.length)]
    return d
  }, /elements names 513 elements, over the bound of 512/u)

  assert.equal(
    validateContract(contractDocument((d) => {
      d.widths = Array.from({ length: MAX_WIDTHS }, (_, index) => ({ ...d.widths[1], name: `w${index}` }))
      return d
    })).widths.size,
    MAX_WIDTHS,
  )
  refuses((d) => {
    d.widths = Array.from({ length: MAX_WIDTHS + 1 }, (_, index) => ({ ...d.widths[1], name: `w${index}` }))
    return d
  }, /widths declares 33 widths, over the bound of 32/u)

  assert.equal(
    validateContract(contractDocument((d) => {
      d.widths[0].grid = { columns: MAX_COLUMNS, gutter: 0, margin: 40 }
      d.widths[0].spans = { 'summary-card': { start: 1, end: 1 }, 'alerts-card': { start: 2, end: 2 } }
      return d
    })).widths.get('wide').geometry.columns,
    MAX_COLUMNS,
  )
  refuses((d) => { d.widths[0].grid.columns = MAX_COLUMNS + 1; return d }, /columns is 65, over the bound of 64/u)

  refuses((d) => { d.elements = []; return d }, /must be a non-empty array/u)

  // The byte bound is enforced before the file is parsed, so the padding is
  // whitespace: still valid JSON, and it is the size that decides.
  const padded = (size) => {
    const body = JSON.stringify(contractDocument())
    return body + ' '.repeat(size - Buffer.byteLength(body))
  }
  const atLimit = await measureFixture(measurementDocument(), padded(MAX_CONTRACT_BYTES))
  assert.equal(atLimit.code, 0, 'a contract of exactly the documented size is read')

  const overLimit = await measureFixture(measurementDocument(), padded(MAX_CONTRACT_BYTES + 1))
  assert.equal(overLimit.code, 2)
  assert.equal(overLimit.stdout, '', 'a problem with the policy leaves stdout empty')
  assert.match(
    overLimit.stderr,
    /Could not load the contract: 1000001 bytes exceeds the 1000000 byte limit/u,
    'the message names the limit rather than failing later for another reason',
  )
})

test('a name that renders as nothing is refused', () => {
  refuses((d) => { d.unit = '   '; return d }, /unit must be a name at most 128 characters long that holds at least one visible character/u)
  refuses((d) => { d.widths[0].name = ''; return d }, /name must be a name at most 128 characters long that holds at least one visible character/u)
})

test('a contract that cannot be read or parsed leaves stdout empty', async () => {
  const dir = await tempDir()
  const measurementsPath = await writeJson(dir, 'measurements.json', measurementDocument())

  const missing = await runCli(['--measurements', measurementsPath, '--contract', `${dir}/absent.json`])
  assert.equal(missing.code, 2)
  assert.equal(missing.stdout, '')
  assert.match(missing.stderr, /Could not load the contract: ENOENT/u)

  const broken = await measureFixture(measurementDocument(), '{"schemaVersion": AKIAIOSFODNN7EXAMPLE}')
  assert.equal(broken.code, 2)
  assert.equal(broken.stdout, '')
  assert.match(broken.stderr, /The contract is not valid JSON/u)
  assert.ok(!broken.stderr.includes('AKIAIOSFODNN7EXAMPLE'), 'the contract is never quoted back either')
})
