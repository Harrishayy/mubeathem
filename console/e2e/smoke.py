"""Browser smoke test of the whole console against a running server on real runs.

    STEWARD_RUNS_DIR=<real runs dir> pnpm --dir console start -p 3199
    python3 console/e2e/smoke.py http://127.0.0.1:3199 [screenshots dir] [--write] [--live]

Checks every tab fits one viewport with no console errors, then drives the read-only
flows on whatever real takes the runs dir holds: replaying a take's video in step with its
decisions, inspecting what a call sent and returned, the calls table, and the failures and
what-not-to-do views.

Two flows change real state, so they only run when asked:
  --write  asks the debrief for a fix (a Mubit call) and adds it to the fleet lessons
  --live   starts a one-episode practice run through Mubit and watches it arrive live
Needs Python Playwright (pip install playwright). Exits non-zero on any failure.
"""

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
WRITE, LIVE = "--write" in sys.argv, "--live" in sys.argv
BASE = ARGS[0].rstrip("/") if ARGS else "http://127.0.0.1:3199"
SHOTS = Path(ARGS[1]) if len(ARGS) > 1 else None
TABS = ["fleet", "replay", "failures", "lessons", "calls", "log", "services", "system"]
problems, notes = [], []


def check(ok, what):
    (notes if ok else problems).append(("ok   " if ok else "FAIL ") + what)


def shot(page, name):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"{name}.png"))


def new_page(browser, errors, w=1440, h=900, scheme="dark"):
    page = browser.new_page(viewport={"width": w, "height": h}, color_scheme=scheme)
    page.on("console", lambda m: m.type == "error" and errors.append(m.text[:240]))
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    return page


def tab(page, name):
    page.click(f'nav a[href="/{name}"]')
    page.wait_for_timeout(1200)


def fits(page):
    return page.evaluate("({sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth, crashed: document.querySelectorAll('.panel-error').length})")


