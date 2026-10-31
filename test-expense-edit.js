// Testy walidacyjne dla opcji edycji kosztów (expenses)
const fs = require("fs");
const assert = require("assert");
const vm = require("vm");

console.log("Rozpoczynam testy weryfikacyjne dla edycji kosztów...");

// 1. Weryfikacja index.html
const html = fs.readFileSync("index.html", "utf-8");

assert(html.includes('id="expense-form-modal"'), "index.html musi zawierać modal #expense-form-modal");
assert(html.includes('id="expense-form"'), "index.html musi zawierać formularz #expense-form");
assert(html.includes('id="expense-form-title"'), "index.html musi zawierać nagłówek #expense-form-title");
assert(html.includes('id="exp-id"'), "index.html musi zawierać ukryte pole #exp-id");
assert(html.includes('id="exp-category"'), "index.html musi zawierać select kategorii #exp-category");
assert(html.includes('id="exp-amount"'), "index.html musi zawierać pole kwoty #exp-amount");
assert(html.includes('id="exp-month"'), "index.html musi zawierać pole miesiąca #exp-month");
assert(html.includes('id="exp-vehicle"'), "index.html musi zawierać select pojazdu #exp-vehicle");
assert(html.includes('id="exp-description"'), "index.html musi zawierać pole opisu #exp-description");
assert(html.includes('id="btn-save-expense"'), "index.html musi zawierać przycisk zapisu #btn-save-expense");
assert(html.includes('id="btn-cancel-expense-form"'), "index.html musi zawierać przycisk anulowania #btn-cancel-expense-form");
console.log("✓ Test 1: Struktura HTML dla modala edycji kosztów poprawna");

// 2. Weryfikacja app.js - sygnatury i mechanizm edycji
const js = fs.readFileSync("app.js", "utf-8");

assert(js.includes('data-expense-action="edit"'), "renderExpensesTable musi generować przycisk akcji data-expense-action=\"edit\"");
assert(js.includes("currentEditExpenseId"), "app.js musi deklarować currentEditExpenseId dla śledzenia edytowanego kosztu");
assert(js.includes("updateExpense"), "app.js musi posiadać funkcję updateExpense");
assert(js.includes("addExpense"), "app.js musi posiadać funkcję addExpense");
assert(js.includes("openExpenseForm"), "app.js musi posiadać funkcję openExpenseForm");
assert(js.includes("closeExpenseForm"), "app.js musi posiadać funkcję closeExpenseForm");
assert(js.includes('action === "edit"'), "Obsługa kliknięć w tabeli kosztów musi reagować na akcję edit");
console.log("✓ Test 2: Sygnatury i mechanizm edycji kosztów w app.js obecne");

// 3. Testy zachowania formularza i funkcji w środowisku VM
const mockElements = {
  "expense-form-modal": { classList: { add: () => {}, remove: () => {} }, addEventListener: () => {} },
  "expense-form-title": { textContent: "" },
  "btn-save-expense": { textContent: "" },
  "btn-cancel-expense-form": { addEventListener: () => {} },
  "err-exp-amount": { textContent: "" },
  "err-exp-month": { textContent: "" },
  "exp-id": { value: "" },
  "exp-category": { value: "" },
  "exp-amount": { value: "" },
  "exp-month": { value: "" },
  "exp-vehicle": { value: "" },
  "exp-description": { value: "" },
  "expense-form": { reset: () => {}, addEventListener: () => {} },
  "expenses-tbody": { addEventListener: () => {}, innerHTML: "" },
  "exp-filter-month": { value: "2026-09", addEventListener: () => {} },
  "exp-filter-vehicle": { value: "all", addEventListener: () => {} },
  "exp-search-input": { value: "", addEventListener: () => {} }
};

let capturedUpdateCall = null;
let capturedInsertCall = null;

const context = {
  window: {
    supabase: {
      createClient: () => ({
        auth: { onAuthStateChange: () => {}, getSession: () => Promise.resolve({ data: {} }) },
        from: (table) => ({
          select: () => ({ order: () => Promise.resolve({ data: [] }) }),
          update: (payload) => ({
            eq: (col, val) => {
              capturedUpdateCall = { table, payload, col, val };
              return Promise.resolve({ error: null });
            }
          }),
          insert: (payload) => {
            capturedInsertCall = { table, payload };
            return Promise.resolve({ error: null });
          },
          delete: () => ({ eq: () => Promise.resolve({ error: null }) })
        })
      })
    }
  },
  document: {
    getElementById: (id) => mockElements[id] || { addEventListener: () => {}, classList: { add: () => {}, remove: () => {} }, value: "", textContent: "" },
    querySelectorAll: () => []
  },
  module: { exports: {} },
  fetch: () => Promise.resolve({ json: () => Promise.resolve([]) })
};

