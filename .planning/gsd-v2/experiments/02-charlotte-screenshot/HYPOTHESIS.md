# Experiment 02 - charlotte_screenshot timeouts

## Metric
`charlotte:screenshot` (`{save:true}`, the runner's only common call shape: full-page PNG) per-call latency and
timeout rate, measured by driving a private Charlotte MCP server over stdio
(`bench.mjs`: tab_open, configure, navigate localhost:3000, reload, wait_for, then N screenshots).
Pass = 0 timeouts and p95 < 2 s with the macOS display both on and off.

## Observed in session logs (334 runner transcripts, `~/.claude/projects/-Users-ollorin-igaming-platform-apps-e2e-charlotte`)
- Call args: `{save:true}` in 404 of 522 calls (no selector, default format png); error text
  `Page.captureScreenshot timed out. Increase the 'protocolTimeout' ...` (SESSION_ERROR) after exactly ~180 s.
- Failure is all-or-nothing per session; the 42 successful results sit in 6 sessions. Other tools (evaluate, observe) work in the same sessions.
- Fails on every page tried (player-web, operator-web incl. /login), so not page-specific.

## Hypotheses (from the briefing) and the discriminating test
| # | Hypothesis | Test |
|---|---|---|
| H1 | Display/compositor state: no frames while display asleep | correlate call outcomes with `pmset -g log` display on/off; then reproduce with display off |
| H2 | Background/occlusion flags missing | matrix.mjs config C, D |
| H3 | Tab not foreground (needs bringToFront) | matrix.mjs config E |
| H4 | fullPage / captureBeyondViewport on tall pages | matrix.mjs config F, G |
| H5 | Recent profile-lifecycle commit 2818665 changed flags | read diff (it changes only userDataDir/cache flags); live copy does not even contain it and fails identically |
| H6 | Puppeteer version | live copy and fork both pin puppeteer 24.37.3 / Chrome 145 |

## Baseline (main @ 2818665, runner launch conditions: `node dist/index.js`, `headless:true`, default args, no env)
See RESULT.md table (rows "main").
