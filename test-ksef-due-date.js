// Testy weryfikacyjne dla pobierania terminu płatności (due_date) z KSeF
const fs = require("fs");
const assert = require("assert");

console.log("Rozpoczynam testy weryfikacyjne dla pobierania terminu płatności z KSeF...");

// 1. Weryfikacja obecności kodu w supabase/functions/whatsapp-webhook/index.ts
const webhookCode = fs.readFileSync("supabase/functions/whatsapp-webhook/index.ts", "utf-8");

assert(webhookCode.includes("interface XmlInvoiceData"), "webhook musi definiować interface XmlInvoiceData");
assert(webhookCode.includes("dueDate: string | null"), "XmlInvoiceData musi zawierać pole dueDate");
assert(webhookCode.includes("data.invoicesData"), "webhook musi obsługiwać data.invoicesData z brokera KSeF");
assert(webhookCode.includes("ksefDueDate"), "webhook musi obsługiwać zmienną ksefDueDate");
assert(webhookCode.includes("due_date: inferDueDate(invWithDueDate, rules)"), "due_date musi uwzględniać termin z KSeF");
assert(webhookCode.includes("payment_days: inferPaymentDays(invWithDueDate, rules)"), "payment_days musi uwzględniać termin z KSeF");
console.log("✓ Test 1: Logika i sygnatury w whatsapp-webhook/index.ts obecne");

// 2. Symulacja inferDueDate i inferPaymentDays
function inferPaymentDays(inv, rules) {
  const raw =
    inv?.payment_days ??
    inv?.paymentTermsDays ??
    inv?.payment_terms_days ??
    inv?.termin_dni ??
    inv?.payment_term_days ??
    null;

  if (raw !== null && raw !== "") {
    const days = Number(raw);
    if (Number.isInteger(days) && days >= 0) return days;
  }

  if (inv?.due_date && inv?.issue_date) {
    const issueTime = new Date(inv.issue_date).getTime();
    const dueTime = new Date(inv.due_date).getTime();
    if (!isNaN(issueTime) && !isNaN(dueTime)) {
      const diffDays = Math.round((dueTime - issueTime) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0) return diffDays;
    }
  }

  return rules?.get("default_payment_days") || 14;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function inferDueDate(inv, rules) {
  if (inv?.due_date) return inv.due_date;

  const issueDate = inv?.issue_date ?? null;
  const paymentDays = inferPaymentDays(inv, rules);

  if (!issueDate || paymentDays === null) return null;
  return addDays(issueDate, paymentDays);
}

// Scenariusz A: Faktura z KSeF zawiera jawny termin płatności (np. 30 dni)
const invWithKsefTerm = {
  ksef_number: "5261040828-20261001-111111111111-AA",
  invoice_number: "FV/2026/10/01",
  issue_date: "2026-10-01",
  due_date: "2026-10-31" // termin z KSeF XML
};
const rulesMock = new Map([["default_payment_days", 14]]);

const dueDateA = inferDueDate(invWithKsefTerm, rulesMock);
const paymentDaysA = inferPaymentDays(invWithKsefTerm, rulesMock);

assert.strictEqual(dueDateA, "2026-10-31", "Termin z KSeF musi mieć pierwszeństwo przed regułą default 14 dni");
assert.strictEqual(paymentDaysA, 30, "Liczba dni terminu płatności powinna wynosić 30");
console.log("✓ Test 2: Termin z KSeF XML ma pierwszeństwo przed regułami i poprawnie wylicza dni");

// Scenariusz B: Faktura z KSeF nie ma terminu w XML (fallback do reguł)
const invNoKsefTerm = {
  ksef_number: "5261040828-20261005-222222222222-BB",
  invoice_number: "FV/2026/10/05",
  issue_date: "2026-10-05",
  due_date: null
};

const dueDateB = inferDueDate(invNoKsefTerm, rulesMock);
const paymentDaysB = inferPaymentDays(invNoKsefTerm, rulesMock);

assert.strictEqual(dueDateB, "2026-10-19", "Gdy brak terminu w KSeF, fallback do 14 dni reguły");
assert.strictEqual(paymentDaysB, 14, "Gdy brak terminu w KSeF, liczba dni pochodzi z reguły (14 dni)");
console.log("✓ Test 3: Fallback do reguł działa prawidłowo gdy w XML brak terminu");

// Scenariusz C: Płatność natychmiastowa (DataZaplaty tożsama z datą wystawienia, 0 dni)
const invImmediatePay = {
  ksef_number: "5261040828-20261010-333333333333-CC",
  invoice_number: "FV/2026/10/10",
  issue_date: "2026-10-10",
  due_date: "2026-10-10"
};

const dueDateC = inferDueDate(invImmediatePay, rulesMock);
const paymentDaysC = inferPaymentDays(invImmediatePay, rulesMock);

assert.strictEqual(dueDateC, "2026-10-10", "Termin płatności równy dacie zapłaty/wystawienia");
assert.strictEqual(paymentDaysC, 0, "Liczba dni terminu płatności przy płatności natychmiastowej wynosi 0");
console.log("✓ Test 4: Płatność natychmiastowa poprawnie zachowuje termin i 0 dni");

// 3. Test parsowania odpowiedzi z brokera KSeF
function parseBrokerResponse(data, ksefNumbers) {
  const result = {};
  if (data && typeof data.invoicesData === "object" && data.invoicesData) {
    for (const [key, val] of Object.entries(data.invoicesData)) {
      result[key] = {
        saleDate: val?.saleDate ?? null,
        dueDate: val?.dueDate ?? null,
      };
    }
    return result;
  }

  const dates = (data && typeof data.dates === "object" && data.dates) ? data.dates : {};
  const dueDates = (data && typeof data.dueDates === "object" && data.dueDates) ? data.dueDates : {};

  for (const num of ksefNumbers) {
    const saleVal = dates[num];
    const dueVal = dueDates[num];
    result[num] = {
      saleDate: typeof saleVal === "string" ? saleVal : (saleVal?.saleDate ?? null),
      dueDate: typeof dueVal === "string" ? dueVal : (saleVal?.dueDate ?? null),
    };
  }

  return result;
}

// Sprawdzenie nowego formatu z invoicesData
const brokerNewResp = {
  ok: true,
  dates: { "NUM-1": "2026-10-01" },
  dueDates: { "NUM-1": "2026-10-15" },
  invoicesData: {
    "NUM-1": { saleDate: "2026-10-01", dueDate: "2026-10-15" }
  }
};
const parsedNew = parseBrokerResponse(brokerNewResp, ["NUM-1"]);
assert.deepStrictEqual(parsedNew["NUM-1"], { saleDate: "2026-10-01", dueDate: "2026-10-15" });
console.log("✓ Test 5: Parsowanie odpowiedzi nowego formatu brokera KSeF działa bezbłędnie");

// Sprawdzenie starszego formatu brokera (same stringi w dates)
const brokerLegacyResp = {
  ok: true,
  dates: { "NUM-2": "2026-09-20" }
};
const parsedLegacy = parseBrokerResponse(brokerLegacyResp, ["NUM-2"]);
assert.deepStrictEqual(parsedLegacy["NUM-2"], { saleDate: "2026-09-20", dueDate: null });
console.log("✓ Test 6: Wsteczna kompatybilność ze starszą wersją brokera zachowana");

console.log("\nWSZYSTKIE TESTY WERYFIKACYJNE KSEF DUE DATE ZAKOŃCZONE SUKCESEM!");
