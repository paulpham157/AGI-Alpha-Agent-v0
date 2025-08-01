#!/usr/bin/env python
# SPDX-License-Identifier: Apache-2.0
"""Smoke test that the Insight PWA loads offline."""

from __future__ import annotations

import os
import sys
from playwright.sync_api import Error as PlaywrightError, sync_playwright
import time


URL = "http://localhost:8000/alpha_agi_insight_v1/"

# Allow the timeout to be overridden via PWA_TIMEOUT_MS for slow CI runners.
# Default to three minutes to handle network latency on CI workers.
TIMEOUT_MS = int(os.environ.get("PWA_TIMEOUT_MS", "180000"))


def _print_console(logs: list[str]) -> None:
    if logs:
        print("--- Browser console logs ---", file=sys.stderr)
        for line in logs:
            print(line, file=sys.stderr)


def _attempt() -> bool:
    logs: list[str] = []
    page_errors: list[str] = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--disable-web-security"])
            context = browser.new_context()
            page = context.new_page()

            def on_console(msg: object) -> None:
                entry = f"[{msg.type}] {msg.text}"
                logs.append(entry)
                print(entry, file=sys.stderr, flush=True)

            def on_page_error(exc: Exception) -> None:
                err = str(exc)
                page_errors.append(err)
                print(err, file=sys.stderr, flush=True)

            page.on("console", on_console)
            page.on("pageerror", on_page_error)
            context.on("console", on_console)
            context.on("pageerror", on_page_error)
            page.goto(URL)
            page.wait_for_function("navigator.serviceWorker.ready", timeout=TIMEOUT_MS)
            page.wait_for_selector("body", timeout=TIMEOUT_MS)
            context.set_offline(True)
            page.reload()
            page.wait_for_selector("body", timeout=TIMEOUT_MS)
            page.wait_for_selector("#tree-container .node", timeout=TIMEOUT_MS)
            browser.close()
        return True
    except PlaywrightError as exc:
        print(f"Playwright error: {exc}", file=sys.stderr)
    except Exception as exc:  # noqa: BLE001
        print(f"Offline check failed: {exc}", file=sys.stderr)
    _print_console(logs)
    if page_errors:
        print("--- Page errors ---", file=sys.stderr)
        for err in page_errors:
            print(err, file=sys.stderr)
    return False


def main() -> int:
    for attempt in range(2):
        if _attempt():
            return 0
        if attempt == 0:
            print("Retrying offline check...", file=sys.stderr)
            time.sleep(2)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
