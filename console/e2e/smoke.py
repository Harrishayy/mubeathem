"""Browser smoke test of the whole console against a running server.

    python3 console/e2e/make_runs.py /tmp/steward-runs          # fixture runs (no keys)
    STEWARD_RUNS_DIR=/tmp/steward-runs pnpm --dir console start -p 3199
    python3 console/e2e/smoke.py http://127.0.0.1:3199 /tmp/steward-runs [screenshots dir]

Checks every tab fits one viewport with no console errors, in both sources, then drives
the real flows: replaying a take's video in step with its decisions, inspecting what a
call sent and returned, the failures and what-not-to-do views, adding a lesson (which
must land in runs/practice-lessons.json), and an offline practice run started from the
Services tab appearing live. Needs Python Playwright (pip install playwright).
Exits non-zero on the first failure.
"""

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "http://127.0.0.1:3199"
RUNS = Path(sys.argv[2]) if len(sys.argv) > 2 else None
SHOTS = Path(sys.argv[3]) if len(sys.argv) > 3 else None
TABS = ["fleet", "replay", "failures", "lessons", "calls", "log", "services", "system"]
problems, notes = [], []


def check(ok, what):
    (notes if ok else problems).append(("ok   " if ok else "FAIL ") + what)


def shot(page, name):
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"{name}.png"))


def new_page(browser, errors, w=1440, h=900, scheme="dark", source="runs"):
    page = browser.new_page(viewport={"width": w, "height": h}, color_scheme=scheme)
    page.on("console", lambda m: m.type == "error" and errors.append(m.text[:240]))
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.add_init_script(f"localStorage.setItem('steward.source', '{source}')")
    return page


def tab(page, name):
    page.click(f'nav a[href="/{name}"]')
    page.wait_for_timeout(1200)


def fits(page):
    return page.evaluate("({sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth, crashed: document.querySelectorAll('.panel-error').length})")


with sync_playwright() as p:
    browser = p.chromium.launch()
    errors = []

    # --- every tab, both sources -------------------------------------------------
    for source in ("runs", "demo"):
        page = new_page(browser, errors, source=source)
        page.goto(f"{BASE}/fleet")
        page.wait_for_selector(".panel", timeout=20000)
        page.wait_for_timeout(1500)
        for t in TABS:
            tab(page, t)
            m = fits(page)
            check(m["sh"] <= m["ih"] and m["sw"] <= m["iw"], f"{source}/{t} fits one viewport ({m})")
            check(m["crashed"] == 0, f"{source}/{t} has no crashed panels")
            shot(page, f"{source}-{t}")
        page.close()

    page = new_page(browser, errors)
    page.goto(f"{BASE}/fleet")
    page.wait_for_selector('[data-panel="robot-grid"] article', timeout=20000)

    # --- replay a take with video ---------------------------------------------------
    tab(page, "replay")
    robots = page.locator('[data-panel="robot-list"] [role="button"]')
    target = None
    for i in range(robots.count()):
        if "ROBOT-A" in robots.nth(i).inner_text():
            target = robots.nth(i)
    check(target is not None, "the Isaac fixture robot is listed")
    if target:
        target.click()
        page.wait_for_timeout(800)
        # pick an attempt that has video
        opts = page.eval_on_selector_all('[data-panel="replay-stage"] select option', "os => os.map(o => [o.value, o.textContent])")
        vid = next((v for v, label in opts if "fixture-01" in label), None)
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
            page.locator('[data-panel="decision-trace"] li', has_text="verify via").first.click()
            page.wait_for_timeout(500)
            text = insp.inner_text()
            check("Policy" in text or "POLICY" in text.upper(), "a Sapling call shows its policy, evidence and claim")
            check("%" in text and "prediction set" in text, "a Sapling call shows calibrated probabilities")
            shot(page, "replay-inspector")

    # --- calls tab ----------------------------------------------------------------------
    tab(page, "calls")
    rows = page.locator('[data-panel="model-calls"] tbody tr')
    check(rows.count() > 20, f"the calls table lists calls ({rows.count()})")
    rows.nth(3).click()
    page.wait_for_timeout(400)
    check("Latency" in page.locator('[data-panel="call-inspector"]').inner_text(), "selecting a call inspects it")
    shot(page, "calls")

    # --- failures ---------------------------------------------------------------------
    tab(page, "failures")
    cards = page.locator('[data-panel="failures"] li')
    check(cards.count() >= 3, f"failures are listed ({cards.count()})")
    first = cards.first.inner_text() if cards.count() else ""
    check("Learned" in first.title() or "LEARNED" in first.upper(), "a failure shows the lesson it wrote")
    check("NEXT" in first.upper(), "a failure shows what the next attempt changed")
    dont = page.locator('[data-panel="dont-list"]').inner_text().upper()
    check("DON'T" in dont and "DO" in dont, "what-not-to-do pairs each failure with its lesson")
    check("TILT" in dont, "what-not-to-do finds the setting that separates failures")
    shot(page, "failures")

    # --- add a lesson through the debrief --------------------------------------------------
    if RUNS:
        before = len(json.loads((RUNS / "practice-lessons.json").read_text()))
        tab(page, "failures")
        cards.first.locator("button", has_text="Watch the failure").click()
        page.wait_for_timeout(1200)
        page.click('[data-panel="debrief"] button:has-text("What should change?")')
        page.wait_for_selector('[data-panel="debrief"] textarea[aria-label="Lesson text"]', timeout=15000)
        page.click('[data-panel="debrief"] button:has-text("Add to fleet lessons")')
        page.wait_for_timeout(1500)
        after = json.loads((RUNS / "practice-lessons.json").read_text())
        check(len(after) == before + 1 and after[-1]["source_robot"] == "operator", "Add to fleet lessons writes runs/practice-lessons.json")
        tab(page, "lessons")
        check(after[-1]["text"][:30] in page.locator('[data-panel="lessons"]').inner_text(), "the new lesson shows on the Lessons tab")

    # --- start an offline practice run and watch it live ---------------------------------------
    tab(page, "services")
    check("Up" in page.locator('[data-panel="services"]').inner_text(), "the services panel reports health")
    page.check('[data-panel="practice"] input[type="radio"] >> nth=0')
    page.fill('[data-panel="practice"] input[type="number"] >> nth=0', "3")
    page.click('[data-panel="practice"] button:has-text("Start offline")')
    deadline = time.time() + 40
    seen_live = False
    while time.time() < deadline:
        page.wait_for_timeout(1000)
        if "working" in page.locator("header").inner_text():
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
