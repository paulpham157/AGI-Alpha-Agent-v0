# SPDX-License-Identifier: Apache-2.0
"""
Self‑Healing Repo demo
──────────────────────
1. Clones a deliberately broken sample repo (tiny_py_calc).
2. Detects failing pytest run.
3. Uses OpenAI Agents SDK to propose & apply a patch via patcher_core.
4. Opens a Pull Request‑style diff in the dashboard and re‑runs tests.
"""
import logging
import os, subprocess, shutil, asyncio, time, pathlib, json
import gradio as gr
from openai_agents import Agent, OpenAIAgent, Tool
from patcher_core import generate_patch, apply_patch

logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
logger = logging.getLogger(__name__)

GRADIO_SHARE = os.getenv("GRADIO_SHARE", "0") == "1"

REPO_URL = "https://github.com/MontrealAI/sample_broken_calc.git"
LOCAL_REPO = pathlib.Path(__file__).resolve().parent / "sample_broken_calc"
CLONE_DIR = os.getenv("CLONE_DIR", "/tmp/demo_repo")


def clone_sample_repo() -> None:
    """Clone the example repo, falling back to the bundled copy."""
    result = subprocess.run(["git", "clone", REPO_URL, CLONE_DIR], capture_output=True)
    if result.returncode != 0:
        if LOCAL_REPO.exists():
            shutil.copytree(LOCAL_REPO, CLONE_DIR)
        else:
            result.check_returncode()


# ── LLM bridge ────────────────────────────────────────────────────────────────
_temp_env = os.getenv("TEMPERATURE")
LLM = OpenAIAgent(
    model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
    api_key=os.getenv("OPENAI_API_KEY", None),
    base_url=("http://ollama:11434/v1" if not os.getenv("OPENAI_API_KEY") else None),
    temperature=float(_temp_env) if _temp_env is not None else None,
)


@Tool(name="run_tests", description="execute pytest on repo")
async def run_tests():
    result = subprocess.run(["pytest", "-q"], cwd=CLONE_DIR, capture_output=True, text=True)
    return {"rc": result.returncode, "out": result.stdout + result.stderr}


@Tool(name="suggest_patch", description="propose code fix")
async def suggest_patch():
    report = await run_tests()
    patch = generate_patch(report["out"], llm=LLM, repo_path=CLONE_DIR)
    return {"patch": patch}


@Tool(name="apply_patch_and_retst", description="apply patch & retest")
async def apply_and_test(patch: str):
    apply_patch(patch, repo_path=CLONE_DIR)
    return await run_tests()


# ── Agent orchestration ───────────────────────────────────────────────────────
agent = Agent(llm=LLM, tools=[run_tests, suggest_patch, apply_patch_and_retst], name="Repo‑Healer")


async def launch_gradio():
    with gr.Blocks(title="Self‑Healing Repo") as ui:
        log = gr.Markdown("# Output log\n")

        async def run_pipeline():
            if pathlib.Path(CLONE_DIR).exists():
                shutil.rmtree(CLONE_DIR)
            clone_sample_repo()
            out1 = await run_tests()
            patch = (await suggest_patch())["patch"]
            out2 = await apply_and_test(patch)
            log_text = "### Initial test failure\n```\n" + out1["out"] + "```"
            log_text += "\n### Proposed patch\n```diff\n" + patch + "```"
            log_text += "\n### Re‑test output\n```\n" + out2["out"] + "```"
            return log_text

        run_btn = gr.Button("🩹 Heal Repository")
        run_btn.click(run_pipeline, outputs=log)
    ui.launch(server_name="0.0.0.0", server_port=7863, share=GRADIO_SHARE)


if __name__ == "__main__":
    asyncio.run(launch_gradio())
