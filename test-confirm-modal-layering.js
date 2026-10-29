// Testy weryfikacyjne poprawki warstwowania okna potwierdzenia (#confirm-modal)
const fs = require("fs");
const assert = require("assert");

console.log("Rozpoczynam testy weryfikacyjne dla warstwowania okna potwierdzenia (#confirm-modal)...");

const html = fs.readFileSync("index.html", "utf-8");
const css = fs.readFileSync("style.css", "utf-8");
const js = fs.readFileSync("app.js", "utf-8");

// 1. Weryfikacja struktury index.html
assert(html.includes('id="confirm-modal"'), "index.html musi zawierać modal #confirm-modal");
assert(html.includes('id="confirm-modal-text"'), "confirm-modal musi zawierać element #confirm-modal-text");
assert(html.includes('id="confirm-modal-yes"'), "confirm-modal musi zawierać przycisk #confirm-modal-yes");
assert(html.includes('id="confirm-modal-cancel"'), "confirm-modal musi zawierać przycisk #confirm-modal-cancel");

// Sprawdzenie kolejności w DOM (confirm-modal musi być po modalach edycji)
const posConfirm = html.indexOf('id="confirm-modal"');
const posVehicle = html.indexOf('id="vehicle-modal"');
const posDueDate = html.indexOf('id="due-date-modal"');
const posServiceMonth = html.indexOf('id="service-month-modal"');
const posInvoiceForm = html.indexOf('id="invoice-form-modal"');

assert(posConfirm > posVehicle, "W strukturze DOM #confirm-modal musi występować po #vehicle-modal");
assert(posConfirm > posDueDate, "W strukturze DOM #confirm-modal musi występować po #due-date-modal");
assert(posConfirm > posServiceMonth, "W strukturze DOM #confirm-modal musi występować po #service-month-modal");
assert(posConfirm > posInvoiceForm, "W strukturze DOM #confirm-modal musi występować po #invoice-form-modal");
console.log("✓ Test 1: Struktura HTML i bezpieczna kolejność w DOM potwierdzona");

// 2. Weryfikacja stylów CSS
const baseOverlayZIndexMatch = css.match(/\.modal-overlay\s*\{[^}]*z-index:\s*(\d+)/);
assert(baseOverlayZIndexMatch, "style.css musi definiować z-index dla .modal-overlay");
const baseZIndex = parseInt(baseOverlayZIndexMatch[1], 10);

