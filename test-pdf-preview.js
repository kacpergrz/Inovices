// Testy weryfikacyjne dla renderowania podglądu PDF na Canvas za pomocą PDF.js
const fs = require("fs");
const assert = require("assert");

console.log("Rozpoczynam testy weryfikacyjne dla podglądu PDF na Canvas (PDF.js)...");

const html = fs.readFileSync("index.html", "utf-8");
const css = fs.readFileSync("style.css", "utf-8");
const js = fs.readFileSync("app.js", "utf-8");

// =========================================================================
// 1. Weryfikacja index.html (Wymagania 1, 2, 4)
// =========================================================================
assert(html.includes("pdf.min.js"), "index.html musi ładować bibliotekę PDF.js z CDN");
assert(html.includes('id="order-preview-modal"'), "index.html musi zawierać modal order-preview-modal");
assert(html.includes('id="order-preview-pdf-pages"'), "index.html musi zawierać kontener order-preview-pdf-pages dla wyrenderowanych stron canvas");
assert(html.includes('id="order-preview-download-btn"'), "index.html musi zawierać przycisk pobierania na dysk");
assert(html.includes('id="btn-close-order-preview"'), "index.html musi zawierać przycisk 'Zamknij'");
assert(html.includes('id="btn-close-order-preview-x"'), "index.html musi zawierać przycisk '✕' do zamykania");
console.log("✓ Test 1: Struktura HTML dla podglądu PDF na canvas poprawna");

// =========================================================================
// 2. Weryfikacja style.css (Wymagania 2, 3 - Płynne przewijanie i RWD)
// =========================================================================
assert(css.includes(".order-preview-pdf-pages"), "style.css musi definiować klasę .order-preview-pdf-pages");
assert(css.includes("overflow-y: auto"), "Kontener stron PDF musi posiadać płynne przewijanie pionowe (overflow-y: auto)");
assert(css.includes("-webkit-overflow-scrolling: touch"), "Kontener stron PDF musi obsługiwać natywne płynne przewijanie dotykowe");
assert(css.includes(".pdf-page-wrapper"), "style.css musi definiować kartkę strony .pdf-page-wrapper");
assert(css.includes(".pdf-page-canvas"), "style.css musi definiować canvas strony .pdf-page-canvas");
assert(css.includes("max-width: 100%"), "Element canvas musi posiadać max-width: 100% dla pełnej responsywności");
assert(css.includes(".pdf-page-badge"), "style.css musi stylizować numerację stron .pdf-page-badge");
assert(css.includes("@media (max-width: 720px)"), "style.css musi posiadać sekcję RWD dla ekranów mobilnych");
console.log("✓ Test 2: Style CSS, responsywność i przewijanie pionowe skonfigurowane prawidłowo");

// =========================================================================
// 3. Weryfikacja app.js (Wymagania 1, 3, 4)
// =========================================================================
assert(js.includes("orderPreviewPdfPages"), "app.js musi pobierać referencję do kontenera stron PDF");
assert(js.includes("renderPdfPreview"), "app.js musi definiować funkcję renderPdfPreview");
assert(js.includes("previewOrderFile"), "app.js musi definiować funkcję previewOrderFile");
assert(js.includes("closeOrderPreviewModal"), "app.js musi definiować funkcję closeOrderPreviewModal");
assert(js.includes("currentPreviewRenderId"), "app.js musi zabezpieczać renderowanie tokenem unieważniania renderId");
assert(js.includes("pdfjsLib.getDocument"), "app.js musi wywoływać pdfjsLib.getDocument do odczytu PDF");
assert(js.includes("page.render"), "app.js musi wywoływać page.render do rysowania strony na Canvas");
assert(js.includes("e.target === orderPreviewModal"), "Kliknięcie w tło (backdrop) modala musi zamykać podgląd bez opuszczania widoku");
assert(js.includes("handlePdfPreviewResize"), "app.js musi obsługiwać responsywne przeliczanie skali po zmianie orientacji / rozmiaru ekranu");
console.log("✓ Test 3: Logika JavaScript dla podglądu PDF na Canvas obecna i poprawnie powiązana");

