const form = document.querySelector("#analysisForm");
const sourceText = document.querySelector("#sourceText");
const textMeta = document.querySelector("#textMeta");
const apiStatus = document.querySelector("#apiStatus");
const analyzeButton = document.querySelector("#analyzeButton");
const scoreRing = document.querySelector("#scoreRing");
const scoreValue = document.querySelector("#scoreValue");
const ratingTitle = document.querySelector("#ratingTitle");
const summaryText = document.querySelector("#summaryText");
const statsGrid = document.querySelector("#statsGrid");
const findingsPanel = document.querySelector("#findingsPanel");
const alternativesPanel = document.querySelector("#alternativesPanel");
const improvedText = document.querySelector("#improvedText");

const sampleText =
  "Alle Mitarbeiter und Kunden werden gebeten, ihre Unterlagen an den zuständigen Ansprechpartner zu senden. Die Teilnehmer erhalten anschließend weitere Informationen.";

sourceText.value = sampleText;
updateTextMeta();
checkApiHealth();

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.tab}Panel`).classList.add("active");
  });
});

sourceText.addEventListener("input", updateTextMeta);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = sourceText.value.trim();
  if (!text) {
    setStatus("Text fehlt", "error");
    return;
  }

  setLoading(true);
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        mode: document.querySelector("#mode").value,
        audience: document.querySelector("#audience").value.trim() || "allgemein",
      }),
    });

    const payload = await readJsonResponse(response, "Analyse");
    if (!response.ok) {
      throw new Error(payload.detail || "Analyse fehlgeschlagen");
    }

    renderResult(payload);
    setStatus("Analysiert", "ok");
  } catch (error) {
    setStatus("Fehler", "error");
    summaryText.textContent = error.message;
  } finally {
    setLoading(false);
  }
});

async function checkApiHealth() {
  try {
    const response = await fetch("/api/health", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await readJsonResponse(response, "API-Status");
    if (!response.ok || payload.ok !== true) {
      throw new Error(payload.detail || "API-Status konnte nicht bestätigt werden.");
    }
    setStatus("API bereit", "ok");
  } catch (error) {
    setStatus("API Fehler", "error");
    summaryText.textContent = error.message;
  }
}

async function readJsonResponse(response, context) {
  const contentType = response.headers.get("content-type") || "";
  const bodyText = await response.text();

  if (!bodyText.trim()) {
    if (response.ok) {
      return {};
    }
    throw new Error(`${context}: leere Antwort von ${response.url} (${response.status}).`);
  }

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(bodyText);
    } catch {
      throw new Error(`${context}: Die API-Antwort ist kein gültiges JSON.`);
    }
  }

  if (bodyText.trimStart().startsWith("<!DOCTYPE") || bodyText.trimStart().startsWith("<html")) {
    throw new Error(
      `${context}: /api liefert HTML statt JSON. Prüfe, ob Cloudflare wirklich mit "npm run deploy" und pywrangler deployed wurde.`,
    );
  }

  throw new Error(`${context}: Unerwartete Antwort von ${response.url} (${response.status}).`);
}

function updateTextMeta() {
  const words = countWords(sourceText.value);
  textMeta.textContent = `${words} ${words === 1 ? "Wort" : "Wörter"}`;
}

function renderResult(payload) {
  const analysis = payload.analysis;
  const local = payload.local_statistics;
  const score = Number(analysis.score || 0);

  scoreValue.textContent = score;
  scoreRing.style.background = `radial-gradient(circle at center, #ffffff 58%, transparent 59%), conic-gradient(${scoreColor(score)} ${score * 3.6}deg, var(--line) 0deg)`;
  ratingTitle.textContent = analysis.rating || "Analyse";
  summaryText.textContent = analysis.summary || "Keine Zusammenfassung vorhanden.";

  statsGrid.innerHTML = [
    stat("Wörter", local.words),
    stat("Hinweise", analysis.findings?.length || 0),
    stat("Neutrale Formen", local.neutral_terms),
    stat("Inklusive Formen", local.inclusive_forms + local.paired_forms),
  ].join("");

  renderFindings(analysis.findings || []);
  renderAlternatives(analysis.alternatives || []);
  improvedText.value = analysis.improved_text || "";
}

function renderFindings(findings) {
  if (!findings.length) {
    findingsPanel.innerHTML = '<div class="empty-state">Keine kritischen Befunde.</div>';
    return;
  }

  findingsPanel.innerHTML = findings
    .map(
      (finding) => `
        <article class="finding">
          <div class="finding-head">
            <strong>${escapeHtml(labelForCategory(finding.category))}</strong>
            <span class="badge severity-${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span>
          </div>
          <div class="excerpt">${escapeHtml(finding.excerpt || "Ohne Textauszug")}</div>
          <p>${escapeHtml(finding.explanation || "")}</p>
          <p><strong>Vorschlag:</strong> ${escapeHtml(finding.suggestion || "")}</p>
        </article>
      `,
    )
    .join("");
}

function renderAlternatives(alternatives) {
  if (!alternatives.length) {
    alternativesPanel.innerHTML = '<div class="empty-state">Keine Alternativen vorgeschlagen.</div>';
    return;
  }

  alternativesPanel.innerHTML = alternatives
    .map(
      (item) => `
        <article class="alternative">
          <strong>${escapeHtml(item.original || "Ausdruck")}</strong>
          <div class="alternative-grid">
            <div><span>Neutral</span>${escapeHtml(item.neutral || "")}</div>
            <div><span>Paarform</span>${escapeHtml(item.paired || "")}</div>
            <div><span>Kompakt</span>${escapeHtml(item.compact || "")}</div>
          </div>
          <p>${escapeHtml(item.rationale || "")}</p>
        </article>
      `,
    )
    .join("");
}

function stat(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${Number(value || 0)}</strong></div>`;
}

function countWords(value) {
  return (
    value.trim().match(/[A-Za-zÄÖÜäöüß]+(?:[:*_][A-Za-zÄÖÜäöüß]+)?(?:[-'][A-Za-zÄÖÜäöüß]+)*/g) ||
    []
  ).length;
}

function setLoading(isLoading) {
  analyzeButton.disabled = isLoading;
  analyzeButton.textContent = isLoading ? "Prüfe..." : "Analysieren";
  if (isLoading) {
    setStatus("Prüft", "pending");
  }
}

function setStatus(text, state) {
  apiStatus.textContent = text;
  apiStatus.dataset.state = state;
}

function scoreColor(score) {
  if (score >= 80) return "var(--green)";
  if (score >= 55) return "var(--accent)";
  if (score >= 35) return "var(--amber)";
  return "var(--red)";
}

function labelForCategory(category) {
  const labels = {
    generisches_maskulinum: "Generisches Maskulinum",
    inkonsistenz: "Inkonsistenz",
    ansprache: "Ansprache",
    lesbarkeit: "Lesbarkeit",
    neutralitaet: "Neutralität",
    sonstiges: "Sonstiges",
  };
  return labels[category] || category || "Befund";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