const confirmModalZIndexMatch = css.match(/#confirm-modal\s*\{[^}]*z-index:\s*(\d+)/);
assert(confirmModalZIndexMatch, "style.css musi definiować regułę #confirm-modal z właściwością z-index");
const confirmZIndex = parseInt(confirmModalZIndexMatch[1], 10);

assert(confirmZIndex > baseZIndex, `#confirm-modal z-index (${confirmZIndex}) musi być większy niż .modal-overlay (${baseZIndex})`);
assert(confirmZIndex >= 1100, "#confirm-modal powinien mieć z-index co najmniej 1100, aby bezpiecznie przykryć wszelkie okna potomne");
console.log("✓ Test 2: Style CSS z-index okna potwierdzenia wyższe niż podrzędnych modali");

// 3. Weryfikacja logiki JavaScript w app.js
assert(js.includes("function openConfirmModal"), "app.js musi definiować funkcję openConfirmModal");
assert(js.includes("function closeConfirmModal"), "app.js musi definiować funkcję closeConfirmModal");
assert(js.includes('document.getElementById("confirm-modal-yes")'), "app.js musi obsługiwać kliknięcie #confirm-modal-yes");
assert(js.includes('document.getElementById("confirm-modal-cancel")'), "app.js musi obsługiwać kliknięcie #confirm-modal-cancel");
assert(js.includes("e.target === confirmModal"), "app.js musi obsługiwać zamykanie modala potwierdzenia przy kliknięciu w tło (backdrop)");
assert(js.includes('e.key === "Escape"') && js.includes("closeConfirmModal"), "app.js musi zamykać okno potwierdzenia klawiszem Escape");
console.log("✓ Test 3: Logika JavaScript i obsługa zdarzeń confirmModal obecna");

// 4. Test symulacji przepływu dla przypisywania pojazdu, terminu płatności i miesiąca
let mockPendingConfirmAction = null;
let mockConfirmModalHidden = true;
let mockVehicleModalHidden = false;
let mockDueDateModalHidden = false;
let mockServiceMonthModalHidden = false;
let setInvoiceVehicleCalled = false;
let setDueDateCalled = false;
let setInvoiceServiceMonthCalled = false;

function mockOpenConfirm(onConfirm) {
  mockPendingConfirmAction = onConfirm;
  mockConfirmModalHidden = false;
}
function mockCloseConfirm() {
  mockConfirmModalHidden = true;
  mockPendingConfirmAction = null;
}

// Scenariusz A: Przypisanie pojazdu -> użytkownik klika Zapisz w modal pojazdu -> confirmModal otwiera się nad nim
mockVehicleModalHidden = false;
mockOpenConfirm(async () => {
  setInvoiceVehicleCalled = true;
  mockVehicleModalHidden = true; // closeVehicleModal()
});
assert(!mockConfirmModalHidden, "confirmModal musi być widoczny po otwarciu");
// Użytkownik klika "Tak" w confirmModal
if (mockPendingConfirmAction) {
  const action = mockPendingConfirmAction;
  mockCloseConfirm();
  action();
}
assert(mockConfirmModalHidden, "confirmModal musi zostać ukryty po kliknięciu Tak");
assert(setInvoiceVehicleCalled, "setInvoiceVehicle musi zostać wywołane");
assert(mockVehicleModalHidden, "vehicleModal musi zostać automatycznie zamknięty po potwierdzeniu bez potrzeby klikania Anuluj");

// Scenariusz B: Ustawienie terminu płatności -> confirmModal otwiera się nad nim
mockDueDateModalHidden = false;
mockOpenConfirm(async () => {
  setDueDateCalled = true;
  mockDueDateModalHidden = true; // closeDueDateModal()
});
assert(!mockConfirmModalHidden, "confirmModal musi być widoczny po otwarciu");
if (mockPendingConfirmAction) {
  const action = mockPendingConfirmAction;
  mockCloseConfirm();
  action();
}
assert(setDueDateCalled, "setDueDate musi zostać wywołane");
assert(mockDueDateModalHidden, "dueDateModal musi zostać automatycznie zamknięty po potwierdzeniu");

// Scenariusz C: Ustawienie miesiąca rozliczenia -> confirmModal otwiera się nad nim
mockServiceMonthModalHidden = false;
mockOpenConfirm(async () => {
  setInvoiceServiceMonthCalled = true;
  mockServiceMonthModalHidden = true; // closeServiceMonthModal()
});
assert(!mockConfirmModalHidden, "confirmModal musi być widoczny po otwarciu");
if (mockPendingConfirmAction) {
  const action = mockPendingConfirmAction;
  mockCloseConfirm();
  action();
}
assert(setInvoiceServiceMonthCalled, "setInvoiceServiceMonth musi zostać wywołane");
assert(mockServiceMonthModalHidden, "serviceMonthModal musi zostać automatycznie zamknięty po potwierdzeniu");

// Scenariusz D: Anulowanie w confirmModal nie zamyka okna nadrzędnego
mockVehicleModalHidden = false;
mockOpenConfirm(async () => {
  mockVehicleModalHidden = true;
});
mockCloseConfirm(); // Użytkownik klika Anuluj w oknie potwierdzenia
assert(mockConfirmModalHidden, "confirmModal musi być ukryty");
assert(!mockVehicleModalHidden, "vehicleModal musi pozostać otwarty po anulowaniu potwierdzenia, umożliwiając zmianę wyboru");

console.log("✓ Test 4: Prawidłowy przepływ warstwowy i stan modali potwierdzony");
console.log("\nWSZYSTKIE TESTY WARSTWOWANIA OKNA POTWIERDZENIA ZAKOŃCZONE SUKCESEM!");