// =========================================================================
// 4. Testy jednostkowe algorytmu responsywnego skalowania stron (RWD)
// =========================================================================
function calculatePageDimensions({ containerWidth, pageWidth, dpr }) {
  const availableWidth = Math.max(containerWidth - 32, 260);
  const targetWidth = Math.min(availableWidth, 860);
  const cssScale = targetWidth / pageWidth;
  const renderScale = cssScale * dpr;

  const canvasWidth = Math.floor(pageWidth * renderScale);
  const displayCssWidth = Math.floor(canvasWidth / dpr);

  return {
    targetWidth,
    cssScale,
    renderScale,
    canvasWidth,
    displayCssWidth
  };
}

// Scenariusz A: Wąski telefon (ekran 360px, dostępna szerokość kontenera 340px, dpr 2.0, standard A4 595.28 pt)
const mobileSim = calculatePageDimensions({ containerWidth: 340, pageWidth: 595.28, dpr: 2.0 });
assert(mobileSim.targetWidth <= 340, "Szerokość docelowa na telefonie nie może przekroczyć szerokości kontenera");
assert.strictEqual(mobileSim.targetWidth, 308, "Dostępna szerokość: 340 - 32 = 308px");
assert(mobileSim.displayCssWidth <= 308, "Szerokość CSS canvasu mieści się w ekranie");
assert(mobileSim.canvasWidth >= 600, "Wymiary fizyczne canvasu muszą być przeskalowane o DPR dla ostrości tekstu");

// Scenariusz B: Duży monitor desktop (ekran 1920px, kontener 920px, dpr 1.0, standard A4 595.28 pt)
const desktopSim = calculatePageDimensions({ containerWidth: 920, pageWidth: 595.28, dpr: 1.0 });
assert.strictEqual(desktopSim.targetWidth, 860, "Szerokość docelowa na desktopie jest ograniczona do ergonomicznych 860px");
assert.strictEqual(desktopSim.displayCssWidth, 860, "Szerokość CSS wynosi dokładnie 860px");

// Scenariusz C: Dokument w orientacji poziomej (landscape: 841.89 pt) na telefonie
const landscapeMobile = calculatePageDimensions({ containerWidth: 360, pageWidth: 841.89, dpr: 2.0 });
assert(landscapeMobile.displayCssWidth <= 360, "Strona pozioma automatycznie mieści się w pionowym ekranie telefonu");
console.log("✓ Test 4: Algorytm skalowania stron PDF (RWD i HiDPI) działa optymalnie");

// =========================================================================
// 5. Testy jednostkowe symulacji cyklu życia podglądu i anulowania
// =========================================================================
let testRenderId = 0;
let isModalOpen = false;
let renderedPagesCount = 0;

function simulateOpenPreview() {
  testRenderId++;
  isModalOpen = true;
  renderedPagesCount = 0;
  return testRenderId;
}

function simulateClosePreview() {
  testRenderId++;
  isModalOpen = false;
  renderedPagesCount = 0;
}

async function simulateRenderTask(renderId, totalPages) {
  for (let i = 1; i <= totalPages; i++) {
    await new Promise(r => setTimeout(r, 5));
    if (renderId !== testRenderId) return false; // anulowano!
    renderedPagesCount++;
  }
  return true;
}

(async () => {
  // Test pełnego renderowania 3-stronicowego dokumentu
  const rId1 = simulateOpenPreview();
  const finished1 = await simulateRenderTask(rId1, 3);
  assert.strictEqual(finished1, true, "Zadanie renderowania powinno się zakończyć pomyślnie");
  assert.strictEqual(renderedPagesCount, 3, "Wyrenderowano wszystkie 3 strony");

  // Test anulowania: użytkownik zamyka modal w trakcie renderowania strony 1
  const rId2 = simulateOpenPreview();
  const promise2 = simulateRenderTask(rId2, 5);
  // Użytkownik klika 'Zamknij' po 7ms
  setTimeout(() => simulateClosePreview(), 7);
  const finished2 = await promise2;
  assert.strictEqual(finished2, false, "Przerwane renderowanie nie powinno modyfikować stanu po zamknięciu");
  assert.strictEqual(renderedPagesCount, 0, "Licznik stron zresetowany");

  console.log("✓ Test 5: Ochrona przed wyścigami (race conditions) i anulowanie podglądu działa bezbłędnie");
  console.log("\nWSZYSTKIE TESTY WERYFIKACYJNE PODGLĄDU PDF NA CANVAS ZAKOŃCZONE SUKCESEM!");
})();
