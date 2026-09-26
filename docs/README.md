# Layout Grid Measurement documentation

The README is the user-facing description. This file records the design
decisions behind it — what was deliberately not built, and why.

## The measurements are an input, not something this tool collects

The tool takes a measurement document and a contract and opens nothing else.
There is no browser, no page driver, no screenshot and no socket, in normal use
and in the tests. The import list is checked by `test/boundaries.test.mjs`:
`node:fs/promises` and `node:path` are the only builtins in `src/` and `bin/`.

A route inside the document is an **opaque name**. It is whatever the exporter
called that page, it is not required to be a URL or a path, and nothing here
resolves it, joins it to a base, or reads a file named after it. That is a
deliberate limit and not an oversight: a tool that resolved a route name would
have to decide what to do with `../` and with an absolute path, and the answer
would be a confinement problem that nothing here otherwise has.

## A responsive change is documented, not discovered

This is the constraint that shaped the contract format. Each width declares its
own `stacking` and its own `grid`, and `compareLayout` never carries an
expectation from one width to another — the geometry for a width is computed
from that width's own declaration and nothing else.

Two consequences, both tested in `test/acceptance.test.mjs`:

- A layout that stacks into one column at 375 passes there, because the contract
  says that width stacks.
- The same boxes fail at a width still declared a grid. Only the contract
  changed between those two runs, which is what proves the verdict comes from
  the document rather than from a guess about narrow viewports.

The tool never infers stacking from a viewport width, and there is no threshold
in the source at which it would.

## Why each width names its elements exactly once

At a `grid` width the expected set is the keys of `spans`; at a `stacked` width
it is `elements`. Supplying the other key is a `ContractError`, not a warning:

- a bare element name at a grid width would have no span, so its edges could not
  be checked, and it would sit in the contract looking like coverage;
- a span at a stacked width would never be read, and would likewise look like
  coverage.

The house contract records a fix round in this catalog that produced exactly
that shape — documents claiming a confinement the code did not perform — and
notes it is worse than silence, because it reads as coverage. The same reasoning
applies to a contract that a reader would take as checked.

A width may leave an element out entirely. That is how "this card is not on the
phone" is said, and an element a width does not expect produces `element-unknown`
at `info` rather than a failure.

## Why some gaps are not checked

- **The gutter between elements that are not column-adjacent.** Two elements
  separated by empty columns have a gap the contract does not name. It could be
  derived — so many columns plus so many gutters — but the contract never said
  the columns between them are empty on purpose, so the derived number would be
  an assumption presented as a check.
- **Vertical rhythm.** The contract declares no vertical spacing, so stacked
  elements are checked for overlap and nothing else.

Both are stated in the README's non-goals rather than left for a reader to
discover.

## Why a missing coordinate is not an aligned one

Four rules — `element-not-measured`, `width-not-measured`, `measurements-stale`
and `measurements-age-unknown` — are `warning` severity, because a gap in the
evidence is not a misaligned layout. Calling them errors would say the layout
broke the contract, which is not what happened.

That makes their membership of `EVIDENCE_MISSING_RULES` the *only* thing between
a gap in the evidence and a green run, which is exactly the defect class the
house contract records: an invariant true only by accident. So
`test/evidence.test.mjs` asserts it directly — for every warning-severity rule
in that list, `statusFor` returns `incomplete`, and a non-error finding outside
the list returns `pass`.

The same reasoning drives `viewport-width-mismatch`. A box recorded at 1440 and
compared against columns computed for 1280 would produce confident, wrong
coordinates, so the width is skipped and reported instead.

## Why the contract is a configuration error and the measurements are not

The contract is the policy. If it cannot be read, parsed or validated, the run
never had a subject, so stdout stays empty and the message goes to stderr.

The measurements are the evidence. If they cannot be read, parsed or compared,
the run had a subject and failed to learn about it, so stdout carries an
`incomplete` report naming which file and which element. A consumer piping
stdout needs that.

## Bounds

`maxRoutes`, `maxWidths` and `maxBoxes` are checked before any box is compared,
and exceeding one compares nothing at all rather than a prefix: a partial answer
that looked like a whole one is the failure this avoids. `maxMeasurementBytes`
is applied before the file is read. The contract is separately bounded at
1000000 bytes, 32 widths, 512 elements and 64 columns, and every name is bounded
at 128 characters.

A grid whose columns would be zero or negative wide is refused when the contract
is validated. Reporting boxes as misaligned against an impossible grid would
blame the measurements for a mistake in the contract.

## What is deliberately not here

- **No `--out`, no cache, no auto-fix.** The tool writes no file, so none of the
  destination guards in the house contract apply to it. If that ever changes,
  all three holes — a symlinked destination, a symlinked parent, a hard link to
  an input — have to be closed together, and the input set has to be every path
  the tool resolved rather than every path it opened.
- **No shared package.** The report envelope, the sanitiser, the parse-failure
  helper and the severity table are implemented here, in this repository, as the
  house contract requires. Nothing is installed and nothing is imported across
  tool boundaries.
- **No inference about what a grid should be.** The tool has no opinion about
  column counts, gutters or breakpoints and will not propose one.
