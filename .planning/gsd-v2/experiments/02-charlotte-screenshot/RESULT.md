# Experiment 02 - RESULT: charlotte_screenshot timeouts

## Cause (reproduced)
Chrome "new" headless (`headless: true`) on macOS is a windowed Chrome. While the display is asleep it produces no
compositor frames, so `Page.captureScreenshot` never completes and Puppeteer fails it at the 180 s protocolTimeout.
Other CDP calls (Runtime.evaluate, DOM) do not need a frame, which is why only screenshots broke.

Evidence chain:
1. Session logs: 330 `charlotte_screenshot` results since 2026-10-26 joined to `pmset -g log` display on/off events
   (`logs/pmset-display.txt`): 10 images, all with display ON; 320 `captureScreenshot timed out`, all with display OFF;
   zero timeouts with display on, zero images with display off. (Earlier dates are outside the pmset log; the 2026-10-21 successes
   at 18:49-18:54Z also fit an evening on-window but are unverified.) The runner runs overnight / lid-closed, hence 498/522.
2. Reproduction (display off, `matrix.mjs`, direct puppeteer 24.37.3 / Chrome 145, 20 s timeout, 2 shots each):

| Config | display off |
|---|---|
| A main: `headless:true` + Charlotte args | 2/2 timeout |
| C + `--disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-background-timer-backgrounding` | 2/2 timeout |
| D C + `--disable-features=CalculateNativeWinOcclusion,MacWebContentsOcclusion` | 2/2 timeout |
| E `page.bringToFront()` first | 2/2 timeout |
| F viewport-only (`fullPage:false`) | 2/2 timeout |
| G `captureBeyondViewport:false` | 2/2 timeout |
| B `headless:'shell'` (chrome-headless-shell) | 2/2 ok (200, 342 ms) |

   Refuted: background/occlusion flags (H2), foreground tab (H3), fullPage/beyond-viewport (H4). H5 (commit 2818665) is
   not the cause: it touches only userDataDir/cache flags and the live copy, which predates it, fails identically.
   H6 not the cause: shell and new headless are the same Puppeteer.
3. Runner launch conditions (read only): `~/.claude/.mcp.json` runs `node /Users/ollorin/.claude-mcp-servers/charlotte/dist/index.js`
   (no env, no args); that build is at b94eb19 with `headless: true` (`dist/browser/browser-manager.js:10`, default args, no flags).
   Fork source before fix: `src/browser/browser-manager.ts:87` (`headless: true`), `src/instances/instance-manager.ts:199`
   (`launch({ headless: true })`), screenshot call `src/tools/observation.ts:299-305` (`fullPage: true`, runner passes `{save:true}`).

## Fix
Commit `6defd8d` on `~/charlotte` branch `fix/screenshot-timeout` (from `main` 2818665; not pushed, main untouched).
- `src/browser/browser-manager.ts`: new `resolveHeadlessMode()` returns `"shell"` when the chrome-headless-shell build matching the pinned
  puppeteer is installed, else `true` plus a warning; `CHARLOTTE_HEADLESS=shell|new` overrides. `launch()` uses it (line ~125).
- `src/instances/instance-manager.ts:199`: stops forcing `headless: true`.
- Test `tests/unit/browser/browser-manager-headless.test.ts` (6 tests); CHANGELOG entry.

## Before / after
Method: `bench.mjs` drives the private server (runner-like sequence, `{save:true}`). Display state from `pmset -g log` (the `display` field inside
the bench JSON uses an ioreg probe that proved unreliable; ignore it). "Parallel" = 20 independent server instances x 1 shot at once (used for
display-off because each timeout costs 180 s); "seq" = 1 instance x 20 shots.

| Build | Display | Design | ok / n | p50 | p95 | notes |
|---|---|---|---|---|---|---|
| main 2818665 | on | seq n=20 | 20/20 | 185 ms | 206 ms | max 274 ms |
| main 2818665 | off | parallel 20x1 | 0/20 | 23.7 s | 183.7 s | 9 timeouts at 180.0-185.5 s; 11 fast `Cannot take screenshot with 0 width` (35 ms-25.8 s, seen only at 20-way concurrency; cause not isolated, plausibly the same no-rendering state) |
| fixed 6defd8d (shell 145) | off | parallel 20x1 | 20/20 | 696 ms | 1448 ms | max 4547 ms (20 Chromes launching at once) |
| fixed 6defd8d (shell 145) | off | seq n=20 | 20/20 | 217 ms | 240 ms | max 246 ms |
| fixed 6defd8d | on | - | not measured | | | display stayed off for the whole session; shell has no window, so state-independence is by construction and matches the off/seq row |

