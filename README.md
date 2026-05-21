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

Wichtig: Dieses Projekt ist ein **Cloudflare Worker mit Static Assets**, keine klassische
Cloudflare-Pages-App. In Cloudflare CI/CD sollte der Deploy-Befehl deshalb `uv run
pywrangler deploy` sein. Ein reines `pip install .` baut nur die Python-Abhängigkeiten,
veröffentlicht aber keinen Python Worker.

Den API-Key in Cloudflare als Secret hinterlegen:

```powershell
npx wrangler secret put OPENAI_API_KEY
```

Das Modell ist in `wrangler.toml` über `OPENAI_MODEL` konfigurierbar.
