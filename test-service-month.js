// Testy walidacyjne dla uwzględniania przypisanego miesiąca rozliczenia (service_month)
const fs = require("fs");
const assert = require("assert");
const vm = require("vm");

console.log("Rozpoczynam testy weryfikacyjne dla obsługi przypisanego miesiąca rozliczenia...");

// 1. Weryfikacja index.html
const html = fs.readFileSync("index.html", "utf-8");

assert(html.includes('id="f-service-month"'), "index.html musi zawierać pole #f-service-month w formularzu faktury");
assert(html.includes('id="service-month-modal"'), "index.html musi zawierać modal #service-month-modal");
assert(html.includes('id="modal-service-month-select"'), "service-month-modal musi zawierać select #modal-service-month-select");
assert(html.includes('id="modal-service-month-custom"'), "service-month-modal musi zawierać pole #modal-service-month-custom");
assert(html.includes('id="btn-save-service-month"'), "service-month-modal musi zawierać przycisk #btn-save-service-month");
assert(html.includes('id="btn-cancel-service-month"'), "service-month-modal musi zawierać przycisk #btn-cancel-service-month");
console.log("✓ Test 1: Struktura HTML dla przypisanego miesiąca poprawna");

// 2. Weryfikacja style.css
const css = fs.readFileSync("style.css", "utf-8");

assert(css.includes(".badge-service-month"), "style.css musi zawierać klasę .badge-service-month");
console.log("✓ Test 2: Style CSS dla badge'a miesiąca rozliczenia obecne");

// 3. Weryfikacja app.js - obecność kluczowych funkcji i logiki
const js = fs.readFileSync("app.js", "utf-8");

assert(js.includes("getMonthInvoiceFilter"), "app.js musi zawierać funkcję getMonthInvoiceFilter");
assert(js.includes("invoiceBelongsToMonth"), "app.js musi zawierać funkcję invoiceBelongsToMonth");
assert(js.includes("setInvoiceServiceMonth"), "app.js musi zawierać funkcję setInvoiceServiceMonth");
assert(js.includes("openServiceMonthModal"), "app.js musi zawierać funkcję openServiceMonthModal");
assert(js.includes("closeServiceMonthModal"), "app.js musi zawierać funkcję closeServiceMonthModal");
assert(js.includes("updateServiceMonthSelect"), "app.js musi zawierać funkcję updateServiceMonthSelect");
assert(js.includes('data-action="set-service-month"'), "app.js musi generować akcję set-service-month w tabeli");
assert(js.includes("service_month"), "fetchInvoices musi pobierać service_month");
assert(js.includes(".or(getMonthInvoiceFilter(month))"), "Zapytania obliczeniowe muszą używać getMonthInvoiceFilter");
console.log("✓ Test 3: Logika i sygnatury w app.js obecne");

// 4. Załadowanie funkcji z app.js w bezpiecznym kontekście VM
const dummyEl = {
  addEventListener: () => {},
  classList: { add: () => {}, remove: () => {} },
  value: "",
  textContent: "",
  innerHTML: ""
};

const context = {
  window: {
    supabase: {
      createClient: () => ({
        auth: { onAuthStateChange: () => {}, getSession: () => Promise.resolve({ data: {} }) },
        from: () => ({ select: () => ({}) })
      })
    }
  },
  document: {
    getElementById: () => dummyEl,
    querySelectorAll: () => [dummyEl]
  },
  module: { exports: {} },
  fetch: () => Promise.resolve({ json: () => Promise.resolve([]) })
};

vm.createContext(context);
vm.runInContext(js, context);
const { getMonthInvoiceFilter, invoiceBelongsToMonth, getMonthRange } = context.module.exports;

// 5. Testy generowania filtra PostgREST dla bazy Supabase (zgodność z Edge Function whatsapp-webhook)
const filterSep = getMonthInvoiceFilter("2026-09");
assert.strictEqual(
  filterSep,
  "service_month.eq.2026-09,and(service_month.is.null,issue_date.gte.2026-09-01,issue_date.lte.2026-09-30)",
  "Filtr dla września 2026 musi dokładnie odpowiadać logice z Edge Function whatsapp-webhook"
);

const filterFeb = getMonthInvoiceFilter("2026-02");
assert.strictEqual(
  filterFeb,
  "service_month.eq.2026-02,and(service_month.is.null,issue_date.gte.2026-02-01,issue_date.lte.2026-02-28)",
  "Filtr dla lutego 2026 musi uwzględniać poprawny ostatni dzień miesiąca"
);

const filterJul = getMonthInvoiceFilter("2026-07");
assert.strictEqual(
  filterJul,
  "service_month.eq.2026-07,and(service_month.is.null,issue_date.gte.2026-07-01,issue_date.lte.2026-07-31)",
  "Filtr dla lipca 2026 musi obejmować do 31 lipca"
);
console.log("✓ Test 4: Generowanie filtra PostgREST w 100% zgodne z Edge Function whatsapp-webhook");

