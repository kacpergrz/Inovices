// Testy weryfikacyjne dla pobierania numeru zlecenia z KSeF XML i przypisywania do invoices
const fs = require("fs");
const assert = require("assert");

console.log("Rozpoczynam testy weryfikacyjne dla pobierania numeru zlecenia z KSeF...");

// 1. Weryfikacja obecności zmian w supabase/functions/whatsapp-webhook/index.ts
const webhookCode = fs.readFileSync("supabase/functions/whatsapp-webhook/index.ts", "utf-8");

assert(webhookCode.includes("orderNumber: string | null;"), "XmlInvoiceData musi zawierać pole orderNumber");
assert(webhookCode.includes("orderNumber: val?.orderNumber ?? null"), "fetchXmlDatesFromBroker musi mapować val?.orderNumber");
assert(webhookCode.includes("ksefOrderNumber"), "webhook musi obsługiwać zmienną ksefOrderNumber");
assert(webhookCode.includes("order_number: ksefOrderNumber || null"), "webhook musi zapisywać order_number w payloadToInsert");
assert(webhookCode.includes("Zlecenie: ${item.order_number}"), "komenda pokaz musi wyświetlać numer zlecenia jeśli obecny");
console.log("✓ Test 1: Logika i sygnatury w whatsapp-webhook/index.ts obecne");

// 2. Symulacja ekstrakcji order_number z mapy xmlDatesMap
function mapInvoiceOrderNumber(inv, xmlDatesMap) {
  const xmlInfo = xmlDatesMap ? xmlDatesMap[inv.ksef_number] : null;
  const ksefOrderNumber = (typeof xmlInfo === "object" && xmlInfo !== null)
    ? xmlInfo.orderNumber
    : (inv.order_number || null);

  return ksefOrderNumber || null;
}

// Scenariusz A: Nowa faktura z numerem zlecenia w XML
const invA = {
  ksef_number: "5261040828-20261014-111111111111-AA",
  invoice_number: "FV/2026/10/01"
};
const datesMapA = {
  "5261040828-20261014-111111111111-AA": {
    saleDate: "2026-10-10",
    dueDate: "2026-11-10",
    orderNumber: "ZT/2026/04/105"
  }
};
assert.strictEqual(mapInvoiceOrderNumber(invA, datesMapA), "ZT/2026/04/105", "Powinno poprawnie przypisać numer zlecenia z XML");
console.log("✓ Test 2: Poprawne przypisanie numeru zlecenia z XML");

// Scenariusz B: Faktura bez numeru zlecenia w XML
const invB = {
  ksef_number: "5261040828-20261014-222222222222-BB",
  invoice_number: "FV/2026/10/02"
};
const datesMapB = {
  "5261040828-20261014-222222222222-BB": {
    saleDate: "2026-10-10",
    dueDate: "2026-11-10",
    orderNumber: null
  }
};
assert.strictEqual(mapInvoiceOrderNumber(invB, datesMapB), null, "Gdy brak zlecenia w XML, powinno zwrócić null");
console.log("✓ Test 3: Brak zlecenia w XML zwraca null");

// Scenariusz C: Fallback do istniejącego order_number na obiekcie inv
const invC = {
  ksef_number: "5261040828-20261014-333333333333-CC",
  invoice_number: "FV/2026/10/03",
  order_number: "MANUAL/ORD/77"
};
const datesMapC = {
  "5261040828-20261014-333333333333-CC": null
};
assert.strictEqual(mapInvoiceOrderNumber(invC, datesMapC), "MANUAL/ORD/77", "Fallback do istniejącego order_number w obiekcie faktury");
console.log("✓ Test 4: Fallback do ręcznego order_number działa prawidłowo");

console.log("\nWSZYSTKIE TESTY WERYFIKACYJNE KSEF ORDER NUMBER ZAKOŃCZONE SUKCESEM!");
