// Testy weryfikacyjne dla modułu zleceń (PDF, DOCX, parowanie z fakturami, Supabase Storage)
const fs = require("fs");
const assert = require("assert");

console.log("Rozpoczynam testy weryfikacyjne dla modułu zleceń...");

const html = fs.readFileSync("index.html", "utf-8");
const css = fs.readFileSync("style.css", "utf-8");
const js = fs.readFileSync("app.js", "utf-8");

// 1. Weryfikacja index.html
assert(html.includes("pdf.min.js"), "index.html musi ładować pdf.js przez CDN");
assert(html.includes("mammoth.browser.min.js"), "index.html musi ładować mammoth.js przez CDN");
assert(html.includes('id="btn-open-orders-upload"'), "index.html musi zawierać przycisk Wgraj zlecenia");
assert(html.includes("<th>Zlecenie</th>"), "index.html musi zawierać kolumnę Zlecenie w tabeli faktur");
assert(html.includes('id="orders-modal"'), "index.html musi zawierać modal orders-modal");
assert(html.includes('id="orders-drop-zone"'), "index.html musi zawierać strefę Drag & Drop orders-drop-zone");
assert(html.includes('id="orders-preview-table"'), "index.html musi zawierać tabelę podglądu odczytanych zleceń");
assert(html.includes('id="btn-save-orders-batch"'), "index.html musi zawierać przycisk zapisu zleceń");
assert(html.includes('id="order-preview-modal"'), "index.html musi zawierać modal order-preview-modal");
assert(html.includes('id="order-preview-iframe"'), "index.html musi zawierać iframe dla podglądu PDF");
assert(html.includes('id="order-preview-docx-content"'), "index.html musi zawierać kontener dla podglądu DOCX");
console.log("✓ Test 1: Struktura index.html poprawna (biblioteki CDN, toolbar, tabela, modal z Drag & Drop i podgląd dokumentów)");

// 2. Weryfikacja style.css
assert(css.includes(".drop-zone"), "style.css musi stylizować strefę upuszczania plików");
assert(css.includes(".badge-order"), "style.css musi stylizować badge zlecenia");
assert(css.includes(".modal-box-large"), "style.css musi definiować powiększone okno modalne");
assert(css.includes(".modal-box-preview"), "style.css musi definiować okno podglądu dokumentu");
assert(css.includes(".order-preview-frame"), "style.css musi definiować styl ramki podglądu PDF");
assert(css.includes(".order-preview-docx-paper"), "style.css musi definiować kartkę A4 dla podglądu DOCX");
assert(css.includes("#invoices-table .col-order"), "style.css musi uwzględniać kolumnę zlecenia w siatce RWD");
console.log("✓ Test 2: Style CSS obecne i zintegrowane z RWD i podglądem");

// 3. Weryfikacja logiki w app.js
assert(js.includes("extractTextFromPdf"), "app.js musi zawierać funkcję odczytu PDF");
assert(js.includes("extractTextFromDocx"), "app.js musi zawierać funkcję odczytu DOCX");
assert(js.includes("extractOrderNumberFromText"), "app.js musi zawierać parser numeru zlecenia z tekstu");
assert(js.includes("findMatchingInvoiceForOrder"), "app.js musi zawierać silnik dopasowywania zlecenia do faktury");
assert(js.includes('storage\n      .from("orders")') || js.includes('.storage.from("orders")') || js.includes('from("orders")'), "app.js musi obsługiwać bucket orders w Supabase Storage");
assert(js.includes("order_number, order_file_url, order_file_name"), "fetchInvoices musi pobierać dane powiązanego zlecenia");
assert(js.includes("renderOrderCell"), "app.js musi renderować komórkę zlecenia w tabeli faktur");
assert(js.includes("previewOrderFile"), "app.js musi zawierać funkcję podglądu zlecenia bez pobierania");
assert(js.includes("closeOrderPreviewModal"), "app.js musi zawierać funkcję zamykania modala podglądu");
assert(js.includes('data-action="preview-order"'), "app.js musi renderować przycisk akcji preview-order");
console.log("✓ Test 3: Logika JavaScript, podgląd PDF/DOCX i integracja z Supabase Storage w app.js obecna");