// 6. Testy jednostkowe czystej logiki przypisania faktury do miesiąca rozliczeniowego
const invNormalSep = { id: 1, invoice_number: "FV/1", issue_date: "2026-09-10", service_month: null, net_amount: 1000 };
const invAssignedToSepFromAug = { id: 2, invoice_number: "FV/2", issue_date: "2026-08-30", service_month: "2026-09", net_amount: 2000 };
const invMovedFromSepToOct = { id: 3, invoice_number: "FV/3", issue_date: "2026-09-25", service_month: "2026-10", net_amount: 3000 };
const invNormalAug = { id: 4, invoice_number: "FV/4", issue_date: "2026-08-15", service_month: null, net_amount: 500 };
const invNormalOct = { id: 5, invoice_number: "FV/5", issue_date: "2026-10-05", service_month: null, net_amount: 700 };

// Sprawdzenie przynależności do września 2026 (2026-09)
assert.strictEqual(invoiceBelongsToMonth(invNormalSep, "2026-09"), true, "Standardowa faktura z września należy do września");
assert.strictEqual(invoiceBelongsToMonth(invAssignedToSepFromAug, "2026-09"), true, "Faktura z sierpnia przypisana do września należy do września");
assert.strictEqual(invoiceBelongsToMonth(invMovedFromSepToOct, "2026-09"), false, "Faktura z września przeniesiona do października NIE może być liczona we wrześniu");
assert.strictEqual(invoiceBelongsToMonth(invNormalAug, "2026-09"), false, "Standardowa faktura z sierpnia nie należy do września");
assert.strictEqual(invoiceBelongsToMonth(invNormalOct, "2026-09"), false, "Standardowa faktura z października nie należy do września");

// Sprawdzenie przynależności do sierpnia 2026 (2026-08)
assert.strictEqual(invoiceBelongsToMonth(invNormalAug, "2026-08"), true, "Standardowa faktura z sierpnia należy do sierpnia");
assert.strictEqual(invoiceBelongsToMonth(invAssignedToSepFromAug, "2026-08"), false, "Faktura z sierpnia przypisana do września NIE może być liczona w sierpniu");

// Sprawdzenie przynależności do października 2026 (2026-10)
assert.strictEqual(invoiceBelongsToMonth(invNormalOct, "2026-10"), true, "Standardowa faktura z października należy do października");
assert.strictEqual(invoiceBelongsToMonth(invMovedFromSepToOct, "2026-10"), true, "Faktura wystawiona we wrześniu, ale przypisana do października, należy do października");
console.log("✓ Test 5: Przypisywanie faktur do miesięcy rozliczeniowych działa prawidłowo");

// 7. Test symulacji sumowania dochodu/przychodu dla miesiąca z uwzględnieniem przypisań
const allTestInvoices = [
  invNormalSep,            // +1000 we wrześniu
  invAssignedToSepFromAug, // +2000 we wrześniu (mimo daty wystawienia w sierpniu)
  invMovedFromSepToOct,    // wykluczona z września, idzie do października (+3000 w październiku)
  invNormalAug,            // +500 w sierpniu
  invNormalOct             // +700 w październiku
];

const sepInvoices = allTestInvoices.filter((inv) => invoiceBelongsToMonth(inv, "2026-09"));
const sepRevenue = sepInvoices.reduce((sum, inv) => sum + inv.net_amount, 0);
assert.strictEqual(sepInvoices.length, 2, "We wrześniu powinny być dokładnie 2 faktury (FV/1 oraz FV/2)");
assert.strictEqual(sepRevenue, 3000, "Przychód września powinien wynieść 1000 + 2000 = 3000 PLN (z wykluczeniem FV/3)");

const augInvoices = allTestInvoices.filter((inv) => invoiceBelongsToMonth(inv, "2026-08"));
const augRevenue = augInvoices.reduce((sum, inv) => sum + inv.net_amount, 0);
assert.strictEqual(augInvoices.length, 1, "W sierpniu powinna być tylko 1 faktura (FV/4)");
assert.strictEqual(augRevenue, 500, "Przychód sierpnia powinien wynieść 500 PLN");

const octInvoices = allTestInvoices.filter((inv) => invoiceBelongsToMonth(inv, "2026-10"));
const octRevenue = octInvoices.reduce((sum, inv) => sum + inv.net_amount, 0);
assert.strictEqual(octInvoices.length, 2, "W październiku powinny być 2 faktury (FV/3 przeniesiona z września oraz FV/5)");
assert.strictEqual(octRevenue, 3700, "Przychód października powinien wynieść 3000 + 700 = 3700 PLN");
console.log("✓ Test 6: Poprawność kalkulacji sumarycznych dla miesięcy potwierdzona");

console.log("\nWSZYSTKIE TESTY ZAKOŃCZONE SUKCESEM!");
