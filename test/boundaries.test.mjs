/**
 * The boundaries the README states: every documented limit bites, no file is
 * written, nothing is fetched, and the tool does not describe itself as having
 * observed a layout.
 */

import { strict as assert } from 'node:assert'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import { DEFAULT_LIMITS, LIMIT_NAMES, findForbiddenClaim, makeFinding, msg } from '../src/index.mjs'
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

async function treeOf(directory) {
  const entries = []
  const walk = async (current, prefix) => {
    for (const name of (await readdir(current)).sort()) {
      const full = join(current, name)
      const info = await stat(full)
      entries.push(`${prefix}${name} ${info.isDirectory() ? 'dir' : info.size} ${info.mtimeMs}`)
      if (info.isDirectory()) await walk(full, `${prefix}${name}/`)
    }
  }
  await walk(directory, '')
  return entries
}

test('every documented limit is enforced rather than silently truncated', async () => {
  const cases = {
    maxBoxes: 'box-limit-exceeded',
    maxMeasurementBytes: 'measurements-too-large',
    maxRoutes: 'route-limit-exceeded',
    maxWidths: 'width-limit-exceeded',
  }
  assert.deepEqual(Object.keys(cases).sort(), [...LIMIT_NAMES], 'every limit has a test')

  for (const [name, ruleId] of Object.entries(cases)) {
    const contract = contractDocument((document) => {
      document.limits = { [name]: 1 }
      return document
    })
    const measurements = measurementDocument((document) => {
      if (name === 'maxRoutes') document.routes.push({ ...document.routes[0], name: 'second' })
      return document
    })
    const result = await measureFixture(measurements, contract)
    const report = reportFrom(result)
    assert.equal(result.code, 2, name)
    assert.equal(report.status, 'incomplete', name)
    assert.ok(ruleIds(report).includes(ruleId), `${name} -> ${ruleId}, got ${ruleIds(report)}`)
    assert.equal(report.summary.checked, 0, `${name} must compare nothing rather than compare part of it`)
  }
})

test('a limit at its documented default admits the fixture', async () => {
  const contract = contractDocument((document) => {
    document.limits = { ...DEFAULT_LIMITS }
    return document
  })
  const result = await measureFixture(measurementDocument(), contract)
  assert.equal(result.code, 0, 'a guard that refuses everything is not a guard')
})

test('the run writes no file anywhere near its inputs', async () => {
  const dir = await tempDir()
  await writeJson(dir, 'measurements.json', measurementDocument())
  await writeJson(dir, 'contract.json', contractDocument())
  const before = await treeOf(dir)

  const result = await runCli([
    '--measurements', join(dir, 'measurements.json'),
    '--contract', join(dir, 'contract.json'),
    '--now', '2026-09-18',
  ], { cwd: dir })
  assert.equal(result.code, 0)

  assert.deepEqual(await treeOf(dir), before, 'nothing was created, removed or modified')
})

test('no source file reaches for a network', async () => {
  // A source scan, and it is described as one: the tool has no code path that
  // could open a socket, so there is no behaviour to observe instead.
  const files = [
    ...(await readdir(join(ROOT, 'src'))).map((name) => join('src', name)),
    ...(await readdir(join(ROOT, 'bin'))).map((name) => join('bin', name)),
  ].filter((name) => name.endsWith('.mjs'))
  assert.ok(files.length >= 6)

  const forbidden = /node:(?:http|https|net|tls|dgram|dns|http2)|\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource/u
  for (const file of files) {
    const source = await readFile(join(ROOT, file), 'utf8')
    assert.equal(forbidden.exec(source), null, `${file} names a network facility`)
  }
})

test('the only node builtins imported are the filesystem and paths', async () => {
  const allowed = new Set(['node:fs/promises', 'node:path'])
  for (const directory of ['src', 'bin']) {
    for (const name of await readdir(join(ROOT, directory))) {
      if (!name.endsWith('.mjs')) continue
      const source = await readFile(join(ROOT, directory, name), 'utf8')
      for (const match of source.matchAll(/from '(node:[^']+)'/gu)) {
        assert.ok(allowed.has(match[1]), `${directory}/${name} imports ${match[1]}`)
      }
    }
  }
})

