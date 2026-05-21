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
const componentList = document.querySelector("#componentList");
const reliabilityNote = document.querySelector("#reliabilityNote");
const scoreFormula = document.querySelector("#scoreFormula");
const methodButton = document.querySelector("#methodButton");
const methodDialog = document.querySelector("#methodDialog");
const methodClose = document.querySelector("#methodClose");
const methodContent = document.querySelector("#methodContent");
let currentMethodology = null;

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

methodButton.addEventListener("click", () => {
  renderMethodology();
  methodDialog.hidden = false;
  methodClose.focus();
});

methodClose.addEventListener("click", closeMethodDialog);
methodDialog.addEventListener("click", (event) => {
  if (event.target === methodDialog) {
    closeMethodDialog();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !methodDialog.hidden) {
    closeMethodDialog();
  }
});

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
  const breakdown = payload.score_breakdown || {};
  const score = Number(breakdown.score ?? analysis.score ?? 0);
  currentMethodology = breakdown.methodology || null;

  scoreValue.textContent = score;
  scoreRing.style.background = `radial-gradient(circle at center, #ffffff 58%, transparent 59%), conic-gradient(${scoreColor(score)} ${score * 3.6}deg, var(--line) 0deg)`;
  ratingTitle.textContent = formatRating(breakdown.rating || analysis.rating || "Analyse");
  summaryText.textContent = analysis.summary || "Keine Zusammenfassung vorhanden.";

  statsGrid.innerHTML = [
    stat("Wörter", local.words),
    stat("Personenbezüge", local.gender_relevant_mentions || 0),
    stat("Maskulina je 100 Wörter", breakdown.densities?.masculine_generics_per_100_words ?? local.masculine_density_per_100_words ?? 0),
    stat("Aussagekraft", breakdown.sample_reliability?.level || "--"),
  ].join("");

  renderScoreBreakdown(breakdown);
  renderFindings(analysis.findings || []);
  renderAlternatives(analysis.alternatives || []);
  improvedText.value = analysis.improved_text || "";
}

function renderScoreBreakdown(breakdown) {
  const components = breakdown.components || [];
  if (!components.length) {
    componentList.innerHTML = '<div class="empty-metrics">Noch keine Kennzahlen berechnet.</div>';
    reliabilityNote.textContent =
      "Die Aussagekraft wird nach Textlänge und erkannten Personenbezügen eingeordnet.";
    scoreFormula.textContent = "30 / 30 / 20 / 20";
    return;
  }

  scoreFormula.textContent = components.map((component) => `${component.weight}%`).join(" / ");
  componentList.innerHTML = components
    .map((component) => {
      const score = Number(component.score || 0);
      const weightedContribution = Math.round((score * Number(component.weight || 0)) / 100);
      return `
        <article class="component">
          <div class="component-top">
            <strong>${escapeHtml(component.label)}</strong>
            <span>${score.toFixed(1)} / 100</span>
          </div>
          <div class="component-meta">
            <span>Gewicht ${Number(component.weight || 0)}%</span>
            <span>Beitrag ${weightedContribution} Punkte</span>
            <span>Wert ${escapeHtml(component.value ?? "--")}</span>
          </div>
          <div class="component-bar" aria-hidden="true">
            <span style="width: ${Math.max(0, Math.min(100, score))}%"></span>
          </div>
          <p>${escapeHtml(component.description || "")}</p>
        </article>
      `;
    })
    .join("");

  const reliability = breakdown.sample_reliability;
  reliabilityNote.textContent = reliability
    ? `Aussagekraft ${reliability.level}: ${reliability.description}`
    : "Die Aussagekraft wird nach Textlänge und erkannten Personenbezügen eingeordnet.";
}

function renderMethodology() {
  const methodology = currentMethodology || {
    formula:
      "Gesamtwertung = 30% inklusive Sichtbarkeit + 30% Vermeidung generischer Maskulina + 20% Pronomenbezug + 20% Strategiekonsistenz.",
    scale:
      "Alle Teilwerte liegen auf einer Skala von 0 bis 100. Höhere Werte bedeuten eine gendergerechtere Ausprägung.",
    limitations:
      "Die Kennzahlen sind heuristische Indikatoren. Kontext, Zitate, Fachtermini und intendierte Zielgruppen müssen qualitativ mitgeprüft werden.",
  };

  methodContent.innerHTML = `
    <p>${escapeHtml(methodology.formula)}</p>
    <p>${escapeHtml(methodology.scale)}</p>
    <p>${escapeHtml(methodology.limitations)}</p>
    <dl class="method-list">
      <div><dt>Inklusive Sichtbarkeit</dt><dd>Anteil neutraler, inklusiver oder ausgeschriebener Formen an den erkannten Personenbezeichnungen.</dd></div>
      <div><dt>Generisches Maskulinum</dt><dd>Reduziert den Score bei hoher Dichte potenziell generischer Maskulina pro 100 Wörter.</dd></div>
      <div><dt>Pronomenbezug</dt><dd>Erfasst maskulin geprägte generische Pronomen wie „er“, „sein“ oder „jeder“.</dd></div>
      <div><dt>Strategiekonsistenz</dt><dd>Bewertet, ob der Text eine erkennbare Genderstrategie durchhält.</dd></div>
    </dl>
  `;
}

function closeMethodDialog() {
  methodDialog.hidden = true;
  methodButton.focus();
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
  const displayValue = typeof value === "number" ? Number(value || 0).toLocaleString("de-DE") : value;
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(displayValue ?? 0)}</strong></div>`;
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
  if (score >= 80) return "var(--blue-strong)";
  if (score >= 55) return "var(--accent)";
  if (score >= 35) return "var(--amber)";
  return "var(--red)";
}

function formatRating(value) {
  const text = String(value || "Analyse");
  return text.charAt(0).toUpperCase() + text.slice(1);
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
