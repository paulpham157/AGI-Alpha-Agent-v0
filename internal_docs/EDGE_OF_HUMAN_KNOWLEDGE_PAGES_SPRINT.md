[See docs/DISCLAIMER_SNIPPET.md](DISCLAIMER_SNIPPET.md)

# Edge-of-Human-Knowledge Pages Sprint for Codex

This sprint explains how Codex can publish the **Alpha-Factory** demo gallery to GitHub Pages so each showcase plays back organically with a single command. Use the shell wrapper `scripts/edge_human_knowledge_pages_sprint.sh` or the cross‑platform Python version `scripts/edge_human_knowledge_pages_sprint.py` which call the full deployment workflow and print the final URL.

## Quick Start
1. Install **Python 3.11+** and **Node.js 22+**.
2. Run `nvm use` to activate the version from `.nvmrc` before installing dependencies.
3. Run the wrapper:
   ```bash
   ./scripts/edge_human_knowledge_pages_sprint.sh
   # or on systems without Bash
   python scripts/edge_human_knowledge_pages_sprint.py
   ```
  This triggers `edge_of_knowledge_sprint.sh` which performs environment validation, dependency checks, asset builds, integrity tests and finally deploys the site via `mkdocs gh-deploy`.
  Export `PYODIDE_BASE_URL` or `HF_GPT2_BASE_URL` beforehand to
  customize asset downloads if the defaults fail. `IPFS_GATEWAY` only
  applies when retrieving pinned Insight demo runs.
3. Visit the printed URL in an incognito window and ensure `index.html` links to every demo with preview media.
4. The repository owner must start the [`Docs` workflow](../.github/workflows/docs.yml)
   manually from the **Actions** tab to publish the site to GitHub Pages.

## Maintenance
- Re-run the wrapper whenever demo docs or assets change.
- Validate formatting and basic tests before publishing:
  ```bash
  pre-commit run --files <changed_files>
  pytest -m 'not e2e'
  ```
