// Testy walidacyjne dla funkcji filtrowania faktur po miesiącach
const fs = require("fs");
const assert = require("assert");
const vm = require("vm");

console.log("Rozpoczynam testy weryfikacyjne dla filtrowania faktur po miesiącach...");

// 1. Weryfikacja index.html
const html = fs.readFileSync("index.html", "utf-8");

assert(html.includes('id="filter-month"'), "index.html musi zawierać element <select id=\"filter-month\">");
assert(html.includes('for="filter-month"'), "index.html musi zawierać etykietę <label for=\"filter-month\">");
assert(html.includes('<option value="all">Wszystkie miesiące</option>'), "index.html musi zawierać domyślną opcję 'Wszystkie miesiące'");
assert(html.includes('class="filters-grid"'), "index.html musi zawierać kontener .filters-grid");
console.log("✓ Test 1: Struktura HTML dla filtra miesięcy w panelu faktur poprawna");

// 2. Weryfikacja style.css
const css = fs.readFileSync("style.css", "utf-8");

assert(css.includes(".filters-grid"), "style.css musi zawierać reguły dla .filters-grid");
assert(css.includes(".filter-box"), "style.css musi zawierać reguły dla .filter-box");
assert(css.includes(".filter-box-sort"), "style.css musi zawierać reguły dla .filter-box-sort");
console.log("✓ Test 2: Style CSS dla siatki filtrów i responsywności obecne");

// 3. Weryfikacja app.js - obecność kluczowych elementów i funkcji
const js = fs.readFileSync("app.js", "utf-8");

assert(js.includes('const filterMonthEl = document.getElementById("filter-month")'), "app.js musi pobierać referencję filterMonthEl");
assert(js.includes('filterMonthEl.addEventListener("change", applyFiltersAndRender)'), "app.js musi nasłuchiwać zdarzenia change na filterMonthEl");
assert(js.includes("updateInvoiceMonthFilter"), "app.js musi definiować funkcję updateInvoiceMonthFilter");
assert(js.includes("invoiceBelongsToMonth"), "app.js musi posiadać funkcję invoiceBelongsToMonth");
assert(js.includes("monthFilter"), "applyFiltersAndRender musi uwzględniać monthFilter");
console.log("✓ Test 3: Sygnatury i powiązania zdarzeń w app.js obecne");

// 4. Załadowanie funkcji z app.js w bezpiecznym środowisku VM
const mockFilterMonthEl = {
  value: "all",
  innerHTML: "",
  addEventListener: () => {}
};

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
    getElementById: (id) => {
      if (id === "filter-month") return mockFilterMonthEl;
      return dummyEl;
    },
    querySelectorAll: () => [dummyEl]
  },
  module: { exports: {} },
  fetch: () => Promise.resolve({ json: () => Promise.resolve([]) })
};

vm.createContext(context);
vm.runInContext(js, context);
const { invoiceBelongsToMonth, generateMonthOptions } = context.module.exports;

// 5. Testy czystej logiki przynależności faktur do filtrowanego miesiąca
const inv1 = { id: 1, invoice_number: "FV/1", issue_date: "2026-09-10", service_month: null, paid: true, net_amount: 1000 };
const inv2 = { id: 2, invoice_number: "FV/2", issue_date: "2026-08-25", service_month: "2026-09", paid: false, net_amount: 2000 }; // przypisana do 2026-09
const inv3 = { id: 3, invoice_number: "FV/3", issue_date: "2026-09-28", service_month: "2026-10", paid: false, net_amount: 3000 }; // przeniesiona do 2026-10
const inv4 = { id: 4, invoice_number: "FV/4", issue_date: "2026-10-05", service_month: null, paid: true, net_amount: 1500 };
const inv5 = { id: 5, invoice_number: "FV/5", issue_date: "2026-09-30T14:30:00Z", service_month: null, paid: false, net_amount: 500 }; // data z czasem

