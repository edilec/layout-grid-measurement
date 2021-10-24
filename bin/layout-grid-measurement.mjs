#!/usr/bin/env node

import { exitCodeFor, formatSummary, measureProject, parseCaptureInstant, renderReport } from '../src/index.mjs'

const HELP = `layout-grid-measurement

Compare columns, gutters, alignment and overflow in a document of bounding boxes
with a layout contract, width by width.

This tool collects nothing. It reads a measurement document that somebody else
exported at the widths they chose: it opens no browser, drives no page, resolves
no host and opens no socket, and a route inside the document is an opaque name
rather than an address. No file is written.

A responsive change is DOCUMENTED rather than discovered. Each width in the
contract declares its own stacking and its own grid, and no expectation is
carried from one width to another, so a layout that stacks into a single column
at the smallest width passes there because the contract says it stacks -- and
the same boxes fail at a width still declared a grid.

Usage:
  layout-grid-measurement --measurements FILE --contract FILE [--now INSTANT] [--json]

Options:
  --measurements FILE  Bounding boxes to compare (required)
  --contract FILE      Layout contract: the policy (required)
  --now INSTANT        Treat this instant as the present when applying the
                       contract's maxMeasurementAgeDays, as YYYY-MM-DD or
                       YYYY-MM-DDTHH:MM:SSZ. Defaults to the system clock.
                       Supply it to make a run that checks age reproducible.
  --json               Suppress the human summary on stderr
  -h, --help           Show this help

Streams:
  stdout  the JSON report and nothing else, so it can be piped into a parser
  stderr  the human summary and any diagnostics

Exit codes:
  0  every box the contract expects was compared and the layout matched it
  1  the comparison completed and at least one boundary did not match
  2  invalid configuration, or evidence the comparison could not obtain. A box
     that could not be read, an element the contract expects and nothing
     recorded, a width recorded at a viewport the contract does not compute for,
     and measurements older than the contract allows all land here; none of them
     is ever reported as an aligned boundary.
     On a configuration error -- including any problem with the contract, which
     is the policy -- stdout stays EMPTY and the message goes to stderr. On
     unreadable or incomplete evidence stdout carries an "incomplete" report
     naming what was not established.
`

function parseArguments(argv) {
  if (argv.includes('-h') || argv.includes('--help')) return { help: true }
  const options = { measurements: null, contract: null, now: undefined, json: false }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const takeValue = (name) => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) throw new Error(`${name} requires a value`)
      index += 1
      return value
    }
    if (argument === '--json') options.json = true
    else if (argument === '--measurements') options.measurements = takeValue('--measurements')
    else if (argument === '--contract') options.contract = takeValue('--contract')
    else if (argument === '--now') {
      const raw = takeValue('--now')
      const instant = parseCaptureInstant(raw)
      if (!instant.ok) throw new Error('--now requires YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ')
      options.now = instant.ms
    } else throw new Error(`Unknown option "${argument}"`)
  }

  if (options.measurements === null) throw new Error('--measurements is required')
  if (options.contract === null) throw new Error('--contract is required')
  return options
}

async function main(argv) {
  let options
  try {
    options = parseArguments(argv)
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${HELP}`)
    return 2
  }
  if (options.help) {
    process.stderr.write(HELP)
    return 0
  }

  let report
  try {
    report = await measureProject({
      measurements: options.measurements,
      contract: options.contract,
      now: options.now,
    })
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }

  process.stdout.write(renderReport(report))
  if (!options.json) process.stderr.write(formatSummary(report))
  return exitCodeFor(report)
}

process.exitCode = await main(process.argv.slice(2))
