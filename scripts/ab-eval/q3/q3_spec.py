"""Q3 spec: scenarios, truth, fixtures, arms, gates (DIAGNOSIS-charlotte-runner.md section 6). New code only; imports nothing from ab_*.py."""
from __future__ import annotations

import hashlib
import json
import re
import shutil
from pathlib import Path
from typing import Dict, List

HOME = Path.home()
Q3_HOME = HOME / "ab-eval-q3"
SCRIPT_DIR = Path(__file__).resolve().parent
SEEDED_SRC = SCRIPT_DIR.parent / "fixtures" / "qa-app-seeded"
DEFECTS = SCRIPT_DIR.parent / "examples" / "artifacts" / "Q" / "defects.json"
RUNNER_DIR = HOME / "igaming-platform" / "apps" / "e2e-charlotte"
RUNNER_SRC = {"run.ts": RUNNER_DIR / "runner" / "run.ts", "prompt.ts": RUNNER_DIR / "runner" / "prompt.ts",
              "tool-policy.ts": RUNNER_DIR / "runner" / "tool-policy.ts"}

SEEDED_PORT = 48765
CLEAN_PORT = 48766
PORTS = {"seeded": SEEDED_PORT, "clean": CLEAN_PORT}

MODEL_PIN = "claude-haiku-4-5-20251001"
LEAN_DENIED = ["Agent", "Skill", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"]
C_ENV = {"CLAUDE_CODE_DISABLE_CLAUDE_MDS": "1", "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1"}
STEP2_OLD = 'call charlotte_configure with screenshot_dir: "{shot}"'
STEP2_NEW = 'call charlotte_configure with screenshot_dir: "{shot}", auto_snapshot: "manual"'

# tag -> (assertion text, seeded-fixture truth, defect id or None)
ASSERTIONS: List[tuple] = [
    ("S1", "The home page has a non-empty document title.", "PASS", None),
    ("S2", "Clicking 'Add to wishlist' on the home page shows visible feedback: the #wishlist-status text becomes non-empty.", "FAIL", "F1"),
    ("S3", "The catalog page logs no console errors on load.", "FAIL", "F2"),
    ("S4", "The catalog table lists at least 3 item rows.", "PASS", None),
    ("S5", "Searching the catalog for 'zzzz' (no match) shows an explicit empty-state message to the user.", "FAIL", "F5"),
    ("S6", "At a 375px wide viewport the catalog page has no horizontal overflow (scrollWidth <= clientWidth).", "FAIL", "F6"),
    ("S7", "The contact form has a submit button.", "PASS", None),
    ("S8", "The contact form email field has an associated visible label (label[for], wrapping label or aria-label).", "FAIL", "F4"),
    ("S9", "Submitting the contact form with name 'Sam' and email 'sam@example.com' shows a success message and no error text.", "FAIL", "F3"),
]
TAGS = [a[0] for a in ASSERTIONS]
TRUTH_SEEDED: Dict[str, str] = {t: v for t, _, v, _ in ASSERTIONS}
TRUTH_CLEAN: Dict[str, str] = {t: "PASS" for t in TAGS}
DEFECT_OF: Dict[str, str] = {t: d for t, _, _, d in ASSERTIONS if d}

STEPS = """Label every step in the RESULT with its tag (S1..S9) at the start of the "step" text, one RESULT step per tagged step below.
S1. Navigate to {base}/index.html and read document.title.
S2. On the home page click the button "Add to wishlist", then read the text of #wishlist-status.
S3. Navigate to {base}/catalog.html and read the console messages with charlotte_console.
S4. Count the rows in the catalog table body (#rows tr).
S5. Type "zzzz" into the catalog search box with charlotte_type, then read the table body and the visible page text.
S6. Set the viewport to width 375 height 800 with charlotte_viewport, then evaluate document.documentElement.scrollWidth and document.documentElement.clientWidth.
S7. Navigate to {base}/contact.html and check that a submit button exists.
S8. Check whether the email input (#email) has a label: label[for=email], a wrapping label, or an aria-label.
S9. Type "Sam" in the name input and "sam@example.com" in the email input with charlotte_type, click the submit button, then read the text of #result."""


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def scenario_data(kind: str) -> dict:
    base = f"http://127.0.0.1:{PORTS[kind]}"
    return {
        "name": "Gadget Shop storefront checks",
        "startUrl": f"{base}/index.html",
        "steps": STEPS.format(base=base),
        "assertions": [f"{t}: {text}" for t, text, _, _ in ASSERTIONS],
        "snapshotAt": ["After S5 (catalog empty search)", "After S9 (contact submit)"],
        "extraData": {},
    }


def _sub(text: str, old: str, new: str) -> str:
    if text.count(old) != 1:
        raise RuntimeError(f"clean-fixture patch anchor not found exactly once: {old!r}")
    return text.replace(old, new)


def build_clean(dest: Path) -> None:
    """Defect-fixed copy of the seeded app (the repo's fixtures/qa-app is a one-button stub with no pages for S1..S9).
    Fixes F1-F6 only; U1-U3 (css contrast/focus, copy) stay because no assertion tests them."""
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(SEEDED_SRC, dest)
    idx = dest / "index.html"
    idx.write_text(_sub(idx.read_text(), '<p id="wishlist-status" class="ok"></p>',
                        '<p id="wishlist-status" class="ok"></p>\n<script>document.getElementById(\'wishlist\').addEventListener(\'click\', () => { document.getElementById(\'wishlist-status\').textContent = \'Added to wishlist\'; });</script>'))
    cat = dest / "catalog.html"
    t = cat.read_text()
    t = _sub(t, 'style="width:640px;border-collapse:collapse"', 'style="width:100%;border-collapse:collapse"')
    t = _sub(t, "function render(list) {\n", "function render(list) {\n  if (list.length === 0) { rows.innerHTML = '<tr><td colspan=\"4\">No results found</td></tr>'; return; }\n")
    cat.write_text(t)
    con = dest / "contact.html"
    t = con.read_text()
    t = _sub(t, '<input id="email" name="email" type="email" placeholder="you@example.com">',
             '<label for="email">Email</label><br>\n<input id="email" name="email" type="email" placeholder="you@example.com">')
    t = _sub(t, "out.textContent = 'Error 500: Internal Server Error';", "out.textContent = 'Message sent. Thank you!';")
    con.write_text(t)
    (dest / "assets").mkdir()
    (dest / "assets" / "promo-banner.json").write_text('{"banner":"none"}\n')


# arm -> dict(model, env, extra_args, denied, prompt_patch)
ARMS = {
    "control": dict(model=MODEL_PIN, env={}, flags=[], denied=[], manual=False),
    "C": dict(model=MODEL_PIN, env=C_ENV, flags=[], denied=LEAN_DENIED, manual=False),  # probes: --disable-slash-commands (+2.1k tokens) and auto_snapshot manual (delta kept) dropped
    "M1": dict(model="haiku", env={}, flags=[], denied=[], manual=False),
    "C+M1": dict(model="haiku", env=C_ENV, flags=[], denied=LEAN_DENIED, manual=False),
}

# Haiku 4.5 and 5.5 list prices, USD per Mtok input/output; cache read 0.1x, 5m write 1.25x, 1h write 2x (DIAGNOSIS s4)
PRICES = {
    "haiku-4.5": dict(tiers=[(None, 1.0, 5.0)]),
    "haiku-5.5": dict(tiers=[(100_000, 0.10, 0.50), (None, 0.50, 2.50)]),
}
