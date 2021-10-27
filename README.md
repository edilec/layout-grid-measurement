# Layout Grid Measurement

Compare columns, gutters, alignment and overflow in a document of bounding boxes
with a layout contract, width by width.

- **Repository:** [edilec/layout-grid-measurement](https://github.com/edilec/layout-grid-measurement)
- **Area:** Design Systems
- **License:** MIT

## What it does

It reads two documents and compares them:

- a **measurement document** (`--measurements`), exported by somebody else from
  their own measuring setup: for each route, at each viewport width, a bounding
  box for each element;
- a **layout contract** (`--contract`), which declares — per width — the grid,
  the tolerance, whether the layout is a grid or stacks, and which elements are
  expected where.

At a `grid` width it computes each column's edges from the contract and checks
that every element's left and right edges sit on the edges of the columns it is
supposed to span, that the gap between column-adjacent elements is the contract
gutter, that nothing overlaps, and that nothing runs outside the margins or off
the viewport. At a `stacked` width it checks instead that each element fills the
content width, starts at the content edge, and sits clear of the one above it.

## Why it exists

A grid is agreed once and then drifts a card at a time. Six pixels on one
boundary is invisible in review, survives a screenshot diff, and is obvious on a
dashboard next to a card that did not move. Once someone is already exporting
bounding boxes, the check is arithmetic — but only if the expected coordinates
come from a contract, and only if a boundary that fails is reported *with the
numbers*, because "card-b is misaligned" sends someone back to the measuring
setup while "left edge at 454, expected 448, 6 past the left edge of column 5"
sends them to the layout.

The other half is responsive change. A layout that stacks into one column at 375
is not a regression, and a tool that guesses which widths stack would be wrong
about somebody's design sooner or later. So each width in the contract declares
its own stacking, and no expectation is carried from one width to another: the
change passes because it is **documented**, and the same boxes fail at a width
still declared a grid.

## The measurements are an input

This tool collects nothing. It opens no browser, drives no page, takes no
screenshot, resolves no host and opens no socket, in normal use and in its
tests. The measurement document is the only evidence it has, and a route inside
it is an opaque name the exporter chose — this tool never treats it as an
address, and never tries to reach it.

Producing the document is your side of the contract. Anything that can emit the
JSON below will do.

## Quick start

```sh
# a dashboard that matches its contract at both widths, stacking at 375
node bin/layout-grid-measurement.mjs \
  --measurements examples/clean/measurements.json \
  --contract examples/clean/layout.contract.json \
  --now 2026-09-18
echo $?   # 0

# one card six pixels off its column, and two stacked cards that do not fit
node bin/layout-grid-measurement.mjs \
  --measurements examples/broken/measurements.json \
  --contract examples/broken/layout.contract.json \
  --now 2026-09-18
echo $?   # 1
```

`npm run example` runs the first, `npm run example:broken` the second. `--now`
is passed so the example's verdict does not depend on the day it is run; see
[The clock](#the-clock).

### The measurements

```json
{
  "schemaVersion": "1",
  "capture": { "id": "console-dashboard", "unit": "px", "capturedAt": "2026-09-01" },
  "routes": [{
    "name": "dashboard",
    "widths": [{
      "name": "wide",
      "viewportWidth": 1280,
      "boxes": [
        { "element": "summary-card", "x": 40, "y": 144, "width": 384, "height": 220 }
      ]
    }]
  }]
}
```

`x` and `y` may be negative — an element pushed off the left edge is worth
reporting — but a negative `width` or `height` is a mistake in the export rather
than a measurement, and is refused. `viewportWidth` must match the contract's
for that width: a box recorded at a different viewport would be compared against
columns computed for another one, so it is reported as unestablished instead.

`capturedAt` is optional unless the contract declares `maxMeasurementAgeDays`.

### The contract

```json
{
  "schemaVersion": "1",
  "unit": "px",
  "tolerance": 0.5,
  "elements": ["page-title", "summary-card", "activity-card", "alerts-card"],
  "widths": [
    {
      "name": "wide",
      "viewportWidth": 1280,
      "stacking": "grid",
      "grid": { "columns": 12, "gutter": 24, "margin": 40 },
      "spans": {
        "page-title": { "start": 1, "end": 12 },
        "summary-card": { "start": 1, "end": 4 },
        "activity-card": { "start": 5, "end": 8 },
        "alerts-card": { "start": 9, "end": 12 }
      }
    },
    {
      "name": "mobile",
      "viewportWidth": 375,
      "stacking": "stacked",
      "grid": { "columns": 1, "gutter": 0, "margin": 16 },
      "elements": ["page-title", "summary-card", "activity-card", "alerts-card"]
    }
  ]
}
```

`elements` is the vocabulary: every name used anywhere in the contract must
appear there. Each width then names the elements it expects **exactly once**, in
the form its stacking gives meaning to — `spans` for a grid, `elements` for a
stacked width. The other key is refused, because a bare element name at a grid
width would go unchecked and a span at a stacked width would never be looked at:
either would read as coverage the tool does not perform.

A width may leave an element out. That is how "this card is not on the phone" is
said, and nothing is reported for an element a width does not expect.

`tolerance` is the slack allowed on every comparison, defaulting to `0` and
overridable per width. A grid whose columns would be zero or negative wide is
refused before a box is read.

Geometry, for a width of `V` with margin `m`, `n` columns and gutter `g`:

```
contentLeft   = m
contentWidth  = V - 2m
columnWidth   = (contentWidth - g * (n - 1)) / n
column i left = m + (i - 1) * (columnWidth + g)
span a..b     = [column a left, column b left + columnWidth]
```

## Rules

**Evidence** marks a rule that means the tool did not obtain what a verdict
needs: any one of them makes the whole report `incomplete` and the run exit 2,
whatever its own severity is.

| Rule | Severity | Evidence | Meaning |
| --- | --- | --- | --- |
| `box-invalid` | error | yes | A box record is missing a coordinate, or holds one that is not a finite number, or a negative size. |
| `box-limit-exceeded` | error | yes | The document holds more boxes than `limits.maxBoxes`. |
| `duplicate-box` | error | yes | One width records the same element twice, so which box describes it is ambiguous; neither is used. |
| `element-misaligned-left` | error | no | An element's left edge is not on the left edge of the column it should start at, or on the content edge at a stacked width. |
| `element-misaligned-right` | error | no | An element's right edge is not on the right edge of the column it should end at. |
| `element-not-measured` | warning | yes | The contract expects an element at a width and no box for it was compared. |
| `element-overflows-content` | error | no | An element runs outside the margins while staying inside the viewport. |
| `element-overflows-viewport` | error | no | An element runs off the viewport. Reported instead of the content overflow, as the more serious of the two. |
| `element-unknown` | info | no | A box was recorded for an element the contract does not expect at that width, so nothing was checked for it. |
| `elements-overlap` | error | no | Two elements overlap: horizontally within a row at a grid width, vertically at a stacked one. |
| `gutter-mismatch` | error | no | The gap between two column-adjacent elements in a row is not the contract gutter. |
| `measurements-age-unknown` | warning | yes | The contract declares `maxMeasurementAgeDays` and `capturedAt` is absent or unreadable. |
| `measurements-invalid` | error | yes | The document is structurally wrong: bad schema version, unknown key, a repeated route or width. |
| `measurements-not-utf8` | error | yes | The document's bytes are not valid UTF-8. |
| `measurements-stale` | warning | yes | The measurements are older than `maxMeasurementAgeDays`. |
| `measurements-too-large` | error | yes | The document exceeds `limits.maxMeasurementBytes`. |
| `measurements-unparsable` | error | yes | The document is not valid JSON. |
| `measurements-unreadable` | error | yes | The document could not be opened. |
| `no-boxes-checked` | error | yes | Nothing was compared, so there is no evidence to pass or fail on. |
| `route-limit-exceeded` | error | yes | The document holds more routes than `limits.maxRoutes`. |
| `stacked-element-not-full-width` | error | no | At a stacked width, an element does not fill the content width. |
| `unit-unsupported` | error | yes | The measurements are in a unit the contract is not written in, so nothing was compared. |
| `viewport-width-mismatch` | error | yes | A width was recorded at a viewport the contract does not compute its columns for. |
| `width-limit-exceeded` | error | yes | The document holds more widths than `limits.maxWidths`. |
| `width-not-measured` | warning | yes | The contract declares a width and the route was not recorded at it. |
| `width-unknown` | error | yes | The document holds boxes for a width the contract does not declare. |

Rule ids are stable across releases; renaming one is a breaking change recorded
in the changelog.

## Report

```json
{
  "schemaVersion": "1",
  "tool": "layout-grid-measurement",
  "status": "pass",
  "disclaimer": "...",
  "summary": { "checked": 8, "errors": 0, "warnings": 0, "info": 0, "routes": 1, "widths": 2, "boxes": 8 },
  "findings": []
}
```

`status` is `pass`, `fail` or `incomplete`. A finding carries `ruleId`,
`severity`, `message`, `location` and optionally `evidence` and `suggestion`. A
misalignment carries the measured coordinate, the expected one, the difference
and the tolerance, in both the message and the evidence.

`location.file` is the measurement document's file name, never an absolute host
path, and `location.pointer` is the documented field path
`/routes/<route>/widths/<width>/boxes/<element>`, with `~` and `/` inside a name
escaped as JSON Pointer requires.

Findings are ordered by `(location.file, location.pointer, ruleId, message)`,
each compared by UTF-16 code unit rather than by locale collation, because ICU
data differs between Node builds and two correct machines would otherwise
disagree about the same output. Running the tool twice over identical inputs
produces byte-identical stdout.

## The clock

Nothing in this tool reads the wall clock except the staleness check, and that
reading is a parameter: `compareLayout({ ..., now })` takes it, and the CLI
exposes it as `--now`. Pass it to make a run reproducible; leave it out and the
system clock is used. Measurements whose age cannot be established are never
assumed to be recent.

## Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | every box the contract expects was compared and the layout matched it |
| `1` | the comparison completed and at least one boundary did not match |
| `2` | invalid configuration, or evidence the comparison could not obtain |

Exit 2 has two shapes, and the difference matters to anything piping stdout:

| Situation | stdout | stderr |
| --- | --- | --- |
| Invalid configuration, unknown option, any problem with the contract | **empty** | the message |
| Input that could not be read, decoded, parsed or compared | an `incomplete` report | optional diagnostics |

A configuration error means the run never had a subject, so there is nothing to
report about. Unobtainable evidence means the run had a subject and failed to
learn about it, and a consumer needs the report to know *which* coordinate was
not obtained.

## Limits

Every limit is enforced. Exceeding one is an `incomplete` result naming the
limit — never a silent truncation, and never a pass.

| Limit | Default |
| --- | ---: |
| `maxBoxes` | 20000 |
| `maxMeasurementBytes` | 8000000 |
| `maxRoutes` | 500 |
| `maxWidths` | 4000 |

The contract itself is bounded at 1000000 bytes, 32 widths, 512 elements and 64
columns per grid. An element, route, width or unit name is bounded at 128
characters; `evidence` is bounded at 200.

## Non-goals

- **It collects nothing.** No browser is opened, no page driven, no screenshot
  taken, no host resolved and no socket opened — including in the tests. The
  measurement document is the only evidence there is.
- **It does not resolve a route.** A route name is an opaque label. This tool
  never treats it as a URL or a file path.
- **It writes no file.** There is no `--out`, no cache and no auto-fix. The
  report goes to stdout and the summary to stderr.
- **It has no opinion about grids.** It will not suggest a column count, a
  gutter or a breakpoint, and it contains no default geometry. Take away the
  contract and it has nothing to say.
- **It does not infer that a width stacks.** Stacking is declared per width in
  the contract. A narrow viewport is not treated as stacked, and a wide one is
  not treated as a grid.
- **It checks horizontal rhythm only.** Vertical spacing between stacked
  elements is checked for overlap and nothing else: the contract has no vertical
  rhythm to compare against, and inventing one would be a claim rather than a
  check. For the same reason, the gutter is compared only between elements that
  are adjacent in columns — a gap spanning empty columns is one the contract
  does not name.
- **It does not judge a design.** A passing report means the boxes matched the
  contract supplied with them; it is not a statement about whether the layout is
  usable, accessible or attractive.
- **It cannot see what was not measured.** An element absent from the document
  is not an element that was aligned, and this tool has no way to tell the two
  apart — which is why a width names what it expects and why an unmeasured
  element makes the run incomplete.
- **Zero dependencies, runtime and development.** Node 22 or later, `node:test`
  and `node:assert/strict`.

## Verification

```sh
npm run check    # node --check over every .mjs, the test suite, the example, npm pack --dry-run
```

## License

MIT. See [LICENSE](./LICENSE).
