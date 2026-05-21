import json
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from analysis_utils import (
    calculate_local_statistics,
    calculate_score_breakdown,
    extract_response_text,
    parse_model_json,
)


def test_calculate_local_statistics_detects_common_signals():
    stats = calculate_local_statistics(
        "Alle Mitarbeiter und Kunden treffen die Studierenden und Mitarbeiter:innen."
    )

    assert stats["words"] == 9
    assert stats["neutral_terms"] == 1
    assert stats["inclusive_forms"] == 1
    assert stats["potential_masculine_generics"] == 2
    assert stats["gender_relevant_mentions"] == 4


def test_calculate_score_breakdown_explains_weighted_score():
    stats = calculate_local_statistics(
        "Liebe Mitarbeiterinnen und Mitarbeiter, alle Teilnehmenden erhalten Informationen."
    )

    breakdown = calculate_score_breakdown(stats, {"score": 88})

    assert stats["paired_forms"] == 1
    assert stats["potential_masculine_generics"] == 0
    assert breakdown["score"] >= 70
    assert len(breakdown["components"]) == 4
    assert sum(component["weight"] for component in breakdown["components"]) == 100
    assert breakdown["methodology"]["formula"].startswith("Gesamtwertung")


def test_calculate_local_statistics_returns_markable_positions():
    stats = calculate_local_statistics("Jeder Fahrer prüft sein Fahrzeug.")

    assert stats["potential_masculine_terms"][0]["term"] == "Fahrer"
    assert stats["potential_masculine_terms"][0]["position"] == 6
    assert stats["masculine_pronoun_terms"][0]["term"] == "Jeder"
    assert stats["masculine_pronoun_terms"][0]["position"] == 0


def test_extract_response_text_prefers_top_level_output_text():
    assert extract_response_text({"output_text": '{"ok": true}'}) == '{"ok": true}'


def test_extract_response_text_reads_response_output_items():
    payload = {
        "output": [
            {
                "content": [
                    {"type": "output_text", "text": '{"score": 90}'},
                ]
            }
        ]
    }

    assert extract_response_text(payload) == '{"score": 90}'


def test_parse_model_json_accepts_fenced_json():
    parsed = parse_model_json("```json\n" + json.dumps({"score": 91}) + "\n```")

    assert parsed["score"] == 91
