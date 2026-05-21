from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlparse

from js import Object, Response as JsResponse, fetch
from pyodide.ffi import to_js as _to_js
from workers import WorkerEntrypoint

from analysis_utils import (
    calculate_local_statistics,
    calculate_score_breakdown,
    extract_response_text,
    parse_model_json,
)


MAX_TEXT_LENGTH = 20_000
DEFAULT_MODEL = "gpt-5.4-mini"
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        path = urlparse(request.url).path

        if path == "/api/health":
            return json_response({"ok": True})

        if path == "/api/analyze":
            if request.method != "POST":
                return json_response({"detail": "Methode nicht erlaubt."}, status=405)
            return await self._analyze_text(request)

        if path.startswith("/api/"):
            return json_response({"detail": "API-Route nicht gefunden."}, status=404)

        return await self.env.ASSETS.fetch(request)

    async def _analyze_text(self, request):
        try:
            payload = await request.json()
        except Exception:
            return json_response({"detail": "Der Request-Body ist kein gültiges JSON."}, status=400)

        text = js_string(payload, "text").strip()
        if not text:
            return json_response({"detail": "Bitte gib einen Text ein."}, status=400)
        if len(text) > MAX_TEXT_LENGTH:
            return json_response(
                {"detail": f"Der Text darf maximal {MAX_TEXT_LENGTH} Zeichen lang sein."},
                status=400,
            )

        mode = js_string(payload, "mode", "neutral")
        if mode not in {"neutral", "paired", "colon"}:
            mode = "neutral"

        audience = js_string(payload, "audience", "allgemein").strip() or "allgemein"
        audience = audience[:80]

        api_key = env_value(self.env, "OPENAI_API_KEY")
        if not api_key:
            return json_response({"detail": "OPENAI_API_KEY ist nicht konfiguriert."}, status=500)

        model = env_value(self.env, "OPENAI_MODEL", DEFAULT_MODEL) or DEFAULT_MODEL
        local_statistics = calculate_local_statistics(text)

        try:
            model_analysis = await request_openai_analysis(
                api_key=api_key,
                model=model,
                text=text,
                mode=mode,
                audience=audience,
                local_statistics=local_statistics,
            )
        except OpenAIRequestError as exc:
            return json_response({"detail": str(exc)}, status=502)
        except Exception as exc:
            return json_response({"detail": f"Unerwarteter API-Fehler: {exc}"}, status=500)

        return json_response(
            {
                "analysis": model_analysis,
                "local_statistics": local_statistics,
                "score_breakdown": calculate_score_breakdown(local_statistics, model_analysis),
                "meta": {
                    "model": model,
                    "text_length": len(text),
                },
            }
        )


async def request_openai_analysis(
    *,
    api_key: str,
    model: str,
    text: str,
    mode: str,
    audience: str,
    local_statistics: dict[str, Any],
) -> dict[str, Any]:
    request_body = {
        "model": model,
        "instructions": build_instructions(mode=mode, audience=audience, local_statistics=local_statistics),
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

    response = await fetch(
        OPENAI_RESPONSES_URL,
        to_js(
            {
                "method": "POST",
                "headers": {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                "body": json.dumps(request_body, ensure_ascii=False),
            }
        ),
    )
    response_text = await response.text()

    if not response.ok:
        raise OpenAIRequestError(format_openai_error(response.status, response_text))

    try:
        response_payload = json.loads(response_text)
    except json.JSONDecodeError as exc:
        raise OpenAIRequestError("Die OpenAI API lieferte kein gültiges JSON.") from exc

    output_text = extract_response_text(response_payload)
    if not output_text:
        raise OpenAIRequestError("Die OpenAI-Antwort enthielt keinen auswertbaren Text.")

    try:
        return parse_model_json(output_text)
    except Exception as exc:
        raise OpenAIRequestError("Die OpenAI-Antwort war kein gültiges JSON.") from exc


def build_instructions(*, mode: str, audience: str, local_statistics: dict[str, Any]) -> str:
    mode_labels = {
        "neutral": "bevorzuge neutrale und substantivierte Formen, wenn sie natürlich klingen",
        "paired": "bevorzuge Paarformen, wenn sie präzise und lesbar bleiben",
        "colon": "verwende den Gender-Doppelpunkt sparsam und konsistent",
    }
    mode_label = mode_labels.get(mode, mode_labels["neutral"])
    statistics_json = json.dumps(local_statistics, ensure_ascii=False)

    return f"""
Du bist Genderpilot, ein sorgfältiges Analysewerkzeug für gendergerechte deutsche Sprache.
Bewerte den Text differenziert: Nicht jede maskulin wirkende Form ist automatisch falsch,
aber generische Maskulina, uneinheitliche Schreibweisen, unklare Zielgruppenansprache und
unnötig sperrige Alternativen sollen sichtbar werden.

Zielgruppe: {audience}
Optimierungsstil: {mode_label}

Nutze diese lokale Vorstatistik als Hinweis, nicht als alleinige Wahrheit:
{statistics_json}

Antworte ausschließlich als JSON nach dem vorgegebenen Schema. Der optimierte Text soll den
Sinn, Ton und fachlichen Inhalt des Originals bewahren.
""".strip()


def json_response(data: dict[str, Any], *, status: int = 200):
    return JsResponse.new(
        json.dumps(data, ensure_ascii=False),
        to_js(
            {
                "status": status,
                "headers": {
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": "no-store",
                },
            }
        ),
    )


def to_js(obj):
    return _to_js(obj, dict_converter=Object.fromEntries)


def js_string(payload, name: str, default: str = "") -> str:
    if isinstance(payload, dict):
        value = payload.get(name, default)
        if value is None:
            return default
        return str(value)

    try:
        value = getattr(payload, name)
    except Exception:
        return default
    if value is None:
        return default
    return str(value)


def env_value(env, name: str, default: str | None = None) -> str | None:
    try:
        value = getattr(env, name)
    except Exception:
        return default
    return str(value) if value not in ("", None) else default


def format_openai_error(status: int, response_text: str) -> str:
    try:
        payload = json.loads(response_text)
        message = payload.get("error", {}).get("message")
        if message:
            return f"OpenAI API Fehler {status}: {message}"
    except Exception:
        pass
    return f"OpenAI API Fehler {status}: {response_text[:800]}"


class OpenAIRequestError(Exception):
    pass


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
