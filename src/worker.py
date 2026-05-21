from __future__ import annotations

from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from workers import WorkerEntrypoint

from analysis_utils import calculate_local_statistics, extract_response_text, parse_model_json


MAX_TEXT_LENGTH = 20_000
DEFAULT_MODEL = "gpt-5.4-mini"
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        path = urlparse(request.url).path
        if path.startswith("/api/"):
            import asgi

            return await asgi.fetch(app, request.js_object, self.env)

        return await self.env.ASSETS.fetch(request)


class AnalyzeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_TEXT_LENGTH)
    mode: Literal["neutral", "paired", "colon"] = "neutral"
    audience: str = Field(default="allgemein", max_length=80)


app = FastAPI(title="Genderpilot API")


@app.get("/api/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/api/analyze")
async def analyze_text(payload: AnalyzeRequest, request: Request) -> dict:
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Bitte gib einen Text ein.")

    local_statistics = calculate_local_statistics(text)
    env = request.scope["env"]
    api_key = _env_value(env, "OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY ist nicht konfiguriert.",
        )

    model = _env_value(env, "OPENAI_MODEL", DEFAULT_MODEL)
    model_analysis = await _request_openai_analysis(
        api_key=api_key,
        model=model,
        text=text,
        mode=payload.mode,
        audience=payload.audience,
        local_statistics=local_statistics,
    )

    return {
        "analysis": model_analysis,
        "local_statistics": local_statistics,
        "meta": {
            "model": model,
            "text_length": len(text),
        },
    }


async def _request_openai_analysis(
    *,
    api_key: str,
    model: str,
    text: str,
    mode: str,
    audience: str,
    local_statistics: dict,
) -> dict:
    request_body = {
        "model": model,
        "instructions": _build_instructions(mode=mode, audience=audience, local_statistics=local_statistics),
        "input": "Analysiere und optimiere den folgenden deutschen Text:\n\n" + text,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "genderpilot_analysis",
                "strict": True,
                "schema": ANALYSIS_SCHEMA,
            }
        },
    }

    async with httpx.AsyncClient(timeout=45.0) as client:
        response = await client.post(
            OPENAI_RESPONSES_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=request_body,
        )

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI API Fehler {response.status_code}: {response.text[:800]}",
        )

    output_text = extract_response_text(response.json())
    if not output_text:
        raise HTTPException(status_code=502, detail="Die OpenAI-Antwort enthielt keinen auswertbaren Text.")

    try:
        return parse_model_json(output_text)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Die OpenAI-Antwort war kein gültiges JSON.") from exc


def _build_instructions(*, mode: str, audience: str, local_statistics: dict) -> str:
    mode_labels = {
        "neutral": "bevorzuge neutrale und substantivierte Formen, wenn sie natürlich klingen",
        "paired": "bevorzuge Paarformen, wenn sie präzise und lesbar bleiben",
        "colon": "verwende den Gender-Doppelpunkt sparsam und konsistent",
    }
    mode_label = mode_labels.get(mode, mode_labels["neutral"])

    return f"""
Du bist Genderpilot, ein sorgfältiges Analysewerkzeug für gendergerechte deutsche Sprache.
Bewerte den Text differenziert: Nicht jede maskulin wirkende Form ist automatisch falsch,
aber generische Maskulina, uneinheitliche Schreibweisen, unklare Zielgruppenansprache und
unnötig sperrige Alternativen sollen sichtbar werden.

Zielgruppe: {audience}
Optimierungsstil: {mode_label}

Nutze diese lokale Vorstatistik als Hinweis, nicht als alleinige Wahrheit:
{local_statistics}

Antworte ausschließlich als JSON nach dem vorgegebenen Schema. Der optimierte Text soll den
Sinn, Ton und fachlichen Inhalt des Originals bewahren.
""".strip()


def _env_value(env, name: str, default: str | None = None) -> str | None:
    try:
        value = getattr(env, name)
    except Exception:
        return default
    return value if value not in ("", None) else default


ANALYSIS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["score", "rating", "summary", "findings", "alternatives", "improved_text", "statistics"],
    "properties": {
        "score": {"type": "integer", "minimum": 0, "maximum": 100},
        "rating": {
            "type": "string",
            "enum": ["sehr gut", "solide", "verbesserungsbedürftig", "kritisch"],
        },
        "summary": {"type": "string"},
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["category", "severity", "excerpt", "explanation", "suggestion"],
                "properties": {
                    "category": {
                        "type": "string",
                        "enum": [
                            "generisches_maskulinum",
                            "inkonsistenz",
                            "ansprache",
                            "lesbarkeit",
                            "neutralitaet",
                            "sonstiges",
                        ],
                    },
                    "severity": {"type": "string", "enum": ["info", "niedrig", "mittel", "hoch"]},
                    "excerpt": {"type": "string"},
                    "explanation": {"type": "string"},
                    "suggestion": {"type": "string"},
                },
            },
        },
        "alternatives": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["original", "neutral", "paired", "compact", "rationale"],
                "properties": {
                    "original": {"type": "string"},
                    "neutral": {"type": "string"},
                    "paired": {"type": "string"},
                    "compact": {"type": "string"},
                    "rationale": {"type": "string"},
                },
            },
        },
        "improved_text": {"type": "string"},
        "statistics": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "estimated_generic_masculine",
                "estimated_gender_inclusive_forms",
                "estimated_neutral_forms",
                "consistency_notes",
            ],
            "properties": {
                "estimated_generic_masculine": {"type": "integer", "minimum": 0},
                "estimated_gender_inclusive_forms": {"type": "integer", "minimum": 0},
                "estimated_neutral_forms": {"type": "integer", "minimum": 0},
                "consistency_notes": {"type": "string"},
            },
        },
    },
}
