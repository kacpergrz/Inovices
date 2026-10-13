// Testy weryfikacyjne dla nowoczesnego designu mobilnego (RWD) panelu faktur
const fs = require("fs");
const assert = require("assert");

console.log("Rozpoczynam testy weryfikacyjne dla designu mobilnego (RWD)...");

const html = fs.readFileSync("index.html", "utf-8");
const css = fs.readFileSync("style.css", "utf-8");
const js = fs.readFileSync("app.js", "utf-8");

// 1. Weryfikacja struktury nagłówka i nawigacji
assert(html.includes('class="header-top"'), "HTML musi zawierać header-top dla zoptymalizowanego nagłówka");
assert(html.includes('class="btn btn-logout'), "HTML musi zawierać subtelny przycisk wylogowania w header-top");
assert(html.includes('class="nav-scroll-container"'), "HTML musi zawierać nav-scroll-container dla poziomo przewijanej nawigacji");
assert(css.includes(".nav-scroll-container::after"), "CSS musi generować cień informujący o możliwości przewijania nawigacji");
assert(css.includes(".main-nav::-webkit-scrollbar"), "CSS musi ukrywać suwak nawigacji mobilnej");
console.log("✓ Test 1: Górny pasek i przewijana poziomo nawigacja zoptymalizowane pod kątem pionowej przestrzeni");

// 2. Weryfikacja sekcji wyszukiwania i filtrów
assert(html.includes('class="search-input-wrapper"'), "HTML musi zawierać search-input-wrapper");
assert(html.includes('class="search-icon"'), "HTML musi zawierać wektorową ikonę lupy SVG w polu wyszukiwania");
assert(html.includes('class="filters-grid"'), "HTML musi zawierać filters-grid dla zgrupowanych selectów");
assert(html.includes('class="filter-box filter-box-sort"'), "HTML musi zawierać klasę filter-box-sort");
assert(css.includes(".filters-grid"), "CSS musi stylizować siatkę filtrów");
console.log("✓ Test 2: Nowoczesne pole wyszukiwania z lupą i 2-kolumnowy układ filtrów obecne");

// 3. Weryfikacja przycisków akcji
assert(html.includes('class="toolbar-actions"'), "HTML musi zawierać kontener przycisków toolbar-actions");
assert(html.includes('btn-add-invoice'), "HTML musi zawierać przycisk primary btn-add-invoice");
assert(html.includes('btn-ksef'), "HTML musi zawierać przycisk secondary btn-ksef");
assert(css.includes(".btn-add-invoice"), "CSS musi zawierać reguły dla przycisku primary");
assert(css.includes(".btn-ksef"), "CSS musi zawierać reguły dla przycisku secondary");
console.log("✓ Test 3: Przyciski akcji (primary + Dodaj fakturę oraz secondary Pobierz z KSeF) skonfigurowane");

// 4. Weryfikacja karty faktury na mobile (Invoice Card)
assert(js.includes('class="col-number"'), "app.js musi nadawać klasę col-number");
assert(js.includes('class="inv-number-title"'), "app.js musi wyróżniać numer faktury jako nagłówek karty");
assert(js.includes('class="ksef-pill"'), "app.js musi stylizować numer KSeF jako małą pastylkę badge");
assert(js.includes('class="seller-nip-sub"'), "app.js musi umieszczać NIP pod nazwą sprzedawcy");
assert(js.includes('class="cal-mini-icon"'), "app.js musi renderować ikony kalendarza przy datach");
assert(js.includes('class="amount-sublabel"'), "app.js musi zawierać etykiety Netto/Brutto w sekcji finansowej");
assert(js.includes('class="gross-amount-val"'), "app.js musi zawierać dedykowaną klasę dla kwoty brutto");

assert(css.includes("#invoices-table tbody tr"), "CSS musi zawierać specjalną siatkę karty dla #invoices-table na mobile");
assert(css.includes(".gross-amount-val"), "CSS musi wyróżniać kwotę brutto większym, pogrubionym fontem");
console.log("✓ Test 4: Architektura karty faktury (nagłówek, pastylka KSeF, NIP, daty z kalendarzem, 2-kolumnowa sekcja finansowa) potwierdzona");

// 5. Weryfikacja spójności palety i zaokrągleń
assert(css.includes("--radius: 10px;"), "CSS musi stosować nowoczesne zaokrąglenie 10px");
assert(css.includes("--color-bg: #f8fafc;"), "CSS musi stosować chłodne tło slate");
console.log("✓ Test 5: Spójna paleta kolorów i zaokrągleń zweryfikowana");

console.log("\nWSZYSTKIE TESTY WERYFIKACYJNE RWD ZAKOŃCZONE SUKCESEM!");