with sync_playwright() as p:
    browser = p.chromium.launch()
    errors = []

    # --- every tab -----------------------------------------------------------------
    page = new_page(browser, errors)
    page.goto(f"{BASE}/fleet")
    page.wait_for_selector(".panel", timeout=20000)
    page.wait_for_timeout(1500)
    for t in TABS:
        tab(page, t)
        m = fits(page)
        check(m["sh"] <= m["ih"] and m["sw"] <= m["iw"], f"{t} fits one viewport ({m})")
        check(m["crashed"] == 0, f"{t} has no crashed panels")
        shot(page, t)
    takes = page.evaluate(f"fetch('{BASE}/api/runs').then(r => r.json())")["takes"]
    check(len(takes) > 0, f"the runs dir has real takes ({len(takes)})")
    with_video = [t["id"] for t in takes if t.get("video")]
    tab(page, "fleet")

    # --- replay a take with video ---------------------------------------------------
    tab(page, "replay")
    robots = page.locator('[data-panel="robot-list"] [role="button"]')
    vid = None
    for i in range(robots.count()):
        if vid or not with_video:
            break
        robots.nth(i).click()
        page.wait_for_timeout(600)
        opts = page.eval_on_selector_all('[data-panel="replay-stage"] select option', "os => os.map(o => [o.value, o.textContent])")
        vid = next((v for v, label in opts if any(t in label for t in with_video)), None)
    if not with_video:
        notes.append("skip no take has video yet; pull Isaac takes with video/pull.sh")
    else:
        check(vid is not None, "a take with video is in the episode menu")
        if vid:
            page.select_option('[data-panel="replay-stage"] select', vid)
            page.wait_for_timeout(1500)
            check(page.locator('[data-panel="replay-stage"] video.vp-video').count() == 1, "the replay shows the take's video")
            if page.locator('[data-panel="replay-stage"] button[aria-label="Play"]').count():  # selecting autoplays
                page.click('[data-panel="replay-stage"] button[aria-label="Play"]')
            page.wait_for_timeout(3500)
            sync = page.evaluate("""(() => { const v = document.querySelector('[data-panel="replay-stage"] video.vp-video');
              const t = parseFloat(document.querySelector('[data-panel="replay-stage"] .mono b')?.textContent || 'NaN');
              return { ct: v.currentTime, ready: v.readyState, t }; })()""")
            check(sync["ready"] >= 2 and sync["ct"] > 0.2, f"the video plays ({sync})")
            shot(page, "replay-video")
            # the call behind the current decision
            insp = page.locator('[data-panel="call-inspector"]')
            check(insp.count() == 1, "the call inspector sits beside the replay")
            page.locator('[data-panel="decision-trace"] li', has_text="plan via").first.click()
            page.wait_for_timeout(500)
            text = insp.inner_text()
            check("SENT" in text.upper() and "RETURNED" in text.upper(), "the inspector shows what was sent and returned")
            check("Fleet lessons:" in text or "Scene:" in text, "the plan call's user message is shown")
            verify = page.locator('[data-panel="decision-trace"] li', has_text="verify via Sapling")
            if verify.count():
                verify.first.click()
                page.wait_for_timeout(500)
                text = insp.inner_text()
                check("POLICY" in text.upper(), "a Sapling call shows its policy, evidence and claim")
                check("%" in text and "prediction set" in text, "a Sapling call shows calibrated probabilities")
            shot(page, "replay-inspector")

    # --- calls tab ----------------------------------------------------------------------
    tab(page, "calls")
    rows = page.locator('[data-panel="model-calls"] tbody tr')
    check(rows.count() > 0, f"the calls table lists calls ({rows.count()})")
    rows.first.click()
    page.wait_for_timeout(400)
    check("LATENCY" in page.locator('[data-panel="call-inspector"]').inner_text().upper(), "selecting a call inspects it")
    shot(page, "calls")

    # --- failures ---------------------------------------------------------------------
    tab(page, "failures")
    cards = page.locator('[data-panel="failures"] li')
    failed = sum(t["outcomes"].get("failed", 0) for t in takes)
    check(cards.count() > 0 or failed == 0, f"failures are listed ({cards.count()} cards, {failed} failed in the takes)")
    shot(page, "failures")

    # --- add a lesson through the debrief (--write: a Mubit call and a lesson-file write) ---
    if WRITE and cards.count():
        lessons = lambda: sum(len(f["lessons"]) for f in page.evaluate(f"fetch('{BASE}/api/lessons').then(r => r.json())")["files"])
        before = lessons()
        cards.first.locator("button", has_text="Watch the failure").click()
        page.wait_for_timeout(1200)
        page.click('[data-panel="debrief"] button:has-text("What should change?")')
        page.wait_for_selector('[data-panel="debrief"] textarea[aria-label="Lesson text"]', timeout=60000)
        page.click('[data-panel="debrief"] button:has-text("Add to fleet lessons")')
        page.wait_for_timeout(1500)
        check(lessons() == before + 1, "Add to fleet lessons writes the lesson file")

    tab(page, "services")
    check("UP" in page.locator('[data-panel="services"]').inner_text().upper(), "the services panel reports health")

    # --- a one-episode practice run through Mubit (--live: spends real calls) ---------------
    if LIVE:
        page.fill('[data-panel="practice"] input[type="number"] >> nth=0', "1")
        page.fill('[data-panel="practice"] input[type="number"] >> nth=1', "1")
        page.click('[data-panel="practice"] button:has-text("Start through Mubit")')
        deadline = time.time() + 40
        seen_live = False
        while time.time() < deadline:
            page.wait_for_timeout(1000)
            if "working" in page.locator("header").first.inner_text():
                seen_live = True
                break
        check(seen_live, "the top bar shows robots working during the run")
        tab(page, "fleet")
        shot(page, "live-fleet")
        tab(page, "services")
        deadline = time.time() + 90
        while time.time() < deadline and "pid" in page.locator('[data-panel="practice"] .panel-sub').inner_text():
            page.wait_for_timeout(1000)
        check("exited 0" in page.locator('[data-panel="practice"]').inner_text(), "the practice run finishes cleanly")

    # --- light theme and phone ------------------------------------------------------------
    for (w, h, scheme, name) in [(1280, 800, "light", "light"), (400, 860, "dark", "phone")]:
        pg = new_page(browser, errors, w, h, scheme)
        pg.goto(f"{BASE}/replay")
        pg.wait_for_selector(".panel", timeout=20000)
        pg.wait_for_timeout(1500)
        m = fits(pg)
        check(m["sw"] <= m["iw"], f"{name}: no sideways scroll ({m})")
        shot(pg, name)
        pg.close()

    browser.close()

check(not errors, f"no console errors ({len(errors)}: {errors[:4]})")
print("\n".join(notes + problems))
sys.exit(1 if problems else 0)
