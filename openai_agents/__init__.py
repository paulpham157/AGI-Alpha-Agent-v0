# SPDX-License-Identifier: Apache-2.0
"""Minimal stub for openai_agents.

Provides basic classes so demos import without the real SDK."""

import importlib.machinery

_loader = importlib.machinery.SourceFileLoader(__name__, __file__)
__spec__ = importlib.machinery.ModuleSpec(__name__, _loader, origin=__file__)

__version__ = "0.0.17"


class AgentRuntime:
    def __init__(self, *args, **kwargs):
        pass

    def register(self, *args, **kwargs):
        pass


class OpenAIAgent:
    def __init__(self, *args, **kwargs):
        pass

    async def __call__(self, text: str) -> str:  # pragma: no cover - demo stub
        return "ok"


# Mirror new SDK naming
Agent = OpenAIAgent


def Tool(*_args, **_kwargs):
    def decorator(func):
        return func

    return decorator


function_tool = Tool
