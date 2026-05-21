from __future__ import annotations

import json
import re
from typing import Any


GERMAN_WORD_RE = re.compile(r"[A-Za-zÄÖÜäöüß]+(?:[:*_][A-Za-zÄÖÜäöüß]+)?(?:[-'][A-Za-zÄÖÜäöüß]+)*")
SENTENCE_RE = re.compile(r"[.!?]+(?:\s+|$)")
INCLUSIVE_FORM_RE = re.compile(
    r"\b[A-Za-zÄÖÜäöüß]+(?:(?:[:*_][A-Za-zÄÖÜäöüß]+)|(?:Innen\b))",
    re.IGNORECASE,
)
PAIR_FORM_RE = re.compile(
    r"\b[A-Za-zÄÖÜäöüß]+innen\s+(?:und|oder)\s+[A-Za-zÄÖÜäöüß]+"
    r"|\b[A-Za-zÄÖÜäöüß]+\s+(?:und|oder)\s+[A-Za-zÄÖÜäöüß]+innen\b",
    re.IGNORECASE,
)

NEUTRAL_TERMS = {
    "angestellte",
    "angestellten",
    "beschaeftigte",
    "beschaeftigten",
    "beschäftigte",
    "beschäftigten",
    "fachkraefte",
    "fachkraeften",
    "fachkräfte",
    "fachkräften",
    "gaeste",
    "gaesten",
    "gäste",
    "gästen",
    "kundschaft",
    "lehrkraefte",
    "lehrkraeften",
    "lehrkräfte",
    "lehrkräften",
    "menschen",
    "mitglieder",
    "mitgliedern",
    "personen",
    "publikum",
    "studierende",
    "studierenden",
    "team",
    "teilnehmende",
    "teilnehmenden",
    "vertretung",
}

POTENTIAL_MASCULINE_TERMS = {
    "anwender": "Nutzende",
    "ansprechpartner": "Ansprechperson",
    "arbeitgeber": "Arbeitgebende",
    "arbeitnehmer": "Arbeitnehmende",
    "aerzte": "ärztliches Personal",
    "ärzte": "ärztliches Personal",
    "autoren": "Autorenschaft",
    "bewerber": "Bewerbende",
    "besucher": "Besuchende",
    "buerger": "Bürgerinnen und Bürger oder Bevölkerung",
    "bürger": "Bürgerinnen und Bürger oder Bevölkerung",
    "entwickler": "Entwickelnde",
    "experten": "Fachleute",
    "kunden": "Kundschaft",
    "kollegen": "Kollegium",
    "lehrer": "Lehrkräfte",
    "leser": "Lesende",
    "manager": "Führungskräfte",
    "mitarbeiter": "Mitarbeitende oder Beschäftigte",
    "mieter": "Mietende",
    "nutzer": "Nutzende",
    "patienten": "Patientinnen und Patienten",
    "schueler": "Schülerinnen und Schüler oder Lernende",
    "schüler": "Schülerinnen und Schüler oder Lernende",
    "studenten": "Studierende",
    "teilnehmer": "Teilnehmende",
    "waehler": "Wählende",
    "wähler": "Wählende",
}

MASCULINE_TERM_RE = re.compile(
    r"\b("
    + "|".join(sorted((re.escape(term) for term in POTENTIAL_MASCULINE_TERMS), key=len, reverse=True))
    + r")(?![:*_]?[Ii]nnen\b|[:*_])\b",
    re.IGNORECASE,
)


def calculate_local_statistics(text: str) -> dict[str, Any]:
    words = GERMAN_WORD_RE.findall(text)
    paragraphs = [paragraph for paragraph in re.split(r"\n\s*\n", text.strip()) if paragraph.strip()]
    masculine_matches = [
        {
            "term": match.group(0),
            "position": match.start(),
            "suggestion": POTENTIAL_MASCULINE_TERMS.get(match.group(0).casefold(), "neutralere Form prüfen"),
        }
        for match in MASCULINE_TERM_RE.finditer(text)
    ]

    neutral_count = sum(1 for word in words if word.casefold() in NEUTRAL_TERMS)
    inclusive_count = len(INCLUSIVE_FORM_RE.findall(text))
    pair_count = len(PAIR_FORM_RE.findall(text))
    sentence_count = len(SENTENCE_RE.findall(text.strip()))

    return {
        "characters": len(text),
        "words": len(words),
        "sentences": sentence_count,
        "paragraphs": len(paragraphs),
        "neutral_terms": neutral_count,
        "inclusive_forms": inclusive_count,
        "paired_forms": pair_count,
        "potential_masculine_generics": len(masculine_matches),
        "potential_masculine_terms": masculine_matches[:25],
    }


def extract_response_text(payload: dict[str, Any]) -> str:
    direct_text = payload.get("output_text")
    if isinstance(direct_text, str) and direct_text.strip():
        return direct_text

    chunks: list[str] = []
    for output_item in payload.get("output", []):
        if not isinstance(output_item, dict):
            continue
        for content_item in output_item.get("content", []):
            if not isinstance(content_item, dict):
                continue
            text = content_item.get("text")
            if isinstance(text, str):
                chunks.append(text)

    return "".join(chunks)


def parse_model_json(output_text: str) -> dict[str, Any]:
    cleaned = output_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        return json.loads(cleaned[start : end + 1])
