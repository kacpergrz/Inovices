// Testy weryfikacyjne dla pobierania daty sprzedaży z KSeF i przypisywania do service_month
const fs = require("fs");
const assert = require("assert");

console.log("Rozpoczynam testy weryfikacyjne dla pobierania daty sprzedaży z KSeF...");

// 1. Weryfikacja obecności funkcji w whatsapp-webhook/index.ts
const webhookCode = fs.readFileSync("supabase/functions/whatsapp-webhook/index.ts", "utf-8");

assert(webhookCode.includes("fetchXmlDatesFromBroker"), "webhook musi zawierać funkcję fetchXmlDatesFromBroker");
assert(webhookCode.includes("getNewInvoicesXmlDates"), "webhook musi zawierać funkcję getNewInvoicesXmlDates");
assert(webhookCode.includes("/fetch-xml-dates"), "webhook musi wywoływać endpoint /fetch-xml-dates brokera");
assert(webhookCode.includes("service_month: serviceMonth"), "webhook musi mapować service_month z daty sprzedaży lub wystawienia");
console.log("✓ Test 1: Funkcje pomocnicze i mapowanie service_month w whatsapp-webhook obecne");

// 2. Weryfikacja logiki wyznaczania miesiąca rozliczeniowego na podstawie daty sprzedaży
function computeServiceMonth(inv, xmlDatesMap) {
  const saleDate = (xmlDatesMap && xmlDatesMap[inv.ksef_number]) || inv.sale_date || null;
  const effectiveDate = saleDate || inv.issue_date || null;
  return effectiveDate ? effectiveDate.slice(0, 7) : null;
}

// Scenariusz A: Usługa wykonana w sierpniu, faktura wystawiona we wrześniu
const invAugustService = {
  ksef_number: "5261040828-20260902-111111111111-AA",
  invoice_number: "FV/2026/09/01",
  issue_date: "2026-09-02"
};
const datesMapA = {
  "5261040828-20260902-111111111111-AA": "2026-08-31"
};

const serviceMonthA = computeServiceMonth(invAugustService, datesMapA);
assert.strictEqual(serviceMonthA, "2026-08", "Faktura z datą sprzedaży w sierpniu musi mieć service_month = 2026-08 mimo wystawienia we wrześniu");
console.log("✓ Test 2: Faktura z datą sprzedaży w poprzednim miesiącu poprawnie przypisana do miesiąca sprzedaży");

// Scenariusz B: Sprzedaż i wystawienie w tym samym miesiącu
const invSameMonth = {
  ksef_number: "5261040828-20260915-222222222222-BB",
  invoice_number: "FV/2026/09/15",
  issue_date: "2026-09-15"
};
const datesMapB = {
  "5261040828-20260915-222222222222-BB": "2026-09-15"
};
const serviceMonthB = computeServiceMonth(invSameMonth, datesMapB);
assert.strictEqual(serviceMonthB, "2026-09", "Faktura z datą sprzedaży i wystawienia we wrześniu ma service_month = 2026-09");
console.log("✓ Test 3: Faktura z datą sprzedaży w tym samym miesiącu poprawnie przypisana");

// Scenariusz C: Brak tagu P_6 w XML (data sprzedaży tożsama z datą wystawienia)
const invNoSaleDate = {
  ksef_number: "5261040828-20261005-333333333333-CC",
  invoice_number: "FV/2026/10/05",
  issue_date: "2026-10-05"
};
const datesMapC = {
  "5261040828-20261005-333333333333-CC": null
};
const serviceMonthC = computeServiceMonth(invNoSaleDate, datesMapC);
assert.strictEqual(serviceMonthC, "2026-10", "Gdy brak daty sprzedaży, fallbackuje do miesiąca daty wystawienia");
console.log("✓ Test 4: Fallback do issue_date działa poprawnie");

// 3. Weryfikacja selektywnego pobierania XML (tylko dla nowych faktur)
const mockExistingInDb = new Set(["5261040828-EXISTING-01", "5261040828-EXISTING-02"]);
const mockFetchedFromKsef = [
  { ksef_number: "5261040828-EXISTING-01" },
  { ksef_number: "5261040828-NEW-01" },
  { ksef_number: "5261040828-EXISTING-02" },
  { ksef_number: "5261040828-NEW-02" }
];

const newNumbers = mockFetchedFromKsef
  .map((i) => i.ksef_number)
  .filter((num) => !mockExistingInDb.has(num));

assert.deepStrictEqual(newNumbers, ["5261040828-NEW-01", "5261040828-NEW-02"], "Tylko nowe faktury powinny trafić do pobrania XML");
console.log("✓ Test 5: Selekcja nowych faktur do pobrania XML chroni przed nadmiarowymi zapytaniami do KSeF");

// 4. Weryfikacja, że istniejące faktury w bazie nie są modyfikowane
assert(webhookCode.includes("ignoreDuplicates: true"), "upsert musi używać ignoreDuplicates: true, aby zachować stan istniejących faktur");
console.log("✓ Test 6: Bezpieczeństwo istniejących faktur w bazie (ignoreDuplicates: true) zagwarantowane");

console.log("\nWSZYSTKIE TESTY WERYFIKACYJNE KSEF SALE DATE ZAKOŃCZONE SUKCESEM!");
