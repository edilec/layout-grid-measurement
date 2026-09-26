/**
 * The documents and the code describe the same tool.
 *
 * Documentation overclaims are counted as defects here, and the expensive kind
 * is a rule table that has drifted from the severities the tool actually
 * applies. This file compares the README against the code in both directions;
 * `severity.test.mjs` is what proves the code's own table is real, by driving
 * every rule through the CLI and asserting the exit code.
 */

import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

import {
  CATALOG,
  DEFAULT_LIMITS,
  EVIDENCE_MISSING_RULES,
  RULE_IDS,
  RULE_SEVERITY,
  TOOL_ID,
} from '../src/index.mjs'
import { ROOT } from './helpers.mjs'

const README = await readFile(join(ROOT, 'README.md'), 'utf8')
const CHANGELOG = await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8')
const PACKAGE = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))

function documentedRules() {
  const rows = new Map()
  for (const match of README.matchAll(/^\| `([a-z0-9-]+)` \| (error|warning|info) \| (yes|no) \| /gmu)) {
    rows.set(match[1], { severity: match[2], evidence: match[3] === 'yes' })
  }
  return rows
}

test('the tool id equals the directory name and the package name', () => {
  assert.equal(TOOL_ID, 'layout-grid-measurement')
  assert.equal(TOOL_ID, ROOT.split('/').at(-1))
  assert.equal(TOOL_ID, PACKAGE.name)
  assert.equal(PACKAGE.bin[TOOL_ID], `./bin/${TOOL_ID}.mjs`)
})

test('every rule the code applies is documented, with the severity it applies', () => {
  const documented = documentedRules()
  for (const ruleId of RULE_IDS) {
    const row = documented.get(ruleId)
    assert.ok(row !== undefined, `${ruleId} is not in the README rule table`)
    assert.equal(row.severity, RULE_SEVERITY[ruleId], `${ruleId} severity`)
    assert.equal(row.evidence, EVIDENCE_MISSING_RULES.includes(ruleId), `${ruleId} evidence column`)
  }
})

test('every rule the README documents exists in the code', () => {
  for (const ruleId of documentedRules().keys()) {
    assert.ok(RULE_IDS.includes(ruleId), `${ruleId} is documented but not a rule`)
  }
})

test('the documented limits are the limits the code defaults to', () => {
  const rows = new Map(
    [...README.matchAll(/^\| `(max[A-Za-z]+)` \| (\d+) \|$/gmu)].map((match) => [match[1], Number(match[2])]),
  )
  assert.deepEqual([...rows.keys()].sort(), Object.keys(DEFAULT_LIMITS).sort())
  for (const [name, value] of rows) assert.equal(value, DEFAULT_LIMITS[name], name)
})

test('the exported catalog is the same catalog', () => {
  assert.deepEqual(CATALOG.ruleIds, RULE_IDS)
  assert.deepEqual(CATALOG.severity, RULE_SEVERITY)
  assert.deepEqual(CATALOG.evidenceMissing, EVIDENCE_MISSING_RULES)
  assert.deepEqual(CATALOG.limits, DEFAULT_LIMITS)
  assert.deepEqual(CATALOG.stackings, ['grid', 'stacked'])
})

test('the README states the boundaries this tool actually keeps', () => {
  assert.match(README, /## Non-goals/u)
  assert.match(README, /It collects nothing/u)
  assert.match(README, /It does not infer that a width stacks/u)
  assert.match(README, /It writes no file/u)
  assert.match(README, /opens no socket/u)
  assert.match(README, /opaque/u)
  assert.match(README, /Zero dependencies/u)
  assert.match(README, /byte-identical stdout/u)
  assert.match(README, /code unit/u)
})

test('the README documents all three exit codes and both shapes of exit 2', () => {
  assert.match(README, /## Exit codes/u)
  for (const code of ['`0`', '`1`', '`2`']) assert.ok(README.includes(code), code)
  assert.match(README, /Exit 2 has two shapes/u)
  assert.match(README, /\*\*empty\*\*/u)
  assert.match(README, /`incomplete` report/u)
})

test('the package declares no dependency of any kind', () => {
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    assert.equal(PACKAGE[field], undefined, field)
  }
  assert.equal(PACKAGE.scripts.check, 'npm run lint && npm test && npm run example && npm run pack:check')
})

test('the changelog records this release and its rule ids', () => {
  assert.match(CHANGELOG, /## 0\.1\.0/u)
  assert.equal(PACKAGE.version, '0.1.0')
  for (const ruleId of RULE_IDS) {
    assert.ok(CHANGELOG.includes(ruleId), `${ruleId} is not named in the changelog`)
  }
})
