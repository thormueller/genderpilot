const form = document.querySelector("#analysisForm");
const sourceText = document.querySelector("#sourceText");
const sourceHighlights = document.querySelector("#sourceHighlights");
const lineNumbers = document.querySelector("#lineNumbers");
const textMeta = document.querySelector("#textMeta");
const fileOpenButton = document.querySelector("#fileOpenButton");
const fileSaveButton = document.querySelector("#fileSaveButton");
const applyOptimizedButton = document.querySelector("#applyOptimizedButton");
const fileInput = document.querySelector("#fileInput");
const apiStatus = document.querySelector("#apiStatus");
const analyzeButton = document.querySelector("#analyzeButton");
const trafficScore = document.querySelector("#trafficScore");
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
let activeHighlightRanges = [];
let lineMeasureContext = null;
let sourceResizeObserver = null;

const sampleText =
  "Alle Mitarbeiter und Kunden werden gebeten, ihre Unterlagen an den zuständigen Ansprechpartner zu senden. Die Teilnehmer erhalten anschließend weitere Informationen.";

sourceText.value = sampleText;
updateTextMeta();
renderSourceHighlights();
checkApiHealth();

if ("ResizeObserver" in window) {
  sourceResizeObserver = new ResizeObserver(() => renderLineNumbers());
  sourceResizeObserver.observe(sourceText);
}
window.addEventListener("resize", renderLineNumbers);

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.tab}Panel`).classList.add("active");
  });
});

sourceText.addEventListener("input", () => {
  updateTextMeta();
  activeHighlightRanges = [];
  applyOptimizedButton.disabled = true;
  renderSourceHighlights();
});
sourceText.addEventListener("scroll", syncEditorScroll);
fileOpenButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", handleFileOpen);
fileSaveButton.addEventListener("click", handleFileSave);
applyOptimizedButton.addEventListener("click", applyOptimizedText);

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
  if (sourceText.value !== text) {
    sourceText.value = text;
    updateTextMeta();
    activeHighlightRanges = [];
    renderSourceHighlights();
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
  renderLineNumbers();
}

function renderLineNumbers() {
  const lineHeight = getEditorLineHeight();
  const visualLineCount = countVisualLines(sourceText.value);
  lineNumbers.style.setProperty("--editor-line-height", `${lineHeight}px`);
  lineNumbers.innerHTML = Array.from(
    { length: Math.max(1, visualLineCount) },
    (_, index) => `<span>${index + 1}</span>`,
  ).join("");
  syncEditorScroll();
}

function syncEditorScroll() {
  lineNumbers.scrollTop = sourceText.scrollTop;
  sourceHighlights.style.transform = `translateY(-${sourceText.scrollTop}px)`;
}

function countVisualLines(text) {
  const computed = window.getComputedStyle(sourceText);
  const availableWidth =
    sourceText.clientWidth - parseFloat(computed.paddingLeft) - parseFloat(computed.paddingRight);
  const width = Math.max(1, availableWidth);

  return text.split("\n").reduce((total, line) => total + countWrappedRows(line, width, computed), 0);
}

function countWrappedRows(line, width, computed) {
  if (!line) {
    return 1;
  }

  const context = getLineMeasureContext(computed);
  let rows = 1;
  let currentWidth = 0;
  const tokens = line.match(/\S+\s*|\s+/g) || [line];

  tokens.forEach((token) => {
    const tokenWidth = context.measureText(token).width;
    if (tokenWidth <= width) {
      if (currentWidth > 0 && currentWidth + tokenWidth > width) {
        rows += 1;
        currentWidth = tokenWidth;
      } else {
        currentWidth += tokenWidth;
      }
      return;
    }

    for (const character of token) {
      const characterWidth = context.measureText(character).width;
      if (currentWidth > 0 && currentWidth + characterWidth > width) {
        rows += 1;
        currentWidth = characterWidth;
      } else {
        currentWidth += characterWidth;
      }
    }
  });

  return rows;
}

function getLineMeasureContext(computed) {
  if (!lineMeasureContext) {
    lineMeasureContext = document.createElement("canvas").getContext("2d");
  }
  lineMeasureContext.font = computed.font;
  return lineMeasureContext;
}

function getEditorLineHeight() {
  const computed = window.getComputedStyle(sourceText);
  const parsed = parseFloat(computed.lineHeight);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return parseFloat(computed.fontSize) * 1.5;
}

async function handleFileOpen() {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) {
    return;
  }

  setStatus("Öffnet", "pending");
  try {
    const text = await readTextFromFile(file);
    const maxLength = Number(sourceText.maxLength || 0) || 20000;
    const nextText = text.length > maxLength ? text.slice(0, maxLength) : text;
    setEditorText(nextText);
    setStatus(text.length > maxLength ? "Gekürzt" : "Geöffnet", text.length > maxLength ? "pending" : "ok");
    if (text.length > maxLength) {
      summaryText.textContent = `Die Datei wurde auf ${maxLength.toLocaleString("de-DE")} Zeichen gekürzt.`;
    }
  } catch (error) {
    setStatus("Fehler", "error");
    summaryText.textContent = error.message;
  }
}

async function handleFileSave() {
  const text = sourceText.value;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const suggestedName = "genderpilot-text.txt";

  try {
    if ("showSaveFilePicker" in window) {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: "Plaintext",
            accept: { "text/plain": [".txt"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus("Gesichert", "ok");
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = suggestedName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("Gesichert", "ok");
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("Bereit", "ok");
      return;
    }
    setStatus("Fehler", "error");
    summaryText.textContent = error.message;
  }
}

async function readTextFromFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (["txt", "text", "md"].includes(extension) || file.type.startsWith("text/")) {
    return file.text();
  }
  if (extension === "docx") {
    return extractDocxText(await file.arrayBuffer());
  }
  throw new Error("Unterstützt werden Plaintext-Dateien und Word-Dateien im DOCX-Format.");
}

function setEditorText(text) {
  sourceText.value = text;
  activeHighlightRanges = [];
  applyOptimizedButton.disabled = true;
  updateTextMeta();
  renderSourceHighlights();
  sourceText.focus();
}

function applyOptimizedText() {
  const optimized = improvedText.value.trim();
  if (!optimized) {
    setStatus("Keine Optimierung", "error");
    summaryText.textContent = "Es liegt noch kein optimierter Text vor.";
    return;
  }

  setEditorText(optimized);
  setStatus("Übernommen", "ok");
}

async function extractDocxText(arrayBuffer) {
  const entry = findZipEntry(arrayBuffer, "word/document.xml");
  if (!entry) {
    throw new Error("Die Word-Datei enthält keinen lesbaren Dokumenttext.");
  }

  const xmlBuffer = await readZipEntry(arrayBuffer, entry);
  const xml = new TextDecoder("utf-8").decode(xmlBuffer);
  const documentXml = new DOMParser().parseFromString(xml, "application/xml");
  if (documentXml.querySelector("parsererror")) {
    throw new Error("Der Dokumenttext der Word-Datei konnte nicht gelesen werden.");
  }

  const paragraphs = Array.from(documentXml.getElementsByTagNameNS("*", "p"))
    .map((paragraph) => extractWordParagraphText(paragraph))
    .filter((paragraph) => paragraph.trim().length > 0);

  return paragraphs.join("\n\n").trim();
}

function findZipEntry(arrayBuffer, wantedName) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset < 0) {
    throw new Error("Die Word-Datei konnte nicht als DOCX-Zip gelesen werden.");
  }

  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const centralDirectoryEntries = view.getUint16(eocdOffset + 10, true);
  let offset = centralDirectoryOffset;

  for (let index = 0; index < centralDirectoryEntries; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      break;
    }

    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const fileName = new TextDecoder("utf-8").decode(bytes.slice(offset + 46, offset + 46 + fileNameLength));

    if (fileName === wantedName) {
      return { compression, compressedSize, localHeaderOffset };
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return null;
}

function findEndOfCentralDirectory(view) {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }
  return -1;
}

async function readZipEntry(arrayBuffer, entry) {
  const view = new DataView(arrayBuffer);
  if (view.getUint32(entry.localHeaderOffset, true) !== 0x04034b50) {
    throw new Error("Der DOCX-Inhalt ist beschädigt.");
  }

  const fileNameLength = view.getUint16(entry.localHeaderOffset + 26, true);
  const extraLength = view.getUint16(entry.localHeaderOffset + 28, true);
  const dataStart = entry.localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressedBytes = new Uint8Array(arrayBuffer, dataStart, entry.compressedSize);

  if (entry.compression === 0) {
    return compressedBytes.buffer.slice(compressedBytes.byteOffset, compressedBytes.byteOffset + compressedBytes.byteLength);
  }
  if (entry.compression === 8) {
    return inflateRaw(compressedBytes);
  }

  throw new Error("Die Word-Datei nutzt eine nicht unterstützte DOCX-Kompression.");
}

async function inflateRaw(bytes) {
  if (!("DecompressionStream" in window)) {
    throw new Error("Dieser Browser kann DOCX-Dateien nicht direkt entpacken. Bitte als TXT speichern oder einen aktuellen Chromium-Browser nutzen.");
  }

  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).arrayBuffer();
  } catch (error) {
    throw new Error("Die DOCX-Datei konnte nicht entpackt werden. Bitte als TXT speichern und erneut öffnen.");
  }
}

function extractWordParagraphText(paragraph) {
  const chunks = [];
  collectWordText(paragraph, chunks);
  return chunks.join("").replace(/\u00a0/g, " ");
}

function collectWordText(node, chunks) {
  if (node.nodeType === Node.ELEMENT_NODE) {
    if (node.localName === "t") {
      chunks.push(node.textContent || "");
      return;
    }
    if (node.localName === "tab") {
      chunks.push("\t");
      return;
    }
    if (node.localName === "br" || node.localName === "cr") {
      chunks.push("\n");
      return;
    }
  }

  node.childNodes.forEach((child) => collectWordText(child, chunks));
}

function renderResult(payload) {
  const analysis = payload.analysis;
  const local = payload.local_statistics;
  const breakdown = payload.score_breakdown || {};
  const score = Number(breakdown.score ?? analysis.score ?? 0);
  currentMethodology = breakdown.methodology || null;

  scoreValue.textContent = score;
  trafficScore.dataset.state = trafficState(score);
  ratingTitle.textContent = formatRating(breakdown.rating || analysis.rating || "Analyse");
  summaryText.textContent = analysis.summary || "Keine Zusammenfassung vorhanden.";

  statsGrid.innerHTML = [
    stat("Wörter", local.words),
    stat("Personenbezüge", local.gender_relevant_mentions || 0),
    stat("Maskulina je 100 Wörter", breakdown.densities?.masculine_generics_per_100_words ?? local.masculine_density_per_100_words ?? 0),
    stat("Aussagekraft", breakdown.sample_reliability?.level || "--"),
  ].join("");

  renderScoreBreakdown(breakdown);
  activeHighlightRanges = buildHighlightRanges(local, analysis.findings || [], sourceText.value);
  renderSourceHighlights();
  renderFindings(analysis.findings || []);
  renderAlternatives(analysis.alternatives || []);
  improvedText.value = analysis.improved_text || "";
  applyOptimizedButton.disabled = !improvedText.value.trim();
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

function buildHighlightRanges(local, findings, text) {
  const ranges = [];
  const addRange = (start, length, kind, title) => {
    const safeStart = Number(start);
    const safeLength = Number(length);
    if (!Number.isFinite(safeStart) || !Number.isFinite(safeLength) || safeLength <= 0) {
      return;
    }
    if (safeStart < 0 || safeStart >= text.length) {
      return;
    }
    ranges.push({
      start: safeStart,
      end: Math.min(text.length, safeStart + safeLength),
      kind,
      title,
    });
  };

  (local.potential_masculine_terms || []).forEach((item) => {
    addRange(item.position, String(item.term || "").length, "term", item.suggestion || "kritische Personenbezeichnung");
  });

  (local.masculine_pronoun_terms || []).forEach((item) => {
    addRange(item.position, String(item.term || "").length, "pronoun", item.suggestion || "kritischer Pronomenbezug");
  });

  (findings || []).forEach((finding) => {
    const excerpt = String(finding.excerpt || "").trim();
    if (!excerpt || excerpt.length < 3 || excerpt.length > 140) {
      return;
    }
    const index = text.indexOf(excerpt);
    if (index >= 0) {
      addRange(index, excerpt.length, "finding", finding.suggestion || finding.explanation || "kritischer Befund");
    }
  });

  return ranges
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .reduce((accepted, range) => {
      const previous = accepted.at(-1);
      if (!previous || range.start >= previous.end) {
        accepted.push(range);
      }
      return accepted;
    }, []);
}

function renderSourceHighlights() {
  const text = sourceText.value;
  if (!activeHighlightRanges.length) {
    sourceHighlights.innerHTML = escapeHtml(text) || " ";
    syncEditorScroll();
    return;
  }

  let cursor = 0;
  const chunks = [];
  activeHighlightRanges.forEach((range) => {
    chunks.push(escapeHtml(text.slice(cursor, range.start)));
    chunks.push(
      `<mark class="highlight-${escapeHtml(range.kind)}" title="${escapeHtml(range.title)}">${escapeHtml(
        text.slice(range.start, range.end),
      )}</mark>`,
    );
    cursor = range.end;
  });
  chunks.push(escapeHtml(text.slice(cursor)) || " ");
  sourceHighlights.innerHTML = chunks.join("");
  syncEditorScroll();
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

function trafficState(score) {
  if (score >= 75) return "green";
  if (score >= 45) return "yellow";
  return "red";
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
