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
MASCULINE_PRONOUN_RE = re.compile(
    r"\b(?:er|sein|seine|seiner|seinen|seinem|jeder|jede|jedes|jedem|jeden)\b",
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
    "fahrer": "Fahrende",
    "buerger": "Bürgerinnen und Bürger oder Bevölkerung",
    "bürger": "Bürgerinnen und Bürger oder Bevölkerung",
    "entwickler": "Entwickelnde",
    "experten": "Fachleute",
    "kunden": "Kundschaft",
    "kollege": "Kollegin oder Kollege",
    "kollegen": "Kollegium",
    "lehrer": "Lehrkräfte",
    "leser": "Lesende",
    "leiter": "Leitung",
    "abteilungsleiter": "Abteilungsleitung",
    "manager": "Führungskräfte",
    "mitarbeiter": "Mitarbeitende oder Beschäftigte",
    "mieter": "Mietende",
    "nutzer": "Nutzende",
    "patienten": "Patientinnen und Patienten",
    "referent": "Referierende Person",
    "referenten": "Referierende",
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
    pair_matches = list(PAIR_FORM_RE.finditer(text))
    pair_spans = [(match.start(), match.end()) for match in pair_matches]
    masculine_matches = [
        {
            "term": match.group(0),
            "position": match.start(),
            "suggestion": POTENTIAL_MASCULINE_TERMS.get(match.group(0).casefold(), "neutralere Form prüfen"),
        }
        for match in MASCULINE_TERM_RE.finditer(text)
        if not _position_in_spans(match.start(), pair_spans)
    ]
    masculine_pronoun_matches = [
        {
            "term": match.group(0),
            "position": match.start(),
            "suggestion": "neutralen oder pluralen Bezug prüfen",
        }
        for match in MASCULINE_PRONOUN_RE.finditer(text)
    ]

    neutral_count = sum(1 for word in words if word.casefold() in NEUTRAL_TERMS)
    inclusive_count = len(INCLUSIVE_FORM_RE.findall(text))
    pair_count = len(pair_matches)
    masculine_pronoun_count = len(masculine_pronoun_matches)
    sentence_count = len(SENTENCE_RE.findall(text.strip()))
    word_count = len(words)
    relevant_mentions = neutral_count + inclusive_count + pair_count + len(masculine_matches) + masculine_pronoun_count

    return {
        "characters": len(text),
        "words": word_count,
        "sentences": sentence_count,
        "paragraphs": len(paragraphs),
        "neutral_terms": neutral_count,
        "inclusive_forms": inclusive_count,
        "paired_forms": pair_count,
        "masculine_pronouns": masculine_pronoun_count,
        "potential_masculine_generics": len(masculine_matches),
        "gender_relevant_mentions": relevant_mentions,
        "masculine_density_per_100_words": round((len(masculine_matches) / max(word_count, 1)) * 100, 2),
        "pronoun_density_per_100_words": round((masculine_pronoun_count / max(word_count, 1)) * 100, 2),
        "potential_masculine_terms": masculine_matches[:25],
        "masculine_pronoun_terms": masculine_pronoun_matches[:25],
    }


def calculate_score_breakdown(local_statistics: dict[str, Any], model_analysis: dict[str, Any] | None = None) -> dict[str, Any]:
    words = max(int(local_statistics.get("words", 0) or 0), 1)
    neutral_terms = int(local_statistics.get("neutral_terms", 0) or 0)
    inclusive_forms = int(local_statistics.get("inclusive_forms", 0) or 0)
    paired_forms = int(local_statistics.get("paired_forms", 0) or 0)
    masculine_generics = int(local_statistics.get("potential_masculine_generics", 0) or 0)
    masculine_pronouns = int(local_statistics.get("masculine_pronouns", 0) or 0)

    inclusive_total = neutral_terms + inclusive_forms + paired_forms
    explicit_person_refs = inclusive_total + masculine_generics
    gender_relevant_mentions = inclusive_total + masculine_generics + masculine_pronouns
    masculine_density = masculine_generics / words * 100
    pronoun_density = masculine_pronouns / words * 100

    if explicit_person_refs:
        visibility_score = inclusive_total / explicit_person_refs * 100
    else:
        visibility_score = 65

    masculine_avoidance_score = 100 - masculine_density * 22
    pronoun_bias_score = 100 - pronoun_density * 18
    consistency_score = _calculate_consistency_score(
        neutral_terms=neutral_terms,
        inclusive_forms=inclusive_forms,
        paired_forms=paired_forms,
        masculine_generics=masculine_generics,
        masculine_pronouns=masculine_pronouns,
    )

    components = [
        {
            "id": "inclusive_visibility",
            "label": "Inklusive Sichtbarkeit",
            "weight": 30,
            "score": round(clamp(visibility_score), 1),
            "value": inclusive_total,
            "description": "Anteil neutraler, inklusiver oder ausgeschriebener Formen an den erkannten Personenbezeichnungen.",
        },
        {
            "id": "generic_masculine",
            "label": "Generisches Maskulinum",
            "weight": 30,
            "score": round(clamp(masculine_avoidance_score), 1),
            "value": masculine_generics,
            "description": "Abzug nach Häufigkeit potenziell generischer Maskulina pro 100 Wörter.",
        },
        {
            "id": "pronoun_bias",
            "label": "Pronomenbezug",
            "weight": 20,
            "score": round(clamp(pronoun_bias_score), 1),
            "value": masculine_pronouns,
            "description": "Abzug für maskulin geprägte generische Pronomen und Besitzformen.",
        },
        {
            "id": "strategy_consistency",
            "label": "Strategiekonsistenz",
            "weight": 20,
            "score": round(clamp(consistency_score), 1),
            "value": _strategy_count(neutral_terms, inclusive_forms, paired_forms),
            "description": "Bewertet, ob der Text eine erkennbare und durchgehaltene Genderstrategie nutzt.",
        },
    ]
    weighted_score = round(sum(component["score"] * component["weight"] for component in components) / 100)

    observed_counts = {
        "neutral_terms": neutral_terms,
        "inclusive_forms": inclusive_forms,
        "paired_forms": paired_forms,
        "potential_masculine_generics": masculine_generics,
        "masculine_pronouns": masculine_pronouns,
        "gender_relevant_mentions": gender_relevant_mentions,
    }
    if model_analysis:
        observed_counts["model_score"] = int(model_analysis.get("score", 0) or 0)

    return {
        "score": int(clamp(weighted_score)),
        "rating": rating_for_score(weighted_score),
        "components": components,
        "observed_counts": observed_counts,
        "densities": {
            "masculine_generics_per_100_words": round(masculine_density, 2),
            "masculine_pronouns_per_100_words": round(pronoun_density, 2),
        },
        "sample_reliability": reliability_for_word_count(words),
        "methodology": {
            "formula": "Gesamtwertung = 30% inklusive Sichtbarkeit + 30% Vermeidung generischer Maskulina + 20% Pronomenbezug + 20% Strategiekonsistenz.",
            "scale": "Alle Teilwerte liegen auf einer Skala von 0 bis 100. Höhere Werte bedeuten eine gendergerechtere Ausprägung.",
            "limitations": "Die Kennzahlen sind heuristische Indikatoren. Kontext, Zitate, Fachtermini und intendierte Zielgruppen müssen qualitativ mitgeprüft werden.",
        },
    }


def _calculate_consistency_score(
    *,
    neutral_terms: int,
    inclusive_forms: int,
    paired_forms: int,
    masculine_generics: int,
    masculine_pronouns: int,
) -> float:
    strategy_count = _strategy_count(neutral_terms, inclusive_forms, paired_forms)
    if strategy_count == 0 and masculine_generics == 0 and masculine_pronouns == 0:
        return 85
    score = 100
    if masculine_generics:
        score -= min(45, masculine_generics * 9)
    if masculine_pronouns:
        score -= min(25, masculine_pronouns * 4)
    if strategy_count > 1:
        score -= (strategy_count - 1) * 8
    if strategy_count == 0 and (masculine_generics or masculine_pronouns):
        score -= 20
    return score


def _strategy_count(neutral_terms: int, inclusive_forms: int, paired_forms: int) -> int:
    return sum(1 for value in (neutral_terms, inclusive_forms, paired_forms) if value > 0)


def _position_in_spans(position: int, spans: list[tuple[int, int]]) -> bool:
    return any(start <= position < end for start, end in spans)


def clamp(value: float, minimum: float = 0, maximum: float = 100) -> float:
    return max(minimum, min(maximum, value))


def rating_for_score(score: float) -> str:
    if score >= 85:
        return "sehr gut"
    if score >= 70:
        return "gut"
    if score >= 55:
        return "solide"
    if score >= 35:
        return "verbesserungsbedürftig"
    return "kritisch"


def reliability_for_word_count(word_count: int) -> dict[str, str]:
    if word_count >= 120:
        return {
            "level": "hoch",
            "description": "Die Textmenge ist für eine robuste Kennzahlenbetrachtung ausreichend.",
        }
    if word_count >= 30:
        return {
            "level": "mittel",
            "description": "Die Kennzahlen sind interpretierbar, sollten aber mit qualitativen Befunden kombiniert werden.",
        }
    return {
        "level": "niedrig",
        "description": "Die Textprobe ist kurz; einzelne Begriffe können die Kennzahlen stark beeinflussen.",
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
