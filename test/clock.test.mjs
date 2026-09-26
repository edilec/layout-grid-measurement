/**
 * The clock is a parameter.
 *
 * A tool that reads the wall clock unconditionally cannot be tested against a
 * deadline, and a verdict that depends on an unrecorded reading is not
 * reproducible. `compareLayout` takes `now` as a default parameter and the CLI
 * exposes it as `--now`, so a test can step a fake clock across the staleness
 * boundary and watch the verdict change.
 */

import { strict as assert } from 'node:assert'
import test from 'node:test'

import { compareLayout, parseCaptureInstant, readMeasurements, validateContract } from '../src/index.mjs'
import { contractDocument, measureFixture, measurementDocument, reportFrom, ruleIds } from './helpers.mjs'

const DAY = 86400000

function compareAt(now, measurementAlter = (d) => d, contractAlter = (d) => d) {
  const contract = validateContract(contractDocument(contractAlter))
  const structure = readMeasurements(measurementDocument(measurementAlter), 'measurements.json')
  return compareLayout({ measurements: structure.measurements, contract, file: 'measurements.json', now })
}

const WITH_DEADLINE = (contract) => {
  contract.maxMeasurementAgeDays = 30
  return contract
}

test('measurements inside the window pass and ones past it do not', () => {
  const capturedAt = Date.UTC(2026, 8, 1)

  const fresh = compareAt(capturedAt + 30 * DAY, (d) => d, WITH_DEADLINE)
  assert.equal(fresh.status, 'pass', 'exactly at the limit is still inside it')
  assert.deepEqual(ruleIds(fresh), [])

  // One millisecond past the deadline, and nothing else changed.
  const stale = compareAt(capturedAt + 30 * DAY + 1, (d) => d, WITH_DEADLINE)
  assert.equal(stale.status, 'incomplete')
  assert.deepEqual(ruleIds(stale), ['measurements-stale'])
  assert.equal(stale.findings[0].severity, 'warning', 'old coordinates are not a misaligned layout')
})

test('stale measurements are incomplete even when every box matches the contract', () => {
  const stale = compareAt(Date.UTC(2027, 0, 1), (d) => d, WITH_DEADLINE)
  assert.equal(stale.summary.errors, 0)
  assert.equal(stale.status, 'incomplete', 'coordinates too old to describe the layout are not evidence about it now')
})

test('measurements whose age cannot be established are not assumed to be recent', () => {
  // The last four are the ones a sweep found unguarded. A minute or a second of
  // 60 rolls forward into a valid instant, and the round-trip check only
  // compares the year, month and day, so removing the range check turned
  // 00:60:00 into 01:00:00 in silence. An array is worse: String(['2026-09-01'])
  // is the date itself, so dropping the type check let a non-string smuggle a
  // date past a check that exists to refuse one.
  const unreadable = [
    undefined, 'yesterday', '2026-02-30', '2026-09-01T25:00:00Z', 20260901,
    '2026-09-01T00:60:00Z', '2026-09-01T00:00:60Z', '2026-13-01', ['2026-09-01'],
  ]
  for (const capturedAt of unreadable) {
    const report = compareAt(Date.UTC(2026, 8, 2), (document) => {
      if (capturedAt === undefined) delete document.capture.capturedAt
      else document.capture.capturedAt = capturedAt
      return document
    }, WITH_DEADLINE)
    assert.deepEqual(ruleIds(report), ['measurements-age-unknown'], String(capturedAt))
    assert.equal(report.status, 'incomplete', String(capturedAt))
  }
})

test('parseCaptureInstant refuses every out-of-range field the two spellings admit', () => {
  // Exhaustive over the domain the patterns accept: two digits each, so every
  // month, day, hour, minute and second from 00 to 99. This is what proves the
  // range checks and the round-trip check between them leave no gap -- and it
  // is also the proof that the month and day range check is redundant with the
  // round-trip, which is why removing that one line changes no output at all
  // while removing the hour/minute/second line changes 149560 of these.
  const pad = (value) => String(value).padStart(2, '0')

  for (const year of [2024, 2026, 2100]) {
    for (let month = 0; month < 100; month += 1) {
      for (let day = 0; day < 100; day += 1) {
        const text = `${year}-${pad(month)}-${pad(day)}`
        const legal = month >= 1 && month <= 12 && day >= 1
          && day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
        assert.equal(parseCaptureInstant(text).ok, legal, text)
      }
    }
  }

  for (let hour = 0; hour < 100; hour += 1) {
    for (const minute of [0, 59, 60, 99]) {
      for (const second of [0, 59, 60, 99]) {
        const text = `2026-09-01T${pad(hour)}:${pad(minute)}:${pad(second)}Z`
        const legal = hour <= 23 && minute <= 59 && second <= 59
        assert.equal(parseCaptureInstant(text).ok, legal, text)
      }
    }
  }

  for (const notAString of [['2026-09-01'], 20260901, null, undefined, { toString: () => '2026-09-01' }]) {
    assert.equal(parseCaptureInstant(notAString).ok, false, String(notAString))
  }
})

test('without a declared deadline the clock cannot reach the report at all', () => {
  const ancient = compareAt(Date.UTC(2099, 0, 1))
  assert.deepEqual(ruleIds(ancient), [])
  assert.equal(ancient.status, 'pass')

  const missingDate = compareAt(Date.UTC(2099, 0, 1), (document) => {
    delete document.capture.capturedAt
    return document
  })
  assert.deepEqual(ruleIds(missingDate), [], 'capturedAt is only required when the contract asks for it')
})

test('two runs an hour apart agree, because the clock is injected', () => {
  assert.deepEqual(
    compareAt(Date.UTC(2026, 8, 18, 9), (d) => d, WITH_DEADLINE),
    compareAt(Date.UTC(2026, 8, 18, 10), (d) => d, WITH_DEADLINE),
  )
})

test('the default clock is the system clock, so a real deadline really expires', () => {
  // No `now` passed: measurements from 2026-09-01 with a one-day deadline are
  // stale whenever this suite is run after 2026-09-02.
  const contract = validateContract(contractDocument((document) => {
    document.maxMeasurementAgeDays = 1
    return document
  }))
  const structure = readMeasurements(measurementDocument(), 'measurements.json')
  const report = compareLayout({ measurements: structure.measurements, contract, file: 'measurements.json' })
  assert.deepEqual(ruleIds(report), ['measurements-stale'])
})

test('the CLI exposes the clock, and different instants give different verdicts', async () => {
  const contract = contractDocument(WITH_DEADLINE)

  const fresh = await measureFixture(measurementDocument(), contract)
  assert.equal(fresh.code, 0, '--now 2026-09-18 is 17 days after the fixture capture')

  const later = await measureFixture(measurementDocument(), contract, ['--now', '2027-01-01'])
  assert.equal(later.code, 2)
  assert.deepEqual(ruleIds(reportFrom(later)), ['measurements-stale'])
})

test('an unreadable --now is a configuration error, not a silent fallback to today', async () => {
  const result = await measureFixture(measurementDocument(), contractDocument(), ['--now', 'lunchtime'])
  assert.equal(result.code, 2)
  assert.equal(result.stdout, '', 'a configuration error leaves stdout empty')
  assert.match(result.stderr, /--now requires YYYY-MM-DD/u)
})