test('a path that is not a regular file is reported as one, not read', async () => {
  // stat succeeds on a directory, so without this check readFile fails later
  // with EISDIR and the report says "EISDIR" instead of naming the problem.
  // Both exit 2, which is why removing the check was silent.
  const dir = await tempDir()
  const contractPath = await writeJson(dir, 'contract.json', contractDocument())
  const measurements = await runCli(['--measurements', dir, '--contract', contractPath])
  assert.equal(measurements.code, 2)
  const report = reportFrom(measurements)
  assert.deepEqual(ruleIds(report), ['measurements-unreadable'])
  assert.match(report.findings[0].message, /The measurements were not read: not a regular file\./u)

  const contract = await runCli(['--measurements', join(dir, 'contract.json'), '--contract', dir])
  assert.equal(contract.code, 2)
  assert.equal(contract.stdout, '', 'the contract is the policy, so this is a configuration error')
  assert.match(contract.stderr, /Could not load the contract: not a regular file/u)
})

test('a finding message must be built by the tagged template, not handed in as a string', () => {
  // The template is what checks the tool's own literals for claims it may not
  // make. A finding assembled from a plain string would skip that check
  // entirely, so makeFinding refuses one -- and every call site in src/ already
  // uses the template, which is why removing the refusal changed no output.
  assert.throws(
    () => makeFinding('gutter-mismatch', 'the browser reported 24px', { file: 'measurements.json' }),
    /must build its message with the msg tagged template/u,
  )
  assert.throws(
    () => makeFinding('gutter-mismatch', { text: 'looks like a SafeMessage' }, { file: 'measurements.json' }),
    /must build its message with the msg tagged template/u,
  )
  assert.equal(makeFinding('gutter-mismatch', msg`a real one`, { file: 'measurements.json' }).message, 'a real one')
})

test('a finding may not describe this tool as having observed a layout', () => {
  assert.throws(() => msg`the browser reported 448`, /may not claim this tool observed an interface/u)
  assert.throws(() => msg`the page rendered at 1280`, /may not claim/u)
  assert.throws(() => msg`the measurements were fetched from the host`, /may not claim/u)
  assert.equal(findForbiddenClaim('the left edge of alerts-card is at 454'), null)
  assert.equal(findForbiddenClaim('the contract computes its columns for 1280'), null)
})

test('an element named after a forbidden word does not stop the run', async () => {
  const contract = contractDocument((document) => {
    document.elements = ['browser-chrome', 'alerts-card']
    document.widths[0].spans = {
      'browser-chrome': { start: 1, end: 4 },
      'alerts-card': { start: 5, end: 8 },
    }
    document.widths[1].elements = ['browser-chrome', 'alerts-card']
    return document
  })
  const measurements = measurementDocument((document) => {
    document.routes[0].widths[0].boxes = [
      box('browser-chrome', 46, 100, 384, 200),
      box('alerts-card', 448, 100, 384, 200),
    ]
    document.routes[0].widths[1].boxes = [
      box('browser-chrome', 16, 100, 343, 200),
      box('alerts-card', 16, 320, 343, 200),
    ]
    return document
  })

  const report = reportFrom(await measureFixture(measurements, contract))
  const finding = report.findings.find((entry) => entry.ruleId === 'element-misaligned-left')
  assert.match(finding.message, /left edge of browser-chrome is at 46/u, 'the value is data, not the tool\'s voice')
})

test('no finding this tool can emit claims a capability it does not have', async () => {
  const documents = [
    measurementDocument(),
    measurementDocument(withWideBoxes([box('summary-card', 46, 100, 384, 200)])),
    measurementDocument((d) => { d.routes[0].widths = [d.routes[0].widths[0]]; return d }),
    measurementDocument((d) => { d.capture.unit = 'rem'; return d }),
  ]
  for (const document of documents) {
    const report = reportFrom(await measureFixture(document, contractDocument()))
    for (const finding of report.findings) {
      assert.equal(findForbiddenClaim(finding.message), null, finding.message)
      assert.equal(findForbiddenClaim(finding.suggestion ?? ''), null, finding.suggestion)
    }
  }
})

test('a pass on no evidence is impossible', async () => {
  const result = await measureFixture(
    measurementDocument((document) => {
      document.routes = []
      return document
    }),
    contractDocument(),
  )
  const report = reportFrom(result)
  assert.equal(report.summary.checked, 0)
  assert.notEqual(report.status, 'pass', 'checked: 0 is never green')
  assert.deepEqual(ruleIds(report), ['no-boxes-checked'])
})
