"""Abstracted LLM client.

The rest of the app depends only on the `LLMClient` interface, so the model
provider can be swapped (OpenAI today; an Indian-compliant / on-prem
OpenAI-compatible endpoint later) without touching application logic.
"""
from __future__ import annotations

import json
from abc import ABC, abstractmethod

from app.config import get_settings


class LLMClient(ABC):
    @abstractmethod
    def generate_json(self, system_prompt: str, user_prompt: str) -> dict:
        """Return the model's response parsed as a JSON object."""


class OpenAIClient(LLMClient):
    def __init__(self, api_key: str | None = None, model: str | None = None) -> None:
        settings = get_settings()
        self.model = model or settings.openai_model
        self._api_key = api_key or settings.openai_api_key
        self._client = None

    def _get_client(self):
        if self._client is None:
            from openai import OpenAI

            self._client = OpenAI(api_key=self._api_key)
        return self._client

    def generate_json(self, system_prompt: str, user_prompt: str) -> dict:
        client = self._get_client()
        resp = client.chat.completions.create(
            model=self.model,
            temperature=0.1,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        content = resp.choices[0].message.content or "{}"
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            return {
                "action": "out_of_scope",
                "message": "I couldn't produce a valid query for that. Please rephrase.",
            }


_client: LLMClient | None = None


def get_llm_client() -> LLMClient:
    global _client
    if _client is None:
        _client = OpenAIClient()
    return _client


def set_llm_client(client: LLMClient) -> None:
    """Used by tests to inject a fake client."""
    global _client
    _client = client
