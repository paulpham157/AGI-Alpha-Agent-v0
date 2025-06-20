# SPDX-License-Identifier: Apache-2.0
# NOTE: This demo is a research prototype and does not implement real AGI.
"""
This module is part of a conceptual research prototype. References to
'AGI' or 'superintelligence' describe aspirational goals and do not
indicate the presence of real general intelligence. Use at your own risk.

OpenAI Agents SDK bridge for the AI-GA Meta-Evolution demo.

This script registers a minimal agent capable of driving the evolutionary
loop via the OpenAI Agents runtime. It works fully offline when no
``OPENAI_API_KEY`` is configured by falling back to the local Ollama
instance started by ``run_aiga_demo.sh``.
"""
from __future__ import annotations

try:  # optional dependency
    from openai_agents import Agent, AgentRuntime, OpenAIAgent, Tool
except ImportError:  # pragma: no cover - fallback for legacy package
    from agents import Agent, AgentRuntime, OpenAIAgent, Tool  # type: ignore

try:
    from alpha_factory_v1.backend.adk_bridge import auto_register, maybe_launch

    ADK_AVAILABLE = True
except Exception:  # pragma: no cover - optional
    ADK_AVAILABLE = False

if __package__ is None:
    import sys
    from pathlib import Path

    sys.path.append(str(Path(__file__).resolve().parent))
    __package__ = "alpha_factory_v1.demos.aiga_meta_evolution"

from .meta_evolver import MetaEvolver
from .curriculum_env import CurriculumEnv
from .utils import build_llm


# ---------------------------------------------------------------------------
# LLM setup -----------------------------------------------------------------
# ---------------------------------------------------------------------------
LLM = build_llm()

# single MetaEvolver instance reused across tool invocations
EVOLVER = MetaEvolver(env_cls=CurriculumEnv, llm=LLM)


@Tool(name="evolve", description="Run N generations of evolution")
async def evolve(generations: int = 1) -> str:
    EVOLVER.run_generations(generations)
    return EVOLVER.latest_log()


@Tool(name="best_alpha", description="Return current best architecture")
async def best_alpha() -> dict:
    return {
        "architecture": EVOLVER.best_architecture,
        "fitness": EVOLVER.best_fitness,
    }


@Tool(name="checkpoint", description="Persist current state to disk")
async def checkpoint() -> str:
    EVOLVER.save()
    return "checkpoint saved"


@Tool(
    name="history",
    description="Return evolution history as a list of (generation, avg_fitness)",
)
async def history() -> dict:
    return {"history": EVOLVER.history}


@Tool(name="reset", description="Reset evolution to generation zero")
async def reset() -> str:
    EVOLVER.reset()
    return "evolver reset"


class EvolverAgent(Agent):
    """Tiny agent exposing the meta-evolver tools."""

    name = "aiga_evolver"
    tools = [evolve, best_alpha, checkpoint, reset, history]

    async def policy(self, obs, ctx):  # type: ignore[override]
        gens = int(obs.get("gens", 1)) if isinstance(obs, dict) else 1
        await evolve(gens)
        return await best_alpha()


def main() -> None:
    runtime = AgentRuntime(api_key=None)
    agent = EvolverAgent()
    runtime.register(agent)
    print("Registered EvolverAgent with runtime")

    if ADK_AVAILABLE:
        auto_register([agent])
        maybe_launch()
        print("EvolverAgent exposed via ADK gateway")

    runtime.run()


if __name__ == "__main__":  # pragma: no cover
    main()