vm.createContext(context);
vm.runInContext(js, context);
const { openExpenseForm, closeExpenseForm, updateExpense, addExpense } = context.module.exports;

// 4. Test otwierania formularza w trybie edycji istniejącego kosztu
const mockExpense = {
  id: 42,
  category: "serwis",
  amount: 850.50,
  expense_month: "2026-09",
  description: "Wymiana klocków hamulcowych",
  vehicle_id: 3,
  allocation_type: "vehicle"
};

openExpenseForm(mockExpense);

assert.strictEqual(mockElements["expense-form-title"].textContent, "Edytuj wydatek / koszt", "Tytuł modala powinien zmienić się na 'Edytuj wydatek / koszt'");
assert.strictEqual(mockElements["btn-save-expense"].textContent, "Zapisz zmiany", "Tekst przycisku zapisu powinien brzmieć 'Zapisz zmiany'");
assert.strictEqual(mockElements["exp-id"].value, 42, "ID kosztu musi zostać wpisane do ukrytego pola");
assert.strictEqual(mockElements["exp-category"].value, "serwis", "Kategoria powinna zostać załadowana");
assert.strictEqual(mockElements["exp-amount"].value, 850.50, "Kwota powinna zostać załadowana");
assert.strictEqual(mockElements["exp-month"].value, "2026-09", "Miesiąc powinien zostać załadowany");
assert.strictEqual(mockElements["exp-vehicle"].value, "3", "Przypisanie do pojazdu id=3 powinno zostać ustawione");
assert.strictEqual(mockElements["exp-description"].value, "Wymiana klocków hamulcowych", "Opis powinien zostać załadowany");
console.log("✓ Test 3: Wypełnianie pól formularza w trybie edycji działa poprawnie");

// 5. Test otwierania formularza w trybie dodawania (resetowanie i stan domyślny)
openExpenseForm(null);

assert.strictEqual(mockElements["expense-form-title"].textContent, "Dodaj wydatek / koszt", "Tytuł modala powinien zmienić się na 'Dodaj wydatek / koszt'");
assert.strictEqual(mockElements["btn-save-expense"].textContent, "Zapisz koszt", "Tekst przycisku powinien brzmieć 'Zapisz koszt'");
assert.strictEqual(mockElements["exp-id"].value, "", "ID kosztu powinno być puste");
assert.strictEqual(mockElements["exp-vehicle"].value, "unassigned", "Pojazd domyślnie 'unassigned'");
assert.strictEqual(mockElements["exp-month"].value, "2026-09", "Domyślny miesiąc pobrany z filtra");
console.log("✓ Test 4: Resetowanie pól formularza w trybie nowego kosztu działa poprawnie");

// 6. Test wywołania updateExpense z parametrami i aktualizacją Supabase
(async () => {
  const updatePayload = {
    category: "paliwo",
    amount: 1200.00,
    expense_month: "2026-10",
    description: "Tankowanie trasa DE",
    vehicle_id: 1,
    allocation_type: "vehicle"
  };

  const updateSuccess = await updateExpense(42, updatePayload);
  assert.strictEqual(updateSuccess, true, "updateExpense powinno zakończyć się sukcesem");
  assert.notStrictEqual(capturedUpdateCall, null, "Powinno nastąpić wywołanie update w Supabase");
  assert.strictEqual(capturedUpdateCall.table, "expenses", "Aktualizacja musi dotyczyć tabeli expenses");
  assert.strictEqual(capturedUpdateCall.col, "id", "Warunek eq musi dotyczyć id");
  assert.strictEqual(capturedUpdateCall.val, 42, "Zaktualizowany rekord musi mieć id=42");
  assert.deepStrictEqual(capturedUpdateCall.payload, updatePayload, "Payload musi odpowiadać przekazanym danym");
  console.log("✓ Test 5: updateExpense poprawnie aktualizuje bazę Supabase");

  // 7. Test wywołania addExpense
  const insertPayload = {
    category: "parking",
    amount: 60.00,
    expense_month: "2026-09",
    description: "Parking strzeżony",
    vehicle_id: null,
    allocation_type: "shared"
  };

  const insertSuccess = await addExpense(insertPayload);
  assert.strictEqual(insertSuccess, true, "addExpense powinno zakończyć się sukcesem");
  assert.notStrictEqual(capturedInsertCall, null, "Powinno nastąpić wywołanie insert w Supabase");
  assert.strictEqual(capturedInsertCall.table, "expenses");
  assert.deepStrictEqual(capturedInsertCall.payload, insertPayload);
  console.log("✓ Test 6: addExpense poprawnie tworzy rekord w bazie Supabase");

  console.log("\nWSZYSTKIE TESTY EDYCJI KOSZTÓW ZAKOŃCZONE SUKCESEM!");
})();
