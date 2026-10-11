# CSS isolation and Chrome rendering audit

This is an opt-in browser test, separate from the calculator runtime. It serves the
current `dist` build in this working directory and launches a fresh Chrome profile.
It never uses a Git worktree, clone, shared browser profile, or a copy of the project.

Build first with `npm run build`. Playwright can be supplied by the host environment
through `PLAYWRIGHT_MODULE_PATH`; no new calculator dependency is required. Optionally
set `DC_CHROME` to the Chrome executable and `DC_AUDIT_OUTPUT` to a report directory.

Run with Node:

```text
node tests/browser/rendering-audit.mjs probe
node tests/browser/rendering-audit.mjs bench
node tests/browser/rendering-audit.mjs visual
node tests/browser/rendering-audit.mjs regression
node tests/browser/rendering-audit.mjs css
```

`bench` records 30 expansions, 30 collapses, and 30 checkbox clicks per case after
warm-up. The default sizes are 2560×1344 and 2560×350. Set `DC_SIZES` to a JSON list
of width/height pairs. Set `DC_MODES` to a comma-separated subset of these modes:

| Mode | Test-only change |
| --- | --- |
| A | Full activity theme |
| B | Remove the seasonal stylesheet link before parsing the document |
| C | Disable animation; retain transitions and styling |
| D | Remove the two root firelight layers and moon overlay; disable filters, backdrop filters and shadows |
| E | Remove the root warmth/firelight layers and flame drop shadow |
| F | Remove the root star layers and moon/header decorative pseudo-elements |
| moon | Remove only the fixed moon overlay |
| root | Remove only root background images |
| backdrop | Disable only backdrop filters |
| stars | Remove only the root star layers |

`DC_HEADED=1` uses a visible isolated Chrome window. `DC_DPR` defaults to 1.
With a headed browser, `DC_DEFAULT_BROWSER=1` omits five optional scheduling and
screenshot flags to check whether those launch settings mask the reported delay.
The isolated profile and CDP transport arguments are always retained.
`DC_TRACE=1` also records CDP traces, layer paint rectangles and layer geometry.
`DC_RAW_INPUT=1` uses mouse coordinates without locator actionability waits and
varies the inter-click pause; this checks sensitivity to automated frame alignment.
`DC_WARMUPS=0` includes the first interaction after scrolling in the samples;
the default is four warm-up toggles for each type of interaction.
For traced cases, `traceExactDuration` matches Chrome's unquantized trace timings
to the input timestamp of each measured operation.
Keep traced and untraced results separate because tracing adds instrumentation.
`DC_REMOTE` optionally supplies a URL for a read-only public-site comparison; verify
the public assets match the local production build before interpreting that result.
Remote mode B is not supported: the absence test uses the local server's HTML rewrite.

`visual` records top, expanded card, footer and Buff simulator screenshots at nine
widths. It compares the actual geometry of shared components between A and B.
`regression` exercises persistence, history, baseline restoration, percentages,
native result disclosure cards, export/import and the Buff simulator in both themes.

EventTiming durations are quantized by Chrome. Events below the observer threshold
are reported separately rather than counted as zero. The `presentation` field is a
residual derived from EventTiming and therefore inherits its quantization. `rafDelay`
measures callback scheduling only and **does not mean the frame was presented**.
Paint event clip rectangles are display-list bounds, not proof that every pixel was
repainted. Interpret them with LayerTree paint damage, Raster tasks and A/B timing.
Raster task sums can exceed wall-clock time because workers run in parallel.

Chrome desktop emulation does not validate a physical Android/iOS virtual keyboard,
iOS Safari, monitor scan-out latency, GPU VRAM leaks, or every OS/driver condition.
Keep such gaps explicit in audit reports.