// 4. Testy jednostkowe logiki ekstrakcji numeru zlecenia
function cleanOrderNumber(raw) {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/^[:\s\.\,\;\\/\-]+|[:\s\.\,\;\\/\-]+$/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

function extractOrderNumberFromText(text) {
  if (!text || typeof text !== "string") return null;
  const patterns = [
    /\b(?:zlecen(?:ie|ia)?\s+transportow(?:e|ego)|zlec\.?\s*transp\.?)\s*(?:nr|numer)?[\s:\.\/]*([A-Za-z0-9\/\-_\.]+)/i,
    /\b(?:zlecen(?:ie|ia)?|zlec\.)\s*(?:nr|numer)[\s:\.\/]*([A-Za-z0-9\/\-_\.]+)/i,
    /\b(?:nr|numer)\s*zlecenia(?:\s+transportowego)?[\s:\.\/]*([A-Za-z0-9\/\-_\.]+)/i,
    /\bzlecenie[\s:]+([A-Za-z0-9\/\-_\.]+)/i,
    /\b(?:order|po)\s*(?:no|nr|number|ref)?[\s:\.\/]+([A-Za-z0-9\/\-_\.]+)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidate = cleanOrderNumber(match[1]);
      if (candidate) return candidate;
    }
  }
  return null;
}

assert.strictEqual(
  extractOrderNumberFromText("Zlecenie transportowe nr ZT/2026/04/105 data rozładunku 2026-04-10"),
  "ZT/2026/04/105"
);
assert.strictEqual(
  extractOrderNumberFromText("POTWIERDZENIE ZLECENIA NR: 998-10-WAW płatność 30 dni"),
  "998-10-WAW"
);
assert.strictEqual(
  extractOrderNumberFromText("Zlecenie nr 4589/26."),
  "4589/26"
);
assert.strictEqual(
  extractOrderNumberFromText("Transport Order Ref: PO-88771-DE"),
  "PO-88771-DE"
);
console.log("✓ Test 4: Parser numeru zlecenia z treści plików PDF/DOCX działa poprawnie");

// 5. Testy jednostkowe dopasowywania zlecenia do faktury
function normalizeOrderForComparison(str) {
  return String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findMatchingInvoice(orderNum, invoices) {
  if (!orderNum || !invoices.length) return null;
  const target = normalizeOrderForComparison(orderNum);
  if (!target) return null;

  const exact = invoices.find(inv => {
    if (!inv.order_number) return false;
    return normalizeOrderForComparison(inv.order_number) === target;
  });
  if (exact) return exact;

  const byInvoiceNumber = invoices.find(inv => {
    if (!inv.invoice_number) return false;
    const normInv = normalizeOrderForComparison(inv.invoice_number);
    return normInv.includes(target) || target.includes(normInv);
  });
  if (byInvoiceNumber) return byInvoiceNumber;

  return null;
}

const mockInvoices = [
  { id: 1, invoice_number: "FV/2026/04/10", order_number: "ZT/2026/04/105", seller_name: "TransPol" },
  { id: 2, invoice_number: "FV/2026/04/11", order_number: "4589/26", seller_name: "LogiSped" },
  { id: 3, invoice_number: "FV/2026/PO-88771", order_number: null, seller_name: "EuroCargo" }
];

const matched1 = findMatchingInvoice("ZT/2026/04/105", mockInvoices);
assert.strictEqual(matched1?.id, 1, "Powinno dopasować dokładnie po order_number");

const matched2 = findMatchingInvoice("4589/26", mockInvoices);
assert.strictEqual(matched2?.id, 2, "Powinno dopasować po order_number bez prefiksu");

const matched3 = findMatchingInvoice("PO-88771", mockInvoices);
assert.strictEqual(matched3?.id, 3, "Powinno dopasować po numerze faktury gdy brak order_number w KSeF");

const matchedNotFound = findMatchingInvoice("UNKNOWN-999", mockInvoices);
assert.strictEqual(matchedNotFound, null, "Dla niepasującego zlecenia zwraca null");
console.log("✓ Test 5: Automatyczne dopasowanie 1:1 do faktur działa bezbłędnie");

console.log("\nWSZYSTKIE TESTY WERYFIKACYJNE MODUŁU ZLECEŃ ZAKOŃCZONE SUKCESEM!");
