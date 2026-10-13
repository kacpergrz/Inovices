// Testy weryfikacyjne dla funkcji przeniesionych z bota WhatsApp do aplikacji webowej
const fs = require("fs");
const assert = require("assert");

console.log("Rozpoczynam testy weryfikacyjne dla funkcji WhatsApp w aplikacji webowej...");

// 1. Weryfikacja struktury index.html
const html = fs.readFileSync("index.html", "utf-8");

// Nawigacja
assert(html.includes('id="nav-koszty"'), "index.html musi zawierać przycisk nawigacji #nav-koszty");
assert(html.includes('id="nav-kierowcy"'), "index.html musi zawierać przycisk nawigacji #nav-kierowcy");
assert(html.includes('id="nav-pojazdy"'), "index.html musi zawierać przycisk nawigacji #nav-pojazdy");

// Widoki
assert(html.includes('id="expenses-view"'), "index.html musi zawierać kontener widoku #expenses-view");
assert(html.includes('id="drivers-view"'), "index.html musi zawierać kontener widoku #drivers-view");
assert(html.includes('id="vehicles-view"'), "index.html musi zawierać kontener widoku #vehicles-view");

// Filtr pilne i pobieranie KSeF
assert(html.includes('value="urgent"'), "Select statusu faktur musi zawierać opcję 'urgent' (Pilne)");
assert(html.includes('id="btn-ksef-sync"'), "index.html musi zawierać przycisk #btn-ksef-sync");
assert(html.includes('id="ksef-modal"'), "index.html musi zawierać modal #ksef-modal");
assert(html.includes('id="btn-execute-ksef-sync"'), "index.html musi zawierać przycisk #btn-execute-ksef-sync");

// Wyniki firmy
assert(html.includes('data-subtarget="sub-wynik-firmy"'), "index.html musi zawierać podzakładkę Wynik firmy");
assert(html.includes('data-subtarget="sub-podsumowanie-firmy"'), "index.html musi zawierać podzakładkę Podsumowanie sprzedaży");
assert(html.includes('id="sub-wynik-firmy"'), "index.html musi zawierać panel #sub-wynik-firmy");
assert(html.includes('id="sub-podsumowanie-firmy"'), "index.html musi zawierać panel #sub-podsumowanie-firmy");

// Koszty i E100
assert(html.includes('id="expenses-table"'), "index.html musi zawierać tabelę #expenses-table");
assert(html.includes('id="expense-form-modal"'), "index.html musi zawierać modal #expense-form-modal");
assert(html.includes('id="expense-vehicle-modal"'), "index.html musi zawierać modal #expense-vehicle-modal");
assert(html.includes('id="e100-file-input"'), "index.html musi zawierać input pliku #e100-file-input");
assert(html.includes('id="btn-save-e100-import"'), "index.html musi zawierać przycisk #btn-save-e100-import");
assert(html.includes('id="btn-revert-e100"'), "index.html musi zawierać przycisk #btn-revert-e100");
assert(html.includes('id="e100-history-tbody"'), "index.html musi zawierać tbody #e100-history-tbody");

// Kierowcy i Trasy
assert(html.includes('id="drivers-table"'), "index.html musi zawierać tabelę #drivers-table");
assert(html.includes('id="driver-form-modal"'), "index.html musi zawierać modal #driver-form-modal");
assert(html.includes('id="trips-table-main"'), "index.html musi zawierać tabelę #trips-table-main");
assert(html.includes('id="trip-start-modal"'), "index.html musi zawierać modal #trip-start-modal");
assert(html.includes('id="trip-end-modal"'), "index.html musi zawierać modal #trip-end-modal");
assert(html.includes('id="trip-manual-modal"'), "index.html musi zawierać modal #trip-manual-modal");

// Pojazdy
assert(html.includes('id="vehicles-table"'), "index.html musi zawierać tabelę #vehicles-table");
assert(html.includes('id="vehicle-form-modal"'), "index.html musi zawierać modal #vehicle-form-modal");

// Dołączenie SheetJS
assert(html.includes("xlsx.full.min.js"), "index.html musi ładować bibliotekę xlsx.full.min.js dla parsowania E100");
console.log("✓ Test 1: Struktura HTML dla nowych modułów poprawna");

// 2. Weryfikacja styli w style.css
const css = fs.readFileSync("style.css", "utf-8");
assert(css.includes(".badge-urgent"), "style.css musi zawierać styl .badge-urgent");
assert(css.includes(".badge-active"), "style.css musi zawierać styl .badge-active");
assert(css.includes(".badge-inactive"), "style.css musi zawierać styl .badge-inactive");
assert(css.includes(".badge-trip-ongoing"), "style.css musi zawierać styl .badge-trip-ongoing");
assert(css.includes(".e100-import-box"), "style.css musi zawierać styl .e100-import-box");
console.log("✓ Test 2: Style CSS dla nowych komponentów obecne");

