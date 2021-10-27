/**
 * The CLI surface a consumer relies on: which stream carries what, and which
 * exit code means what.
 *
 * Exit 2 has two shapes and the difference is load-bearing. A configuration
 * error means the run never had a subject, so stdout stays EMPTY. Evidence the
 * run could not obtain means the run had a subject, so stdout carries an
 * `incomplete` report naming what was not established.
 */

import { strict as assert } from 'node:assert'
import { join } from 'node:path'
import test from 'node:test'

import {
  box,
  contractDocument,
  measureFixture,
  measurementDocument,
  reportFrom,
  runCli,
  tempDir,
  withWideBoxes,
  writeJson,
} from './helpers.mjs'

const MISALIGNED = () => measurementDocument(withWideBoxes([
  box('summary-card', 40, 100, 384, 200),
  box('alerts-card', 454, 100, 378, 200),
]))

test('stdout carries the report and nothing else', async () => {
  const result = await measureFixture(measurementDocument(), contractDocument())
  const report = JSON.parse(result.stdout)
  assert.equal(report.tool, 'layout-grid-measurement')
  assert.equal(report.schemaVersion, '1')
  assert.equal(result.stdout.endsWith('}\n'), true, 'one trailing newline, nothing after the document')
  assert.ok(result.stderr.length > 0, 'the human summary goes to stderr')
})

test('--json suppresses the human summary without changing stdout', async () => {
  const plain = await measureFixture(measurementDocument(), contractDocument())
  const quiet = await measureFixture(measurementDocument(), contractDocument(), ['--json'])
  assert.equal(quiet.stdout, plain.stdout)
  assert.equal(quiet.stderr, '')
})

test('--help explains the tool on stderr and exits 0', async () => {
  for (const flag of ['--help', '-h']) {
    const result = await runCli([flag])
    assert.equal(result.code, 0, flag)
    assert.equal(result.stdout, '', 'help is not a report')
    assert.match(result.stderr, /layout-grid-measurement/u)
    assert.match(result.stderr, /--measurements FILE/u)
    assert.match(result.stderr, /--contract FILE/u)
    assert.match(result.stderr, /--now INSTANT/u)
  }
})

test('the help text says the tool collects nothing and writes nothing', async () => {
  const { stderr } = await runCli(['--help'])
  assert.match(stderr, /collects nothing/u)
  assert.match(stderr, /opens no browser/u)
  assert.match(stderr, /opaque name\s+rather than an address/u)
  assert.match(stderr, /No file is written/u)
  assert.match(stderr, /DOCUMENTED rather than discovered/u)
})

test('an unknown option is refused with empty stdout', async () => {
  const result = await runCli(['--measurements', 'x', '--contract', 'y', '--verbose'])
  assert.equal(result.code, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /Unknown option "--verbose"/u)
})

test('a missing required option is refused with empty stdout', async () => {
  const noMeasurements = await runCli(['--contract', 'y'])
  assert.equal(noMeasurements.code, 2)
  assert.equal(noMeasurements.stdout, '')
  assert.match(noMeasurements.stderr, /--measurements is required/u)

  const noContract = await runCli(['--measurements', 'x'])
  assert.equal(noContract.code, 2)
  assert.equal(noContract.stdout, '')
  assert.match(noContract.stderr, /--contract is required/u)

  const noValue = await runCli(['--contract'])
  assert.equal(noValue.code, 2)
  assert.equal(noValue.stdout, '')
  assert.match(noValue.stderr, /--contract requires a value/u)
})

test('the two shapes of exit 2 are distinguishable by a consumer piping stdout', async () => {
  const configuration = await runCli(['--measurements', 'x', '--contract', 'y', '--oops'])
  assert.equal(configuration.code, 2)
  assert.equal(configuration.stdout, '', 'a run that never had a subject reports nothing')

  const dir = await tempDir()
  const contractPath = await writeJson(dir, 'contract.json', contractDocument())
  const evidence = await runCli(['--measurements', join(dir, 'absent.json'), '--contract', contractPath])
  assert.equal(evidence.code, 2)
  assert.equal(reportFrom(evidence).status, 'incomplete', 'a run that lost its evidence says which evidence')
  assert.equal(reportFrom(evidence).findings[0].location.file, 'absent.json')
})

test('exit 0, 1 and 2 each mean what the help text says', async () => {
  const passing = await measureFixture(measurementDocument(), contractDocument())
  assert.equal(passing.code, 0)
  assert.equal(reportFrom(passing).status, 'pass')

  const failing = await measureFixture(MISALIGNED(), contractDocument())
  assert.equal(failing.code, 1)
  assert.equal(reportFrom(failing).status, 'fail')

  const incomplete = await measureFixture(
    measurementDocument((document) => {
      document.routes[0].widths = [document.routes[0].widths[0]]
      return document
    }),
    contractDocument(),
  )
  assert.equal(incomplete.code, 2)
  assert.equal(reportFrom(incomplete).status, 'incomplete')
})

test('the report never carries an absolute host path', async () => {
  const result = await measureFixture(MISALIGNED(), contractDocument())
  assert.ok(!result.stdout.includes('/var/'), result.stdout.slice(0, 200))
  assert.ok(!result.stdout.includes('/Users/'), result.stdout.slice(0, 200))
  assert.equal(reportFrom(result).findings[0].location.file, 'measurements.json')
})

test('the human summary names every finding and closes with the status', async () => {
  const result = await measureFixture(MISALIGNED(), contractDocument())
  const lines = result.stderr.trim().split('\n')
  assert.match(lines[0], /^ERROR {3}element-misaligned-left/u)
  assert.match(result.stderr, /Status fail\./u)
  assert.match(result.stderr, /collects nothing/u, 'the disclaimer is on every human summary too')
})