Raw logs: `logs/` (`main-off-*.json`, `fixed-off-*.json`, `fixed-off-seq.json`, `matrix-off.txt`, `suite-*.txt`, `pmset-display.txt`).

## Tests
- Regression test fails before, passes after: with `src/` stashed, `npx vitest run tests/unit/browser/browser-manager-headless.test.ts` = 6 failed (resolveHeadlessMode missing; launch got `headless: true`, InstanceManager forced `true`); with fix = 6 passed.
- Behavioural proof in the repo's own suite, display off: main, `npx vitest run tests/integration/observation.test.ts tests/integration/screenshot-artifacts.test.ts` = 7 failed / 17 passed (30 s timeouts, `logs/suite-main-display-off.txt`); fixed with shell installed = 24/24 passed.
- Full suite, `cd ~/charlotte && npx vitest run`: before fix (display on) 28 files / 356 tests passed; after fix with shell installed (`PUPPETEER_CACHE_DIR` pointing at a private cache holding chrome-headless-shell 145) 29 files / 362 tests passed (display off).
  Without the shell installed the build falls back to new headless and, with the display off, the same screenshot-dependent integration tests fail exactly as on main. So install the shell on any machine that runs the suite.
- Not CI-testable: the display-off condition itself; the unit tests pin the launch mode, the integration tests above are the live check.

## Rollout to the live copy (steps only; NOT executed)
Live copy: `/Users/ollorin/.claude-mcp-servers/charlotte` (git clone at b94eb19, puppeteer 24.37.3 -> Chrome 145.0.7632.67, only chrome-headless-shell 154 cached).
1. Install the matching shell (additive; the old build ignores it): `npx puppeteer browsers install chrome-headless-shell@145.0.7632.67`.
2. In the live copy: `git fetch /Users/ollorin/charlotte fix/screenshot-timeout && git merge --ff-only FETCH_HEAD` (b94eb19 -> 2818665 -> 6defd8d, so it also ships the unpushed profile-lifecycle commit; to ship only the fix, cherry-pick 6defd8d and resolve browser-manager.ts), then `npm run build`.
3. Wait for the current milestone run to finish (a rebuilt dist affects only newly spawned MCP children; running `claude` sessions keep their loaded code, but do not rebuild mid-run).
4. Verify on a new session: `charlotte_tab_open`, `charlotte_navigate`, `charlotte_screenshot {save:true}` returns in < 2 s; the server log must not contain the "chrome-headless-shell is not installed" warning.
5. Stopgap needing no code (only while display is on): keep the display awake during runs (`caffeinate -d`); confirms the cause but not a fix for lid-closed runs.

## Rollback
- Config-only: set `"env": {"CHARLOTTE_HEADLESS": "new"}` for the charlotte entry in `~/.claude/.mcp.json` (restores the old launch mode with the new build).
- Full: in the live copy `git reset --hard b94eb19 && npm run build` (only inside the live copy), restart sessions. The installed shell dir can stay.

## Open items
- Display-on measurement of the fixed build was not captured (display never woke during the session); the run script `on-window-after.sh` is in this directory.
- Runner scenarios that rely on new-headless-specific rendering (fonts/scrollbars, `window.open`) were not re-run; the fork suite (incl. dialogs, interaction, screencast) passes on the shell. The Charlotte regression run (`deno task test:regression`) is the check before relying on it.

## Rollout (executed 2026-10-31)
- Peer v0.1.34 orchestrator gave "go" (no Charlotte run active). `~/charlotte` main fast-forwarded to `6defd8d`.
- Live copy `~/.claude-mcp-servers/charlotte`: dist backed up to `backup/dist-b94eb19`, fast-forwarded b94eb19 → 6defd8d (also ships 2818665), `npm run build` ok.
- `chrome-headless-shell@145.0.7632.67` installed to `~/.cache/puppeteer` (no fallback warning on launch).
- Smoke on the live build, **display OFF** (pmset: last event 17:54 local "turned off"; CEO confirmed the screen was dark): 10/10, p50 192 ms, p95 255 ms (`live-after-deploy`) and 10/10, p50 183 ms, p95 217 ms (`live-dark-screen`). The bench JSON's `display:"on"` is the unreliable ioreg probe (see Method). The "after, display on" measurement is still open.
- Keep the dist backup until a real Charlotte run is seen working. Rollback: copy `backup/dist-b94eb19` over `dist/`, or set `CHARLOTTE_HEADLESS=new`.
