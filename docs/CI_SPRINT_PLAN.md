# [See docs/DISCLAIMER_SNIPPET.md](DISCLAIMER_SNIPPET.md)

# CI Sprint Plan

This document proposes tasks to stabilize the `ci.yml` workflow so every job completes successfully.

## Goals
- Remove unsupported Python versions.
- Ensure dependency locks match available packages.
- Validate Docker builds on the highest supported Python release.
- Verify docs and platform smoke tests run on Windows and macOS.

## Proposed Tasks
1. **Update Python Matrix**
   - Limit the matrix to `3.11`–`3.13`. Python `3.14` is not available on GitHub Actions yet.
2. **Refresh Lock Files**
   - Re‑generate `requirements.lock` and related lock files with a supported `ortools` version.
3. **Check Dockerfile Base Image**
   - Align the base Python image with the CI version and verify that all wheels are available.
4. **Run Pre‑commit Hooks**
   - Execute `pre-commit run --all-files` locally before dispatching the workflow.
5. **Manual Trigger Only**
   - Keep the workflow configured for manual `workflow_dispatch` runs by the repository owner.
6. **Monitor Asset Integrity**
   - Validate Pyodide and web client assets with `scripts/fetch_assets.py --verify-only`.
   - Run `scripts/check_insight_sri.py docs/alpha_agi_insight_v1` to ensure the generated `insight.bundle.js` digest matches the `integrity` attribute in `index.html`.
7. **Fix Offline Checks**
   - Rebuild the Insight bundle to update the service worker integrity hash.
   - Ensure `scripts/verify_insight_offline.py` passes without console errors.
8. **Cross‑platform Smoke Tests**
   - Confirm `windows-smoke` and `macos-smoke` jobs install Node dependencies and run `pytest -m smoke` without failures.

This sprint ensures that all jobs (`✅ Pytest`, Windows/Mac smoke tests, Docs build, Docker build, Deploy) execute without skipping and that the published artifacts are reproducible.
