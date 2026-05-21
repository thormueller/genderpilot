# Genderpilot

Applikation zur Bewertung und Optimierung der Gendergerechtigkeit deutscher Texte.

## Architektur

- `public/`: Browser-GUI mit Texteditor, Statistik, Befunden und Optimierungstext.
- `src/worker.py`: Cloudflare Python Worker mit FastAPI-Endpoint `/api/analyze`.
- `src/analysis_utils.py`: lokale, deterministische Vorstatistik für deutsche Textsignale.
- OpenAI Responses API: strukturierte Analyse und Verbesserungsvorschläge als JSON.

## Lokal starten

Voraussetzungen: `uv`, Node.js und Cloudflare Wrangler/Pywrangler.

```powershell
Copy-Item .dev.vars.example .dev.vars
```

Danach in `.dev.vars` den OpenAI API-Key setzen.

```powershell
uv run pywrangler dev
```

## Deploy

```powershell
uv run pywrangler deploy
```

Den API-Key in Cloudflare als Secret hinterlegen:

```powershell
npx wrangler secret put OPENAI_API_KEY
```

Das Modell ist in `wrangler.toml` über `OPENAI_MODEL` konfigurierbar.