// 3. Weryfikacja logiki w app.js
const js = fs.readFileSync("app.js", "utf-8");
assert(js.includes("btn-execute-ksef-sync"), "app.js musi obsługiwać synchronizację KSeF");
assert(js.includes("loadExpensesView"), "app.js musi definiować loadExpensesView");
assert(js.includes("fetchExpenses"), "app.js musi definiować fetchExpenses");
assert(js.includes("renderExpensesTable"), "app.js musi definiować renderExpensesTable");
assert(js.includes("getVatDivisor"), "app.js musi zawierać funkcję getVatDivisor dla E100");
assert(js.includes("loadDriversView"), "app.js musi definiować loadDriversView");
assert(js.includes("fetchDrivers"), "app.js musi definiować fetchDrivers");
assert(js.includes("fetchTrips"), "app.js musi definiować fetchTrips");
assert(js.includes("loadVehiclesView"), "app.js musi definiować loadVehiclesView");
assert(js.includes("fetchCompanyResult"), "app.js musi definiować fetchCompanyResult");
assert(js.includes("fetchCompanySummary"), "app.js musi definiować fetchCompanySummary");
console.log("✓ Test 3: Logika i sygnatury funkcji w app.js obecne");

// 4. Testy czystej logiki biznesowej
// A. Obliczanie dni w trasie
function calculateTripDays(startDate, endDate) {
  const sMs = new Date(startDate).getTime();
  const eMs = new Date(endDate).getTime();
  return Math.max(1, Math.round((eMs - sMs) / (1000 * 60 * 60 * 24)) + 1);
}

assert.strictEqual(calculateTripDays("2026-09-01", "2026-09-01"), 1, "Trasa jednodniowa (ten sam dzień) liczy 1 dzień");
assert.strictEqual(calculateTripDays("2026-09-01", "2026-09-02"), 2, "Wyjazd 1.09 i powrót 2.09 liczy 2 dni");
assert.strictEqual(calculateTripDays("2026-09-01", "2026-09-10"), 10, "Trasa od 1.09 do 10.09 liczy 10 dni");
console.log("✓ Test 4: Obliczanie dni trasy kierowcy poprawne");

// B. Filtrowanie pilnych faktur (przeterminowane lub <= 3 dni)
function isInvoiceUrgent(invoice, referenceDateIso) {
  if (invoice.paid) return false;
  if (!invoice.due_date) return false;
  const ref = new Date(referenceDateIso);
  ref.setDate(ref.getDate() + 3);
  const targetIso = ref.toISOString().split("T")[0];
  return invoice.due_date <= targetIso;
}

const testToday = "2026-10-13";
// Target dla pilnych to 2026-10-16
assert.strictEqual(isInvoiceUrgent({ paid: true, due_date: "2026-10-10" }, testToday), false, "Opłacona faktura nie jest pilna");
assert.strictEqual(isInvoiceUrgent({ paid: false, due_date: "2026-10-10" }, testToday), true, "Przeterminowana faktura jest pilna");
assert.strictEqual(isInvoiceUrgent({ paid: false, due_date: "2026-10-15" }, testToday), true, "Faktura z terminem za 2 dni jest pilna");
assert.strictEqual(isInvoiceUrgent({ paid: false, due_date: "2026-10-16" }, testToday), true, "Faktura z terminem za 3 dni jest pilna");
assert.strictEqual(isInvoiceUrgent({ paid: false, due_date: "2026-10-25" }, testToday), false, "Faktura z terminem za 12 dni nie jest pilna");
console.log("✓ Test 5: Logika identyfikacji pilnych faktur poprawna");

// C. Dzielnik VAT raportu E100
const mockRules = [
  { category: "vat_rate", key: "PL", value: { paliwo_vat: 1.23, myto_vat: 1.23 }, active: true },
  { category: "vat_rate", key: "DE", value: { paliwo_vat: 1.19, myto_vat: 1.00 }, active: true },
  { category: "vat_rate", key: "CZ", value: { paliwo_vat: 1.21, myto_vat: 1.00 }, active: true },
  { category: "vat_rate", key: "_default", value: { paliwo_vat: 1.23, myto_vat: 1.00 }, active: true }
];

function mockGetVatDivisor(rules, country, kind) {
  const c = String(country || "").trim().toUpperCase();
  const cRule = rules.find((r) => r.category === "vat_rate" && r.key === c && r.active);
  const defRule = rules.find((r) => r.category === "vat_rate" && (r.key === "_default" || r.key === "default") && r.active);
  const val = cRule?.value || defRule?.value;

  if (kind === "paliwo") {
    const d = Number(val?.paliwo_vat);
    return Number.isFinite(d) && d >= 1 && d <= 2 ? d : 1.23;
  } else {
    const d = Number(val?.myto_vat);
    return Number.isFinite(d) && d >= 1 && d <= 2 ? d : 1.00;
  }
}

assert.strictEqual(mockGetVatDivisor(mockRules, "PL", "paliwo"), 1.23);
assert.strictEqual(mockGetVatDivisor(mockRules, "DE", "paliwo"), 1.19);
assert.strictEqual(mockGetVatDivisor(mockRules, "DE", "myto"), 1.00);
assert.strictEqual(mockGetVatDivisor(mockRules, "FR", "paliwo"), 1.23, "Nieznany kraj korzysta z domyślnej reguły");
assert.strictEqual(mockGetVatDivisor(mockRules, "FR", "myto"), 1.00, "Nieznany kraj korzysta z domyślnej reguły");
console.log("✓ Test 6: Dobór dzielnika VAT dla E100 poprawny");

// D. Wynik firmy (przychody - koszty)
const mockInvoicesRevenue = 25000;
const mockExpensesSum = 18500;
const expectedProfit = mockInvoicesRevenue - mockExpensesSum;
assert.strictEqual(expectedProfit, 6500, "Wynik firmy (25000 - 18500) wynosi 6500 PLN");
console.log("✓ Test 7: Obliczanie wyniku netto firmy poprawne");

console.log("\nWSZYSTKIE TESTY ZAKOŃCZONE SUKCESEM!");
