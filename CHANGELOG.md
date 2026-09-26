# Changelog

All notable changes to this project are documented here. Rule ids are part of
the public interface: renaming one is a breaking change and is recorded here.

## 0.1.0

First working release.

### Added

- `layout-grid-measurement --measurements FILE --contract FILE`, which compares
  columns, gutters, alignment and overflow in a supplied document of bounding
  boxes with a layout contract, width by width.
- A layout contract that declares, per width, the viewport, the grid
  (`columns`, `gutter`, `margin`), the comparison `tolerance` and the
  `stacking`. At a `grid` width the column edges are computed from the contract
  and every element's span is checked against them; at a `stacked` width every
  element is expected to fill the content width and to sit clear of the one
  above it. No expectation is carried between widths, so a responsive change is
  documented rather than discovered.
- Each width names the elements it expects exactly once, as `spans` for a grid
  or `elements` for a stacked width. The other key is refused, because it would
  read as coverage the tool does not perform.
- A misalignment reported with the measured coordinate, the expected one, the
  difference, the tolerance and the column the edge belongs to.
- `maxMeasurementAgeDays` with an injected clock, exposed as `--now`, so a
  staleness deadline can be tested and a run can be made reproducible.
- A JSON report on stdout and a human summary on stderr, with exit codes 0, 1
  and 2, and both documented shapes of exit 2.
- The rule catalog:

- `box-invalid`
- `box-limit-exceeded`
- `duplicate-box`
- `element-misaligned-left`
- `element-misaligned-right`
- `element-not-measured`
- `element-overflows-content`
- `element-overflows-viewport`
- `element-unknown`
- `elements-overlap`
- `gutter-mismatch`
- `measurements-age-unknown`
- `measurements-invalid`
- `measurements-not-utf8`
- `measurements-stale`
- `measurements-too-large`
- `measurements-unparsable`
- `measurements-unreadable`
- `no-boxes-checked`
- `route-limit-exceeded`
- `stacked-element-not-full-width`
- `unit-unsupported`
- `viewport-width-mismatch`
- `width-limit-exceeded`
- `width-not-measured`
- `width-unknown`

### Notes

- This tool collects nothing. It reads a measurement document somebody else
  exported: no browser is opened, no page driven, no host resolved and no socket
  opened, including in the tests. A route in the document is an opaque name.
- It writes no file.
- Zero runtime and development dependencies.
