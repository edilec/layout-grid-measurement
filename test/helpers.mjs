/** Fixtures and runners shared by the test files. Nothing here touches a network. */

import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const CLI = join(ROOT, 'bin', 'layout-grid-measurement.mjs')

/** A fixed instant, so no test depends on the day it runs. */
export const NOW = Date.UTC(2026, 8, 18)

/**
 * The geometry the fixture contract implies, worked out by hand so the tests do
 * not check the arithmetic against itself:
 *
 *   wide    1280 wide, 40 margins -> content 40..1240, 1200 across
 *           12 columns, 24 gutters -> (1200 - 264) / 12 = 78 per column
 *           column n starts at 40 + (n - 1) * 102
 *           span 1-4 = 40..424, span 5-8 = 448..832, span 9-12 = 856..1240
 *   mobile  375 wide, 16 margins -> content 16..359, 343 across
 */
export const WIDE = Object.freeze({ left: 40, right: 1240, column: 78, gutter: 24, step: 102 })
export const MOBILE = Object.freeze({ left: 16, right: 359, content: 343 })

export async function tempDir() {
  return mkdtemp(join(tmpdir(), 'layout-grid-measurement-'))
}

export async function writeJson(dir, name, value) {
  const path = join(dir, name)
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2))
  return path
}

/** A contract that is valid as it stands; pass a function to alter it. */
export function contractDocument(alter = (document) => document) {
  return alter({
    schemaVersion: '1',
    unit: 'px',
    tolerance: 0.5,
    elements: ['alerts-card', 'summary-card'],
    widths: [
      {
        name: 'wide',
        viewportWidth: 1280,
        stacking: 'grid',
        grid: { columns: 12, gutter: 24, margin: 40 },
        spans: {
          'summary-card': { start: 1, end: 4 },
          'alerts-card': { start: 5, end: 8 },
        },
      },
      {
        name: 'mobile',
        viewportWidth: 375,
        stacking: 'stacked',
        grid: { columns: 1, gutter: 0, margin: 16 },
        elements: ['summary-card', 'alerts-card'],
      },
    ],
  })
}

export function box(element, x, y, width, height) {
  return { element, x, y, width, height }
}

/** Measurements that satisfy `contractDocument()`; pass a function to alter them. */
export function measurementDocument(alter = (document) => document) {
  return alter({
    schemaVersion: '1',
    capture: { id: 'fixture', unit: 'px', capturedAt: '2026-09-01' },
    routes: [
      {
        name: 'dashboard',
        widths: [
          {
            name: 'wide',
            viewportWidth: 1280,
            boxes: [
              box('summary-card', 40, 100, 384, 200),
              box('alerts-card', 448, 100, 384, 200),
            ],
          },
          {
            name: 'mobile',
            viewportWidth: 375,
            boxes: [
              box('summary-card', 16, 100, 343, 200),
              box('alerts-card', 16, 320, 343, 200),
            ],
          },
        ],
      },
    ],
  })
}

/** The boxes for one width of the fixture route, replaced wholesale. */
export function withWideBoxes(boxes) {
  return (document) => {
    document.routes[0].widths[0].boxes = boxes
    return document
  }
}

export function withMobileBoxes(boxes) {
  return (document) => {
    document.routes[0].widths[1].boxes = boxes
    return document
  }
}

/** Run the CLI as a consumer would, and report both streams and the exit code. */
export async function runCli(args, options = {}) {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], {
      cwd: options.cwd ?? ROOT,
      maxBuffer: 16 * 1024 * 1024,
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

/** Write both documents into a fresh directory and run the CLI over them. */
export async function measureFixture(measurements, contract, extraArgs = []) {
  const dir = await tempDir()
  const measurementsPath = await writeJson(dir, 'measurements.json', measurements)
  const contractPath = await writeJson(dir, 'contract.json', contract)
  const result = await runCli([
    '--measurements', measurementsPath,
    '--contract', contractPath,
    '--now', '2026-09-18',
    ...extraArgs,
  ])
  return { ...result, dir, measurementsPath, contractPath }
}

export function reportFrom(result) {
  return JSON.parse(result.stdout)
}

export function ruleIds(report) {
  return report.findings.map((finding) => finding.ruleId)
}
