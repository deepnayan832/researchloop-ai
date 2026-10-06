# 🚀 RESEARCHLOOP AI — MASTER SELF-CORRECTING LOOP PROMPT: Fidelity Ledger

Reference concepts:

- Workspace: `concepts/workspace-concept.png`
- Report: `concepts/report-concept.png`
- Mobile workspace: `concepts/mobile-workspace-concept.png`

| Comparison | Concept evidence | Render evidence | Outcome |
|---|---|---|---|
| Workspace shell | Navy left rail, cool white canvas, emerald primary action, and a four-stage loop | `screenshots/researchloop-dashboard-desktop.png` at 1504 px; same rail, palette, query placement, stepper, runs table, and latest-run rail | Matched. The sample run shows Finalize with limitations because no research source is connected. |
| Above-the-fold copy | “Start a research loop”, question field, exchange selector, “Start research”, and Plan / Research / Critique / Finalize | `screenshots/researchloop-dashboard-desktop.png` | Core copy and order match. Added one small demo-mode note to make the live-data limitation clear. |
| Sample market data | Concept artwork contains named companies and dated example activity | Workspace render uses generic, clearly marked example questions and no stock figures | Intentional content change: no live source is connected, so company claims, prices, and dates are not shown as facts. |
| Report anatomy | Executive summary, evidence table, driver analysis, loop trace, unknowns, and confidence area | `screenshots/researchloop-report-desktop.png` | Structure and hierarchy match. Evidence and confidence values show `DATA NOT AVAILABLE`; no unsupported conclusions are displayed. |
| Mobile layout | Compact header, query controls, four-stage loop, and stacked report panels | `screenshots/researchloop-dashboard-mobile.png` and `screenshots/researchloop-report-mobile.png` at 390 px | Stacked layout verified; document width stays at 390 px. Research table date/action columns collapse on mobile, and watchlist remove remains available. |
| Controls and output | Primary query action and report action shown in the concepts | Browser-rendered flow: submit query → stage updates → limited report; watchlist add/remove and JSON export also worked | Verified with Edge through Playwright. No browser page errors. |

## Copy and deviations

- The main first-view labels match the workspace concept. The live-data disclaimer is an intentional addition required by the demo behavior.
- Example company names, dates, results, evidence, and confidence scores from the generated report artwork were not copied into the product as facts.
- The concept shows Research as active. The initial preview instead marks its example run as finalized with limitations because the preview cannot retrieve evidence.
- No other visual or interaction mismatch remains from the reviewed desktop and mobile states.
