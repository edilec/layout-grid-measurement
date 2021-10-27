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

import { ContractError, DEFAULT_LIMITS, LIMIT_NAMES, STACKINGS, validateContract } from '../src/index.mjs'
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

test('the contract is bounded', () => {
  refuses((d) => {
    d.widths = Array.from({ length: 33 }, (_, index) => ({ ...d.widths[1], name: `w${index}` }))
    return d
  }, /over the bound of 32/u)
  refuses((d) => { d.widths[0].grid.columns = 65; return d }, /over the bound of 64/u)
  refuses((d) => { d.elements = []; return d }, /must be a non-empty array/u)
})

test('a name that renders as nothing is refused', () => {
  refuses((d) => { d.unit = '   '; return d }, /unit must be a name that is visible/u)
  refuses((d) => { d.widths[0].name = ''; return d }, /name must be a name that is visible/u)
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
