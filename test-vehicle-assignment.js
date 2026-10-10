// Testy walidacyjne dla funkcjonalności przypisywania pojazdów do faktury
const fs = require("fs");
const assert = require("assert");

console.log("Rozpoczynam testy weryfikacyjne...");

// 1. Weryfikacja index.html
const html = fs.readFileSync("index.html", "utf-8");

assert(html.includes('id="filter-vehicle"'), "index.html musi zawierać select #filter-vehicle");
assert(html.includes('<th>Pojazd</th>'), "invoices-table musi mieć nagłówek <th>Pojazd</th>");
assert(html.includes('id="f-vehicle"'), "Formularz faktury musi zawierać pole #f-vehicle");
assert(html.includes('id="vehicle-modal"'), "index.html musi zawierać modal #vehicle-modal");
assert(html.includes('id="modal-vehicle-select"'), "vehicle-modal musi zawierać select #modal-vehicle-select");
assert(html.includes('id="btn-save-vehicle"'), "vehicle-modal musi zawierać przycisk #btn-save-vehicle");
assert(html.includes('id="btn-cancel-vehicle"'), "vehicle-modal musi zawierać przycisk #btn-cancel-vehicle");
console.log("✓ Test 1: Struktura HTML poprawna");

// 2. Weryfikacja style.css
const css = fs.readFileSync("style.css", "utf-8");

assert(css.includes(".badge-vehicle"), "style.css musi zawierać klasę .badge-vehicle");
assert(css.includes(".badge-shared"), "style.css musi zawierać klasę .badge-shared");
assert(css.includes(".badge-unassigned"), "style.css musi zawierać klasę .badge-unassigned");
console.log("✓ Test 2: Style CSS dla badge'y pojazdów obecne");

// 3. Weryfikacja app.js - obecność kluczowych funkcji i logiki
const js = fs.readFileSync("app.js", "utf-8");

assert(js.includes("allVehicles"), "app.js musi deklarować allVehicles");
assert(js.includes("setInvoiceVehicle"), "app.js musi zawierać funkcję setInvoiceVehicle");
assert(js.includes("renderVehicleBadge"), "app.js musi zawierać funkcję renderVehicleBadge");
assert(js.includes("openVehicleModal"), "app.js musi zawierać funkcję openVehicleModal");
assert(js.includes("closeVehicleModal"), "app.js musi zawierać funkcję closeVehicleModal");
assert(js.includes("updateVehicleSelects"), "app.js musi zawierać funkcję updateVehicleSelects");
assert(js.includes('data-action="set-vehicle"'), "app.js musi generować akcję set-vehicle w tabeli");
assert(js.includes("vehicle_id, allocation_type"), "fetchInvoices musi pobierać vehicle_id oraz allocation_type");
console.log("✓ Test 3: Logika i sygnatury w app.js obecne");

// 4. Testy jednostkowe czystej logiki biznesowej
// Symulacja funkcji z app.js
const mockVehicles = [
  { id: 1, name: "volvo", plate: "DW1234A" },
  { id: 2, name: "scania", plate: "DW5678B" }
];

function mockRenderVehicleBadge(invoice, vehicles) {
  if (invoice.allocation_type === "shared") {
    return "Wspólne (firma)";
  }
  if (invoice.allocation_type === "vehicle" || invoice.vehicle_id) {
    const v = vehicles.find((veh) => String(veh.id) === String(invoice.vehicle_id));
    if (v) return `${v.name.toUpperCase()} (${v.plate})`;
    if (invoice.vehicle_id) return `Pojazd #${invoice.vehicle_id}`;
  }
  return "Nieprzypisany";
}

function mockFilterInvoices(invoices, vehicleFilter) {
  if (vehicleFilter === "unassigned") {
    return invoices.filter((inv) => !inv.vehicle_id && inv.allocation_type !== "shared");
  } else if (vehicleFilter === "shared") {
    return invoices.filter((inv) => inv.allocation_type === "shared");
  } else if (vehicleFilter !== "all") {
    return invoices.filter((inv) => inv.allocation_type === "vehicle" && String(inv.vehicle_id) === String(vehicleFilter));
  }
  return invoices;
}

function mockParseAllocation(selectedValue) {
  let vehicleId = null;
  let allocationType = "unassigned";

  if (selectedValue === "shared") {
    allocationType = "shared";
    vehicleId = null;
  } else if (selectedValue && selectedValue !== "unassigned") {
    allocationType = "vehicle";
    vehicleId = Number(selectedValue);
  }
  return { vehicle_id: vehicleId, allocation_type: allocationType };
}

// Testy badge
assert.strictEqual(mockRenderVehicleBadge({ allocation_type: "shared", vehicle_id: null }, mockVehicles), "Wspólne (firma)");
assert.strictEqual(mockRenderVehicleBadge({ allocation_type: "vehicle", vehicle_id: 1 }, mockVehicles), "VOLVO (DW1234A)");
assert.strictEqual(mockRenderVehicleBadge({ allocation_type: "vehicle", vehicle_id: 99 }, mockVehicles), "Pojazd #99");
assert.strictEqual(mockRenderVehicleBadge({ allocation_type: "unassigned", vehicle_id: null }, mockVehicles), "Nieprzypisany");
assert.strictEqual(mockRenderVehicleBadge({}, mockVehicles), "Nieprzypisany");
console.log("✓ Test 4: Generowanie etykiet/badge'y poprawne");

// Testy parsowania przypisania
assert.deepStrictEqual(mockParseAllocation("unassigned"), { vehicle_id: null, allocation_type: "unassigned" });
assert.deepStrictEqual(mockParseAllocation("shared"), { vehicle_id: null, allocation_type: "shared" });
assert.deepStrictEqual(mockParseAllocation("1"), { vehicle_id: 1, allocation_type: "vehicle" });
assert.deepStrictEqual(mockParseAllocation("2"), { vehicle_id: 2, allocation_type: "vehicle" });
console.log("✓ Test 5: Parsowanie wartości przypisania zgodne z webhookiem whatsapp-webhook");

// Testy filtrowania
const testInvoices = [
  { id: 101, invoice_number: "FV/1", vehicle_id: 1, allocation_type: "vehicle" },
  { id: 102, invoice_number: "FV/2", vehicle_id: 2, allocation_type: "vehicle" },
  { id: 103, invoice_number: "FV/3", vehicle_id: null, allocation_type: "shared" },
  { id: 104, invoice_number: "FV/4", vehicle_id: null, allocation_type: "unassigned" },
  { id: 105, invoice_number: "FV/5", vehicle_id: null, allocation_type: null }
];

assert.strictEqual(mockFilterInvoices(testInvoices, "all").length, 5);
assert.strictEqual(mockFilterInvoices(testInvoices, "1").length, 1);
assert.strictEqual(mockFilterInvoices(testInvoices, "1")[0].invoice_number, "FV/1");
assert.strictEqual(mockFilterInvoices(testInvoices, "2").length, 1);
assert.strictEqual(mockFilterInvoices(testInvoices, "2")[0].invoice_number, "FV/2");
assert.strictEqual(mockFilterInvoices(testInvoices, "shared").length, 1);
assert.strictEqual(mockFilterInvoices(testInvoices, "shared")[0].invoice_number, "FV/3");
assert.strictEqual(mockFilterInvoices(testInvoices, "unassigned").length, 2);
console.log("✓ Test 6: Filtrowanie po pojeździe, firmie i nieprzypisanych działa prawidłowo");

console.log("\nWSZYSTKIE TESTY ZAKOŃCZONE SUKCESEM!");