// Weryfikacja dla miesiąca 2026-09:
assert.strictEqual(invoiceBelongsToMonth(inv1, "2026-09"), true, "Standardowa faktura z września należy do 2026-09");
assert.strictEqual(invoiceBelongsToMonth(inv2, "2026-09"), true, "Faktura z service_month=2026-09 należy do 2026-09");
assert.strictEqual(invoiceBelongsToMonth(inv3, "2026-09"), false, "Faktura przeniesiona do 2026-10 NIE należy do 2026-09");
assert.strictEqual(invoiceBelongsToMonth(inv4, "2026-09"), false, "Faktura z października nie należy do 2026-09");
assert.strictEqual(invoiceBelongsToMonth(inv5, "2026-09"), true, "Faktura z ISO timestamp z września należy do 2026-09");

// Weryfikacja dla miesiąca 2026-10:
assert.strictEqual(invoiceBelongsToMonth(inv1, "2026-10"), false, "Faktura z września nie należy do 2026-10");
assert.strictEqual(invoiceBelongsToMonth(inv3, "2026-10"), true, "Faktura z service_month=2026-10 należy do 2026-10");
assert.strictEqual(invoiceBelongsToMonth(inv4, "2026-10"), true, "Standardowa faktura z października należy do 2026-10");
console.log("✓ Test 4: Jednostkowa logika przynależności faktury do miesiąca (w tym service_month) działa prawidłowo");

// 6. Testy filtrowania listy faktur po miesiącu
const invoicesList = [inv1, inv2, inv3, inv4, inv5];

function simulateMonthFilter(invoices, month) {
  if (!month || month === "all") return invoices;
  return invoices.filter((inv) => invoiceBelongsToMonth(inv, month));
}

const allFiltered = simulateMonthFilter(invoicesList, "all");
assert.strictEqual(allFiltered.length, 5, "Filtr 'all' musi zwracać wszystkie 5 faktur");

const sepFiltered = simulateMonthFilter(invoicesList, "2026-09");
assert.strictEqual(sepFiltered.length, 3, "Filtr '2026-09' musi zwrócić 3 faktury (inv1, inv2, inv5)");
assert.deepStrictEqual(sepFiltered.map(i => i.id), [1, 2, 5], "Zwrócone faktury muszą mieć id 1, 2 i 5");

const octFiltered = simulateMonthFilter(invoicesList, "2026-10");
assert.strictEqual(octFiltered.length, 2, "Filtr '2026-10' musi zwrócić 2 faktury (inv3, inv4)");
assert.deepStrictEqual(octFiltered.map(i => i.id), [3, 4], "Zwrócone faktury muszą mieć id 3 i 4");

const novFiltered = simulateMonthFilter(invoicesList, "2026-11");
assert.strictEqual(novFiltered.length, 0, "Brak faktur dla pustego miesiąca zwraca pustą listę");
console.log("✓ Test 5: Filtrowanie kolekcji faktur po miesiącach działa prawidłowo");

// 7. Testy kombinacji filtrów (Miesiąc + Status płatności)
const sepUnpaid = simulateMonthFilter(invoicesList, "2026-09").filter(i => i.paid === false);
assert.strictEqual(sepUnpaid.length, 2, "We wrześniu są 2 nieopłacone faktury (inv2 i inv5)");
assert.deepStrictEqual(sepUnpaid.map(i => i.id), [2, 5]);

const sepPaid = simulateMonthFilter(invoicesList, "2026-09").filter(i => i.paid === true);
assert.strictEqual(sepPaid.length, 1, "We wrześniu jest 1 opłacona faktura (inv1)");
assert.strictEqual(sepPaid[0].id, 1);
console.log("✓ Test 6: Kombinacja filtra miesiąca z filtrem statusu działa bezbłędnie");

console.log("\nWSZYSTKIE TESTY FILTROWANIA FAKTUR PO MIESIĄCACH ZAKOŃCZONE SUKCESEM!");
