// =========================================================================
// KONFIGURACJA SUPABASE
// =========================================================================
// TODO: uzupelnic przed wdrozeniem
const SUPABASE_URL = "https://ncjttizrnukovuotrowp.supabase.co";
// TODO: uzupelnic przed wdrozeniem
const SUPABASE_ANON_KEY = "sb_publishable_wtxfaXXPywMenu46Ea5KHQ_n33G9u4w";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TABLE_NAME = "invoices";

let allInvoices = [];
let allVehicles = [];
let currentEditInvoiceId = null;
let currentDueDateInvoiceId = null;
let currentVehicleInvoiceId = null;
let currentServiceMonthInvoiceId = null;
let pendingConfirmAction = null;

// =========================================================================
// ELEMENTY DOM - FAKTURY
// =========================================================================
const globalStatusEl = document.getElementById("global-status");
const searchInputEl = document.getElementById("search-input");
const filterStatusEl = document.getElementById("filter-status");
const filterVehicleEl = document.getElementById("filter-vehicle");
const sortSelectEl = document.getElementById("sort-select");
const tbodyEl = document.getElementById("invoices-tbody");

const invoiceFormModal = document.getElementById("invoice-form-modal");
const invoiceForm = document.getElementById("invoice-form");
const invoiceFormTitle = document.getElementById("invoice-form-title");
const fVehicleSelect = document.getElementById("f-vehicle");

const confirmModal = document.getElementById("confirm-modal");
const confirmModalText = document.getElementById("confirm-modal-text");

const dueDateModal = document.getElementById("due-date-modal");

const vehicleModal = document.getElementById("vehicle-modal");
const vehicleModalInvoiceLabel = document.getElementById("vehicle-modal-invoice-label");
const modalVehicleSelect = document.getElementById("modal-vehicle-select");
const errVehicleModal = document.getElementById("err-vehicle-modal");
const btnSaveVehicle = document.getElementById("btn-save-vehicle");
const btnCancelVehicle = document.getElementById("btn-cancel-vehicle");

const serviceMonthModal = document.getElementById("service-month-modal");
const serviceMonthModalInvoiceLabel = document.getElementById("service-month-modal-invoice-label");
const modalServiceMonthSelect = document.getElementById("modal-service-month-select");
const modalServiceMonthCustom = document.getElementById("modal-service-month-custom");
const errServiceMonthModal = document.getElementById("err-service-month-modal");
const btnSaveServiceMonth = document.getElementById("btn-save-service-month");
const btnCancelServiceMonth = document.getElementById("btn-cancel-service-month");

const btnOpenOrdersUpload = document.getElementById("btn-open-orders-upload");
const ordersModal = document.getElementById("orders-modal");
const ordersDropZone = document.getElementById("orders-drop-zone");
const ordersFilesInput = document.getElementById("orders-files-input");
const ordersPreviewContainer = document.getElementById("orders-preview-container");
const ordersPreviewCount = document.getElementById("orders-preview-count");
const ordersPreviewTbody = document.getElementById("orders-preview-tbody");
const btnSaveOrdersBatch = document.getElementById("btn-save-orders-batch");
const btnCancelOrdersModal = document.getElementById("btn-cancel-orders-modal");
const errOrdersModal = document.getElementById("err-orders-modal");

let parsedOrdersQueue = [];
let targetOrderInvoiceId = null;

if (typeof pdfjsLib !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const resultsView = document.getElementById("results-view");
const rulesView = document.getElementById("rules-view");
const rulesStatusEl = document.getElementById("rules-status");
const mainNav = document.getElementById("main-nav");
const loginForm = document.getElementById("login-form");
const loginErrorEl = document.getElementById("login-error");
const btnLogout = document.getElementById("btn-logout");

// =========================================================================
// AUTORYZACJA (Supabase Auth)
// =========================================================================
function renderAuthState(session) {
  const expensesView = document.getElementById("expenses-view");
  const driversView = document.getElementById("drivers-view");
  const vehiclesView = document.getElementById("vehicles-view");

  if (session) {
    loginView.classList.add("hidden");
    appView.classList.remove("hidden");
    mainNav.classList.remove("hidden");
    btnLogout.classList.remove("hidden");
  } else {
    loginView.classList.remove("hidden");
    appView.classList.add("hidden");
    resultsView.classList.add("hidden");
    rulesView.classList.add("hidden");
    if (expensesView) expensesView.classList.add("hidden");
    if (driversView) driversView.classList.add("hidden");
    if (vehiclesView) vehiclesView.classList.add("hidden");
    mainNav.classList.add("hidden");
    btnLogout.classList.add("hidden");
  }
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginErrorEl.textContent = "";

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  if (!email || !password) {
    loginErrorEl.textContent = "Podaj e-mail i hasło.";
    return;
  }

  showLoading("Logowanie...");
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    clearStatus();
    loginForm.reset();
    renderAuthState(data.session);
    await loadVehiclesAndDrivers();
    await fetchInvoices();
  } catch (err) {
    console.error(err);
    clearStatus();
    loginErrorEl.textContent = "Nieprawidłowy e-mail lub hasło.";
  }
});

btnLogout.addEventListener("click", async () => {
  showLoading("Wylogowywanie...");
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    clearStatus();
    renderAuthState(null);
  } catch (err) {
    console.error(err);
    showError("Nie udało się wylogować — sprawdź połączenie.");
  }
});

supabaseClient.auth.onAuthStateChange((_event, session) => {
  renderAuthState(session);
});

// =========================================================================
// NAWIGACJA GLOWNA
// =========================================================================
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.dataset.target;

    const allViews = [
      appView,
      resultsView,
      rulesView,
      document.getElementById("expenses-view"),
      document.getElementById("drivers-view"),
      document.getElementById("vehicles-view")
    ].filter(Boolean);

    allViews.forEach((v) => {
      v.classList.toggle("hidden", v.id !== target);
    });

    if (target === "rules-view") loadRulesView();
    else if (target === "expenses-view") loadExpensesView();
    else if (target === "drivers-view") loadDriversView();
    else if (target === "vehicles-view") loadVehiclesView();
    else if (target === "results-view") initResultsView();
    else if (target === "app-view") fetchInvoices();
  });
});

// Nawigacja pod-zakladek wewnatrz sekcji
document.querySelectorAll(".sub-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const parentContainer = btn.closest(".container") || document;
    const parentNav = btn.closest(".sub-tabs") || parentContainer;
    parentNav.querySelectorAll(".sub-tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.dataset.subtarget;
    parentContainer.querySelectorAll(".sub-panel").forEach((panel) => {
      panel.classList.toggle("hidden", panel.id !== target);
    });
  });
});

// =========================================================================
// FUNKCJE POMOCNICZE - STATUS / BLEDY
// =========================================================================
function showLoading(message) {
  globalStatusEl.textContent = message || "Wczytywanie...";
  globalStatusEl.className = "status-bar loading";
}

function showError(message) {
  globalStatusEl.textContent = message;
  globalStatusEl.className = "status-bar error";
}

function clearStatus() {
  globalStatusEl.textContent = "";
  globalStatusEl.className = "status-bar";
}

function showResultsLoading(message) {
  const el = document.getElementById("results-status");
  el.textContent = message || "Wczytywanie...";
  el.className = "status-bar loading";
}

function showResultsError(message) {
  const el = document.getElementById("results-status");
  el.textContent = message;
  el.className = "status-bar error";
}

function clearResultsStatus() {
  const el = document.getElementById("results-status");
  el.textContent = "";
  el.className = "status-bar";
}

function formatAmount(value, currency) {
  const num = Number(value);
  if (Number.isNaN(num)) return "-";
  return num.toFixed(2) + " " + (currency || "");
}

// =========================================================================
// WALIDACJA FORMULARZA FAKTURY
// =========================================================================
function clearFormErrors() {
  document.querySelectorAll(".error-msg").forEach((el) => (el.textContent = ""));
}

function setFieldError(fieldId, message) {
  const errEl = document.getElementById("err-" + fieldId);
  if (errEl) errEl.textContent = message;
}

function isValidDateFormat(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidAmount(value) {
  return /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0;
}

function isValidNip(value) {
  return /^\d{10}$/.test(value);
}

function validateInvoiceForm(data) {
  clearFormErrors();
  let isValid = true;

  if (!data.invoice_number.trim()) {
    setFieldError("invoice-number", "Numer faktury jest wymagany.");
    isValid = false;
  }
  if (!data.seller_name.trim()) {
    setFieldError("seller-name", "Sprzedawca jest wymagany.");
    isValid = false;
  }
  if (!isValidNip(data.seller_nip)) {
    setFieldError("seller-nip", "NIP musi składać się z 10 cyfr.");
    isValid = false;
  }
  if (!isValidDateFormat(data.issue_date)) {
    setFieldError("issue-date", "Podaj poprawną datę w formacie RRRR-MM-DD.");
    isValid = false;
  }
  if (!isValidDateFormat(data.due_date)) {
    setFieldError("due-date", "Podaj poprawną datę w formacie RRRR-MM-DD.");
    isValid = false;
  }
  if (!isValidAmount(data.net_amount)) {
    setFieldError("net-amount", "Kwota netto musi być liczbą dodatnią (max. 2 miejsca po przecinku).");
    isValid = false;
  }
  if (!isValidAmount(data.gross_amount)) {
    setFieldError("gross-amount", "Kwota brutto musi być liczbą dodatnią (max. 2 miejsca po przecinku).");
    isValid = false;
  }
  if (data.service_month && !/^\d{4}-\d{2}$/.test(data.service_month)) {
    setFieldError("service-month", "Podaj poprawny miesiąc w formacie RRRR-MM (np. 2026-09).");
    isValid = false;
  }

  return isValid;
}

// =========================================================================
// FUNKCJE CRUD - FAKTURY
// =========================================================================
async function fetchInvoices() {
  showLoading("Wczytywanie faktur...");
  try {
    const { data, error } = await supabaseClient
      .from(TABLE_NAME)
      .select(
        "id, invoice_number, ksef_number, seller_name, seller_nip, issue_date, due_date, net_amount, gross_amount, currency, paid, vehicle_id, allocation_type, service_month, order_number, order_file_url, order_file_name"
      );

    if (error) throw error;

    allInvoices = data || [];
    applyFiltersAndRender();
    clearStatus();
  } catch (err) {
    console.error(err);
    showError("Nie udało się wczytać faktur — sprawdź połączenie.");
  }
}

function applyFiltersAndRender() {
  const term = searchInputEl.value.trim().toLowerCase();
  const statusFilter = filterStatusEl.value;
  const vehicleFilter = filterVehicleEl ? filterVehicleEl.value : "all";
  const sortMode = sortSelectEl.value;

  let list = [...allInvoices];

  if (term) {
    list = list.filter((inv) => {
      const seller = (inv.seller_name || "").toLowerCase();
      const nip = (inv.seller_nip || "").toLowerCase();
      return seller.includes(term) || nip.includes(term);
    });
  }

  if (statusFilter === "paid") {
    list = list.filter((inv) => inv.paid === true);
  } else if (statusFilter === "unpaid") {
    list = list.filter((inv) => inv.paid !== true);
  } else if (statusFilter === "urgent") {
    const now = new Date();
    now.setDate(now.getDate() + 3);
    const targetIso = now.toISOString().split("T")[0];
    list = list.filter((inv) => inv.paid !== true && inv.due_date && inv.due_date <= targetIso);
  }

  if (vehicleFilter === "unassigned") {
    list = list.filter((inv) => !inv.vehicle_id && inv.allocation_type !== "shared");
  } else if (vehicleFilter === "shared") {
    list = list.filter((inv) => inv.allocation_type === "shared");
  } else if (vehicleFilter !== "all") {
    list = list.filter((inv) => inv.allocation_type === "vehicle" && String(inv.vehicle_id) === String(vehicleFilter));
  }

  if (sortMode === "newest") {
    list.sort((a, b) => (b.issue_date || "").localeCompare(a.issue_date || ""));
  } else if (sortMode === "oldest") {
    list.sort((a, b) => (a.issue_date || "").localeCompare(b.issue_date || ""));
  } else if (sortMode === "due-soonest") {
    list.sort((a, b) => (a.due_date || "9999-99-99").localeCompare(b.due_date || "9999-99-99"));
  }

  renderTable(list);
}

async function addInvoice(invoiceData) {
  showLoading("Zapisywanie faktury...");
  try {
    const { error } = await supabaseClient.from(TABLE_NAME).insert([invoiceData]);
    if (error) throw error;
    clearStatus();
    await fetchInvoices();
    return true;
  } catch (err) {
    console.error(err);
    showError("Nie udało się zapisać faktury — sprawdź połączenie.");
    return false;
  }
}

async function updateInvoice(id, invoiceData) {
  showLoading("Zapisywanie zmian...");
  try {
    const { error } = await supabaseClient.from(TABLE_NAME).update(invoiceData).eq("id", id);
    if (error) throw error;
    clearStatus();
    await fetchInvoices();
    return true;
  } catch (err) {
    console.error(err);
    showError("Nie udało się zapisać zmian — sprawdź połączenie.");
    return false;
  }
}

async function togglePaymentStatus(id, newPaidValue) {
  showLoading("Aktualizowanie statusu...");
  try {
    const { error } = await supabaseClient.from(TABLE_NAME).update({ paid: newPaidValue }).eq("id", id);
    if (error) throw error;
    clearStatus();
    await fetchInvoices();
  } catch (err) {
    console.error(err);
    showError("Nie udało się zmienić statusu — sprawdź połączenie.");
  }
}

async function setDueDate(id, dueDateValue, paymentDaysValue) {
  showLoading("Zapisywanie terminu płatności...");
  try {
    const updatePayload = { due_date: dueDateValue };
    if (paymentDaysValue !== null && paymentDaysValue !== undefined) {
      updatePayload.payment_days = paymentDaysValue;
    }
    const { error } = await supabaseClient.from(TABLE_NAME).update(updatePayload).eq("id", id);
    if (error) throw error;
    clearStatus();
    await fetchInvoices();
  } catch (err) {
    console.error(err);
    showError("Nie udało się zapisać terminu płatności — sprawdź połączenie.");
  }
}

async function setInvoiceVehicle(id, allocationValue) {
  showLoading("Zapisywanie przypisania pojazdu...");
  try {
    let vehicleId = null;
    let allocationType = "unassigned";

    if (allocationValue === "shared") {
      allocationType = "shared";
      vehicleId = null;
    } else if (allocationValue && allocationValue !== "unassigned") {
      allocationType = "vehicle";
      vehicleId = Number(allocationValue);
    }

    const { error } = await supabaseClient
      .from(TABLE_NAME)
      .update({
        vehicle_id: vehicleId,
        allocation_type: allocationType,
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    if (error) throw error;
    clearStatus();
    await fetchInvoices();
    return true;
  } catch (err) {
    console.error(err);
    showError("Nie udało się zapisać przypisania pojazdu — sprawdź połączenie.");
    return false;
  }
}

async function setInvoiceServiceMonth(id, serviceMonthValue) {
  showLoading("Zapisywanie miesiąca rozliczenia...");
  try {
    const formatted = serviceMonthValue ? String(serviceMonthValue).trim() : null;
    const { error } = await supabaseClient
      .from(TABLE_NAME)
      .update({
        service_month: formatted,
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    if (error) throw error;
    clearStatus();
    await fetchInvoices();
    return true;
  } catch (err) {
    console.error(err);
    showError("Nie udało się zapisać miesiąca rozliczenia — sprawdź połączenie.");
    return false;
  }
}

// =========================================================================
// RENDEROWANIE TABELI FAKTUR
// =========================================================================
function renderVehicleBadge(invoice) {
  if (invoice.allocation_type === "shared") {
    return `<span class="badge badge-shared">Wspólne (firma)</span>`;
  }
  if (invoice.allocation_type === "vehicle" || invoice.vehicle_id) {
    const v = allVehicles.find((veh) => String(veh.id) === String(invoice.vehicle_id));
    if (v) {
      return `<span class="badge badge-vehicle">${escapeHtml(v.name.toUpperCase())} (${escapeHtml(v.plate)})</span>`;
    }
    if (invoice.vehicle_id) {
      return `<span class="badge badge-vehicle">Pojazd #${invoice.vehicle_id}</span>`;
    }
  }
  return `<span class="badge badge-unassigned">Nieprzypisany</span>`;
}

function renderOrderCell(invoice) {
  const num = invoice.order_number ? escapeHtml(invoice.order_number) : "";
  const hasFile = Boolean(invoice.order_file_url);
  const fileName = invoice.order_file_name || "Zlecenie";

  if (hasFile) {
    return `
      <div class="order-cell-content">
        ${num ? `<span class="badge badge-order" title="Nr zlecenia: ${num}">📄 ${num}</span>` : ""}
        <button type="button" class="btn btn-secondary btn-small" data-action="view-order" data-id="${invoice.id}" title="Pobierz/zobacz plik: ${escapeHtml(fileName)}">
          📎 Pobierz
        </button>
      </div>
    `;
  }

  if (num) {
    return `
      <div class="order-cell-content">
        <span class="badge badge-order" title="Nr zlecenia z KSeF: ${num}">📄 ${num}</span>
        <button type="button" class="btn btn-secondary btn-small" data-action="attach-order" data-id="${invoice.id}" title="Dołącz plik PDF/DOCX do tego zlecenia">
          + Plik
        </button>
      </div>
    `;
  }

  return `
    <div class="order-cell-content">
      <span class="order-empty">-</span>
      <button type="button" class="btn btn-secondary btn-small" data-action="attach-order" data-id="${invoice.id}" title="Dołącz zlecenie (PDF/DOCX)">
        + Zlecenie
      </button>
    </div>
  `;
}

function renderTable(invoices) {
  tbodyEl.innerHTML = "";

  if (!invoices.length) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = `<td colspan="13" style="text-align:center; color:#6b7280;">Brak faktur do wyświetlenia.</td>`;
    tbodyEl.appendChild(emptyRow);
    return;
  }

  invoices.forEach((invoice) => {
    const tr = document.createElement("tr");

    const now = new Date();
    now.setDate(now.getDate() + 3);
    const targetIso = now.toISOString().split("T")[0];
    const isUrgent = !invoice.paid && invoice.due_date && invoice.due_date <= targetIso;

    const statusBadge = invoice.paid
      ? `<span class="badge badge-paid">Opłacona</span>`
      : (isUrgent
          ? `<span class="badge badge-urgent" title="Termin płatności: ${escapeHtml(invoice.due_date)}">🔥 Pilna</span>`
          : `<span class="badge badge-unpaid">Nieopłacona</span>`);

    const calIcon = `<svg class="cal-mini-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>`;

    tr.className = "invoice-row";
    tr.innerHTML = `
      <td class="col-number" data-label="Numer faktury">
        <span class="inv-number-title">${escapeHtml(invoice.invoice_number || "-")}</span>
        ${invoice.order_number ? `
          <div class="inv-order-pill" title="Numer zlecenia: ${escapeHtml(invoice.order_number)}">
            <span class="inv-order-tag">ZLEC:</span>
            <span class="inv-order-code">${escapeHtml(invoice.order_number)}</span>
            ${invoice.order_file_url ? `<button type="button" class="btn-order-file-mini" data-action="view-order" data-id="${invoice.id}" title="Pobierz plik zlecenia: ${escapeHtml(invoice.order_file_name || 'Zlecenie')}">📎</button>` : ""}
          </div>
        ` : ""}
      </td>
      <td class="col-ksef" data-label="Numer KSeF">
        ${invoice.ksef_number ? `<span class="ksef-pill" title="${escapeHtml(invoice.ksef_number)}"><span class="ksef-tag">KSeF</span><span class="ksef-code">${escapeHtml(invoice.ksef_number)}</span></span>` : `<span class="ksef-empty">-</span>`}
      </td>
      <td class="col-order" data-label="Zlecenie">
        ${renderOrderCell(invoice)}
      </td>
      <td class="col-seller" data-label="Sprzedawca">
        <div class="seller-card-group">
          <span class="seller-title">${escapeHtml(invoice.seller_name || "-")}</span>
          <span class="seller-nip-sub">NIP: ${escapeHtml(invoice.seller_nip || "-")}</span>
        </div>
      </td>
      <td class="col-nip" data-label="NIP">${escapeHtml(invoice.seller_nip || "-")}</td>
      <td class="col-issue-date" data-label="Data wystawienia">
        <div class="date-chip-wrapper">
          <span class="date-chip" title="Data wystawienia">
            ${calIcon}
            <span class="date-chip-label">Wyst.:</span>
            <span class="date-chip-val">${invoice.issue_date || "-"}</span>
          </span>
          ${invoice.service_month ? `<span class="badge badge-service-month" title="Przypisano do miesiąca: ${escapeHtml(invoice.service_month)}">Rozl.: ${escapeHtml(invoice.service_month)}</span>` : ""}
        </div>
      </td>
      <td class="col-due-date" data-label="Termin płatności">
        <span class="date-chip ${isUrgent ? 'urgent' : ''}" title="Termin płatności">
          ${calIcon}
          <span class="date-chip-label">Termin:</span>
          <span class="date-chip-val">${invoice.due_date || "-"}</span>
        </span>
      </td>
      <td class="col-net" data-label="Netto">
        <span class="amount-sublabel">Netto</span>
        <span class="net-amount-val">${formatAmount(invoice.net_amount, invoice.currency)}</span>
      </td>
      <td class="col-gross" data-label="Brutto">
        <span class="amount-sublabel">Brutto</span>
        <span class="gross-amount-val">${formatAmount(invoice.gross_amount, invoice.currency)}</span>
      </td>
      <td class="col-currency" data-label="Waluta">${escapeHtml(invoice.currency || "-")}</td>
      <td class="col-status" data-label="Status">${statusBadge}</td>
      <td class="col-vehicle" data-label="Pojazd">${renderVehicleBadge(invoice)}</td>
      <td class="col-actions" data-label="Akcje">
        <div class="row-actions">
          <button class="btn btn-secondary btn-small" data-action="set-vehicle" data-id="${invoice.id}">Pojazd</button>
          <button class="btn btn-secondary btn-small" data-action="set-service-month" data-id="${invoice.id}">Miesiąc</button>
          <button class="btn btn-secondary btn-small" data-action="edit" data-id="${invoice.id}">Edytuj</button>
          <button class="btn btn-secondary btn-small" data-action="toggle-status" data-id="${invoice.id}" data-paid="${invoice.paid}">
            ${invoice.paid ? "Oznacz jako nieopłaconą" : "Oznacz jako opłaconą"}
          </button>
          <button class="btn btn-secondary btn-small" data-action="set-due-date" data-id="${invoice.id}">Termin płatności</button>
        </div>
      </td>
    `;

    tbodyEl.appendChild(tr);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// =========================================================================
// OBSLUGA WYSZUKIWANIA, FILTROWANIA I SORTOWANIA (FAKTURY)
// =========================================================================
searchInputEl.addEventListener("input", applyFiltersAndRender);
filterStatusEl.addEventListener("change", applyFiltersAndRender);
if (filterVehicleEl) filterVehicleEl.addEventListener("change", applyFiltersAndRender);
sortSelectEl.addEventListener("change", applyFiltersAndRender);

// =========================================================================
// MODAL DODAJ/EDYTUJ FAKTURE
// =========================================================================
document.getElementById("btn-open-add").addEventListener("click", () => {
  openInvoiceForm(null);
});

document.getElementById("btn-cancel-form").addEventListener("click", closeInvoiceForm);

function openInvoiceForm(invoice) {
  clearFormErrors();
  currentEditInvoiceId = invoice ? invoice.id : null;
  invoiceFormTitle.textContent = invoice ? "Edytuj fakturę" : "Dodaj fakturę";

  document.getElementById("f-invoice-number").value = invoice ? invoice.invoice_number || "" : "";
  document.getElementById("f-ksef-number").value = invoice ? invoice.ksef_number || "" : "";
  document.getElementById("f-seller-name").value = invoice ? invoice.seller_name || "" : "";
  document.getElementById("f-seller-nip").value = invoice ? invoice.seller_nip || "" : "";
  document.getElementById("f-issue-date").value = invoice ? invoice.issue_date || "" : "";
  document.getElementById("f-due-date").value = invoice ? invoice.due_date || "" : "";
  document.getElementById("f-net-amount").value = invoice ? invoice.net_amount || "" : "";
  document.getElementById("f-gross-amount").value = invoice ? invoice.gross_amount || "" : "";
  document.getElementById("f-currency").value = invoice ? invoice.currency || "PLN" : "PLN";
  document.getElementById("f-paid").value = invoice ? String(!!invoice.paid) : "false";

  if (fVehicleSelect) {
    if (!invoice || (!invoice.vehicle_id && invoice.allocation_type !== "shared")) {
      fVehicleSelect.value = "unassigned";
    } else if (invoice.allocation_type === "shared") {
      fVehicleSelect.value = "shared";
    } else {
      fVehicleSelect.value = String(invoice.vehicle_id);
    }
  }

  const fServiceMonth = document.getElementById("f-service-month");
  if (fServiceMonth) {
    fServiceMonth.value = invoice ? invoice.service_month || "" : "";
  }

  const fOrderNumber = document.getElementById("f-order-number");
  if (fOrderNumber) {
    fOrderNumber.value = invoice ? invoice.order_number || "" : "";
  }

  updateNbpPreview();
  invoiceFormModal.classList.remove("hidden");
}

function closeInvoiceForm() {
  invoiceFormModal.classList.add("hidden");
  invoiceForm.reset();
  clearFormErrors();
  currentEditInvoiceId = null;
}

invoiceForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const serviceMonthRaw = document.getElementById("f-service-month")
    ? document.getElementById("f-service-month").value.trim()
    : "";

  const orderNumberRaw = document.getElementById("f-order-number")
    ? document.getElementById("f-order-number").value.trim()
    : "";

  const formData = {
    invoice_number: document.getElementById("f-invoice-number").value,
    ksef_number: document.getElementById("f-ksef-number").value || null,
    order_number: orderNumberRaw || null,
    seller_name: document.getElementById("f-seller-name").value,
    seller_nip: document.getElementById("f-seller-nip").value,
    issue_date: document.getElementById("f-issue-date").value,
    due_date: document.getElementById("f-due-date").value,
    net_amount: document.getElementById("f-net-amount").value,
    gross_amount: document.getElementById("f-gross-amount").value,
    currency: document.getElementById("f-currency").value,
    paid: document.getElementById("f-paid").value === "true",
    service_month: serviceMonthRaw || null
  };

  if (!validateInvoiceForm(formData)) return;

  let vehicleId = null;
  let allocationType = "unassigned";
  if (fVehicleSelect) {
    const selectedVehicle = fVehicleSelect.value;
    if (selectedVehicle === "shared") {
      allocationType = "shared";
    } else if (selectedVehicle && selectedVehicle !== "unassigned") {
      allocationType = "vehicle";
      vehicleId = Number(selectedVehicle);
    }
  }

  const payload = {
    invoice_number: formData.invoice_number.trim(),
    ksef_number: formData.ksef_number ? formData.ksef_number.trim() : null,
    seller_name: formData.seller_name.trim(),
    seller_nip: formData.seller_nip.trim(),
    issue_date: formData.issue_date,
    due_date: formData.due_date,
    net_amount: Number(formData.net_amount),
    gross_amount: Number(formData.gross_amount),
    currency: formData.currency,
    paid: formData.paid,
    vehicle_id: vehicleId,
    allocation_type: allocationType,
    service_month: formData.service_month ? formData.service_month.trim() : null
  };

  const isEdit = !!currentEditInvoiceId;
  const confirmText = isEdit
    ? `Zapisać zmiany dla faktury ${payload.invoice_number}?`
    : `Dodać nową fakturę ${payload.invoice_number}?`;

  openConfirmModal(confirmText, async () => {
    let success;
    if (isEdit) {
      success = await updateInvoice(currentEditInvoiceId, payload);
    } else {
      success = await addInvoice(payload);
    }
    if (success) {
      closeInvoiceForm();
    }
  });
});

async function updateNbpPreview() {
  const currency = document.getElementById("f-currency").value;
  const grossAmount = parseFloat(document.getElementById("f-gross-amount").value);
  const previewRow = document.getElementById("nbp-preview-row");
  const previewText = document.getElementById("nbp-preview-text");

  if (currency === "PLN" || !grossAmount || Number.isNaN(grossAmount)) {
    previewRow.style.display = "none";
    return;
  }

  try {
    const response = await fetch(`https://api.nbp.pl/api/exchangerates/rates/A/${currency}/?format=json`);
    if (!response.ok) throw new Error("NBP API error");
    const data = await response.json();
    const rate = data.rates[0].mid;
    const converted = (grossAmount * rate).toFixed(2);
    previewText.textContent = `Podgląd wg kursu NBP (${rate}): ~${converted} PLN`;
    previewRow.style.display = "block";
  } catch (err) {
    previewRow.style.display = "none";
  }
}

document.getElementById("f-currency").addEventListener("change", updateNbpPreview);
document.getElementById("f-gross-amount").addEventListener("input", updateNbpPreview);

// =========================================================================
// MODAL POTWIERDZENIA (uniwersalny)
// =========================================================================
function openConfirmModal(text, onConfirm) {
  confirmModalText.textContent = text;
  pendingConfirmAction = onConfirm;
  confirmModal.classList.remove("hidden");
}

function closeConfirmModal() {
  confirmModal.classList.add("hidden");
  pendingConfirmAction = null;
}

document.getElementById("confirm-modal-yes").addEventListener("click", async () => {
  const action = pendingConfirmAction;
  closeConfirmModal();
  if (action) await action();
});

document.getElementById("confirm-modal-cancel").addEventListener("click", closeConfirmModal);

// =========================================================================
// AKCJE W WIERSZACH TABELI FAKTUR
// =========================================================================
tbodyEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;
  const invoice = allInvoices.find((inv) => String(inv.id) === String(id));
  if (!invoice) return;

  if (action === "edit") {
    openInvoiceForm(invoice);
  } else if (action === "set-vehicle") {
    openVehicleModal(invoice);
  } else if (action === "toggle-status") {
    const currentlyPaid = btn.dataset.paid === "true";
    const newStatus = !currentlyPaid;
    const statusLabel = newStatus ? "opłaconą" : "nieopłaconą";
    openConfirmModal(
      `Oznaczyć fakturę ${invoice.invoice_number} jako ${statusLabel}?`,
      async () => {
        await togglePaymentStatus(invoice.id, newStatus);
      }
    );
  } else if (action === "set-due-date") {
    openDueDateModal(invoice);
  } else if (action === "set-service-month") {
    openServiceMonthModal(invoice);
  } else if (action === "view-order") {
    downloadOrViewOrderFile(invoice);
  } else if (action === "attach-order") {
    openOrdersModal(invoice);
  }
});

// =========================================================================
// MODAL: USTAW TERMIN PLATNOSCI
// =========================================================================
function openDueDateModal(invoice) {
  currentDueDateInvoiceId = invoice.id;
  document.getElementById("due-date-invoice-label").textContent =
    `Faktura: ${invoice.invoice_number} (data wystawienia: ${invoice.issue_date || "-"})`;
  document.getElementById("due-mode-days").checked = true;
  document.getElementById("due-days-input").value = "";
  document.getElementById("due-date-input").value = "";
  document.getElementById("err-due-date-modal").textContent = "";
  dueDateModal.classList.remove("hidden");
}

function closeDueDateModal() {
  dueDateModal.classList.add("hidden");
  currentDueDateInvoiceId = null;
}

document.getElementById("btn-cancel-due-date").addEventListener("click", closeDueDateModal);

document.getElementById("btn-save-due-date").addEventListener("click", () => {
  const invoice = allInvoices.find((inv) => String(inv.id) === String(currentDueDateInvoiceId));
  if (!invoice) return;

  const mode = document.querySelector('input[name="due-date-mode"]:checked').value;
  const errEl = document.getElementById("err-due-date-modal");
  errEl.textContent = "";

  let finalDueDate = null;
  let paymentDays = null;

  if (mode === "days") {
    const days = parseInt(document.getElementById("due-days-input").value, 10);
    if (Number.isNaN(days) || days < 0) {
      errEl.textContent = "Podaj poprawną liczbę dni (liczba całkowita >= 0).";
      return;
    }
    if (!invoice.issue_date) {
      errEl.textContent = "Faktura nie ma daty wystawienia — nie można przeliczyć terminu.";
      return;
    }
    const issueDate = new Date(invoice.issue_date + "T00:00:00");
    issueDate.setDate(issueDate.getDate() + days);
    finalDueDate = issueDate.toISOString().slice(0, 10);
    paymentDays = days;
  } else {
    const dateValue = document.getElementById("due-date-input").value;
    if (!isValidDateFormat(dateValue)) {
      errEl.textContent = "Podaj poprawną datę w formacie RRRR-MM-DD.";
      return;
    }
    finalDueDate = dateValue;
    paymentDays = null;
  }

  openConfirmModal(
    `Ustawić termin płatności ${finalDueDate} dla faktury ${invoice.invoice_number}?`,
    async () => {
      await setDueDate(invoice.id, finalDueDate, paymentDays);
      closeDueDateModal();
    }
  );
});

// =========================================================================
// MODAL: PRZYPISZ POJAZD
// =========================================================================
function openVehicleModal(invoice) {
  currentVehicleInvoiceId = invoice.id;
  const seller = invoice.seller_name ? ` (${invoice.seller_name})` : "";
  vehicleModalInvoiceLabel.textContent = `Faktura: ${invoice.invoice_number || "-"}${seller}`;
  errVehicleModal.textContent = "";

  if (invoice.allocation_type === "shared") {
    modalVehicleSelect.value = "shared";
  } else if (invoice.allocation_type === "vehicle" && invoice.vehicle_id) {
    modalVehicleSelect.value = String(invoice.vehicle_id);
  } else {
    modalVehicleSelect.value = "unassigned";
  }

  vehicleModal.classList.remove("hidden");
}

function closeVehicleModal() {
  vehicleModal.classList.add("hidden");
  currentVehicleInvoiceId = null;
  errVehicleModal.textContent = "";
}

btnCancelVehicle.addEventListener("click", closeVehicleModal);

btnSaveVehicle.addEventListener("click", () => {
  const invoice = allInvoices.find((inv) => String(inv.id) === String(currentVehicleInvoiceId));
  if (!invoice) return;

  const selectedValue = modalVehicleSelect.value;
  let label = "Nieprzypisany";
  if (selectedValue === "shared") {
    label = "Wspólne dla firmy";
  } else if (selectedValue !== "unassigned") {
    const v = allVehicles.find((veh) => String(veh.id) === String(selectedValue));
    label = v ? `${v.name.toUpperCase()} (${v.plate})` : `Pojazd #${selectedValue}`;
  }

  openConfirmModal(
    `Przypisać fakturę ${invoice.invoice_number} do: ${label}?`,
    async () => {
      const success = await setInvoiceVehicle(invoice.id, selectedValue);
      if (success) {
        closeVehicleModal();
      }
    }
  );
});

// =========================================================================
// MODAL: PRZYPISZ MIESIĄC ROZLICZENIA
// =========================================================================
function updateServiceMonthSelect() {
  if (!modalServiceMonthSelect) return;
  const cur = modalServiceMonthSelect.value;
  const monthOpts = generateMonthOptions()
    .map((m) => `<option value="${m}">${m}</option>`)
    .join("");
  modalServiceMonthSelect.innerHTML = `
    <option value="">Domyślny (zgodnie z datą wystawienia)</option>
    ${monthOpts}
    <option value="custom">Inny miesiąc...</option>
  `;
  if (cur) modalServiceMonthSelect.value = cur;
}

function openServiceMonthModal(invoice) {
  currentServiceMonthInvoiceId = invoice.id;
  const seller = invoice.seller_name ? ` (${invoice.seller_name})` : "";
  if (serviceMonthModalInvoiceLabel) {
    serviceMonthModalInvoiceLabel.textContent = `Faktura: ${invoice.invoice_number || "-"}${seller} | Data wyst.: ${invoice.issue_date || "-"}`;
  }
  if (errServiceMonthModal) errServiceMonthModal.textContent = "";

  updateServiceMonthSelect();

  if (modalServiceMonthSelect) {
    if (!invoice.service_month) {
      modalServiceMonthSelect.value = "";
      if (modalServiceMonthCustom) modalServiceMonthCustom.value = "";
    } else {
      const exists = Array.from(modalServiceMonthSelect.options).some((o) => o.value === invoice.service_month);
      if (exists) {
        modalServiceMonthSelect.value = invoice.service_month;
        if (modalServiceMonthCustom) modalServiceMonthCustom.value = "";
      } else {
        modalServiceMonthSelect.value = "custom";
        if (modalServiceMonthCustom) modalServiceMonthCustom.value = invoice.service_month;
      }
    }
  }

  if (serviceMonthModal) serviceMonthModal.classList.remove("hidden");
}

function closeServiceMonthModal() {
  if (serviceMonthModal) serviceMonthModal.classList.add("hidden");
  currentServiceMonthInvoiceId = null;
  if (errServiceMonthModal) errServiceMonthModal.textContent = "";
}

if (btnCancelServiceMonth) {
  btnCancelServiceMonth.addEventListener("click", closeServiceMonthModal);
}

if (modalServiceMonthSelect && modalServiceMonthCustom) {
  modalServiceMonthSelect.addEventListener("change", () => {
    if (modalServiceMonthSelect.value !== "custom") {
      modalServiceMonthCustom.value = "";
    }
  });
}

if (btnSaveServiceMonth) {
  btnSaveServiceMonth.addEventListener("click", () => {
    const invoice = allInvoices.find((inv) => String(inv.id) === String(currentServiceMonthInvoiceId));
    if (!invoice) return;

    if (errServiceMonthModal) errServiceMonthModal.textContent = "";

    const selectedVal = modalServiceMonthSelect ? modalServiceMonthSelect.value : "";
    const customVal = modalServiceMonthCustom ? modalServiceMonthCustom.value.trim() : "";

    let chosenMonth = null;
    if (selectedVal === "custom" || (customVal && selectedVal === "")) {
      if (!/^\d{4}-\d{2}$/.test(customVal)) {
        if (errServiceMonthModal) errServiceMonthModal.textContent = "Podaj poprawny miesiąc w formacie RRRR-MM (np. 2026-09).";
        return;
      }
      chosenMonth = customVal;
    } else if (selectedVal) {
      chosenMonth = selectedVal;
    } else if (customVal) {
      if (!/^\d{4}-\d{2}$/.test(customVal)) {
        if (errServiceMonthModal) errServiceMonthModal.textContent = "Podaj poprawny miesiąc w formacie RRRR-MM (np. 2026-09).";
        return;
      }
      chosenMonth = customVal;
    } else {
      chosenMonth = null;
    }

    const label = chosenMonth || "domyślny (zgodnie z datą wystawienia)";
    openConfirmModal(
      `Ustawić miesiąc rozliczenia dla faktury ${invoice.invoice_number} na: ${label}?`,
      async () => {
        const success = await setInvoiceServiceMonth(invoice.id, chosenMonth);
        if (success) {
          closeServiceMonthModal();
        }
      }
    );
  });
}

// =========================================================================================
// ZAKLADKA WYNIKI - FUNKCJE WSPOLNE (replikuja logike bota WhatsApp z Supabase Edge Function)
// =========================================================================================

// Zwraca kursy walut z tabeli A NBP (jak w bocie: getRates()).
async function getNbpRates() {
  const rates = { PLN: 1 };
  try {
    const response = await fetch("https://api.nbp.pl/api/exchangerates/tables/a/?format=json");
    const data = await response.json();
    (data[0]?.rates || []).forEach((r) => {
      rates[r.code] = Number(r.mid);
    });
  } catch (err) {
    rates.EUR = 4.3;
  }
  return rates;
}

// Generuje liste ostatnich 12 miesiecy w formacie YYYY-MM (najnowszy pierwszy).
function generateMonthOptions() {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push(value);
  }
  return months;
}

// Zwraca zakres dat poczatku i konca danego miesiaca YYYY-MM (jak w bocie).
function getMonthRange(month) {
  const [year, monthNum] = month.split("-").map(Number);
  const startOfMonth = `${month}-01`;
  const lastDay = new Date(year, monthNum, 0).getDate();
  const endOfMonth = `${month}-${String(lastDay).padStart(2, "0")}`;
  return { startOfMonth, endOfMonth };
}

// Tworzy filtr PostgREST dopasowujący faktury do danego miesiąca:
// - przypisane bezpośrednio przez service_month = 'YYYY-MM'
// - lub nieprzypisane (service_month IS NULL), których issue_date mieści się w danym miesiącu
// Dokładna replika logiki z Edge Function whatsapp-webhook.
function getMonthInvoiceFilter(month) {
  const { startOfMonth, endOfMonth } = getMonthRange(month);
  return `service_month.eq.${month},and(service_month.is.null,issue_date.gte.${startOfMonth},issue_date.lte.${endOfMonth})`;
}

// Pomocnicza funkcja czystej logiki sprawdzająca czy faktura należy do danego miesiąca rozliczeniowego
function invoiceBelongsToMonth(invoice, month) {
  if (invoice.service_month) {
    return invoice.service_month === month;
  }
  if (!invoice.issue_date) return false;
  const { startOfMonth, endOfMonth } = getMonthRange(month);
  return invoice.issue_date >= startOfMonth && invoice.issue_date <= endOfMonth;
}

// Wypelnia selecty pojazdow, kierowcow i miesiecy w zakladce Wyniki i Faktury.
async function loadVehiclesAndDrivers() {
  const monthOptions = generateMonthOptions()
    .map((m) => `<option value="${m}">${m}</option>`)
    .join("");
  [
    "wf-month-select",
    "pf-month-select",
    "wp-month-select",
    "wy-month-select",
    "pp-month-select",
    "por-month-select",
    "exp-filter-month",
    "e100-target-month",
    "e100-history-month",
    "trips-filter-month"
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      const cur = el.value;
      if (id === "trips-filter-month") {
        el.innerHTML = `<option value="all">Wszystkie</option>${monthOptions}`;
      } else {
        el.innerHTML = monthOptions;
      }
      if (cur) el.value = cur;
    }
  });

  try {
    const { data: vehicles, error: vehError } = await supabaseClient
      .from("vehicles")
      .select("id, name, plate")
      .eq("active", true)
      .order("name");
    if (vehError) throw vehError;

    allVehicles = vehicles || [];

    const vehicleOptions = allVehicles
      .map((v) => `<option value="${v.id}">${escapeHtml(v.name.toUpperCase())} (${escapeHtml(v.plate)})</option>`)
      .join("");
    const wpVeh = document.getElementById("wp-vehicle-select");
    if (wpVeh) wpVeh.innerHTML = vehicleOptions;
    const ppVeh = document.getElementById("pp-vehicle-select");
    if (ppVeh) ppVeh.innerHTML = vehicleOptions;

    updateVehicleSelects();
    updateServiceMonthSelect();

    if (allInvoices.length > 0) {
      applyFiltersAndRender();
    }

    const { data: drivers, error: drvError } = await supabaseClient
      .from("drivers")
      .select("id, name, base_salary, daily_rate, default_vehicle, active")
      .eq("active", true)
      .order("name");
    if (drvError) throw drvError;

    const driverOptions = (drivers || [])
      .map((d) => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`)
      .join("");
    const wyDrv = document.getElementById("wy-driver-select");
    if (wyDrv) wyDrv.innerHTML = driverOptions;
    const tripStartDrv = document.getElementById("trip-start-driver");
    if (tripStartDrv) tripStartDrv.innerHTML = driverOptions;
    const tripManualDrv = document.getElementById("trip-manual-driver");
    if (tripManualDrv) tripManualDrv.innerHTML = driverOptions;
    const tripsFilterDrv = document.getElementById("trips-filter-driver");
    if (tripsFilterDrv) tripsFilterDrv.innerHTML = `<option value="all">Wszyscy kierowcy</option>${driverOptions}`;
  } catch (err) {
    console.error(err);
    showResultsError("Nie udało się wczytać listy pojazdów/kierowców — sprawdź połączenie.");
  }
}

function updateVehicleSelects() {
  const vehicleOptGroups = allVehicles.length
    ? `<optgroup label="Aktywne pojazdy">${allVehicles
        .map((v) => `<option value="${v.id}">🚛 ${escapeHtml(v.name.toUpperCase())} (${escapeHtml(v.plate)})</option>`)
        .join("")}</optgroup>`
    : "";

  if (filterVehicleEl) {
    const currentVal = filterVehicleEl.value;
    filterVehicleEl.innerHTML = `
      <option value="all">Wszystkie</option>
      <option value="unassigned">Nieprzypisane</option>
      <option value="shared">Wspólne dla firmy</option>
      ${vehicleOptGroups}
    `;
    if (currentVal) filterVehicleEl.value = currentVal;
  }

  const assignmentOptions = `
    <option value="unassigned">Nieprzypisany</option>
    <option value="shared">Wspólne dla firmy</option>
    ${vehicleOptGroups}
  `;

  if (modalVehicleSelect) {
    const cur = modalVehicleSelect.value;
    modalVehicleSelect.innerHTML = assignmentOptions;
    if (cur) modalVehicleSelect.value = cur;
  }
  if (fVehicleSelect) {
    const cur = fVehicleSelect.value;
    fVehicleSelect.innerHTML = assignmentOptions;
    if (cur) fVehicleSelect.value = cur;
  }

  const expFilterVeh = document.getElementById("exp-filter-vehicle");
  if (expFilterVeh) {
    const cur = expFilterVeh.value;
    expFilterVeh.innerHTML = `
      <option value="all">Wszystkie</option>
      <option value="unassigned">Nieprzypisane</option>
      <option value="shared">Wspólne dla firmy</option>
      ${vehicleOptGroups}
    `;
    if (cur) expFilterVeh.value = cur;
  }

  const expVeh = document.getElementById("exp-vehicle");
  if (expVeh) {
    const cur = expVeh.value;
    expVeh.innerHTML = assignmentOptions;
    if (cur) expVeh.value = cur;
  }

  const expModalVeh = document.getElementById("exp-modal-vehicle-select");
  if (expModalVeh) {
    const cur = expModalVeh.value;
    expModalVeh.innerHTML = assignmentOptions;
    if (cur) expModalVeh.value = cur;
  }

  const e100TargetVeh = document.getElementById("e100-target-vehicle");
  if (e100TargetVeh) {
    const cur = e100TargetVeh.value;
    e100TargetVeh.innerHTML = `
      <option value="unassigned">Nieprzypisany</option>
      ${vehicleOptGroups}
    `;
    if (cur) e100TargetVeh.value = cur;
  }

  const e100HistVeh = document.getElementById("e100-history-vehicle");
  if (e100HistVeh) {
    const cur = e100HistVeh.value;
    e100HistVeh.innerHTML = `
      <option value="all">Wszystkie pojazdy</option>
      ${vehicleOptGroups}
    `;
    if (cur) e100HistVeh.value = cur;
  }

  const drvVeh = document.getElementById("driver-vehicle-input");
  if (drvVeh) {
    const cur = drvVeh.value;
    drvVeh.innerHTML = `
      <option value="">Brak / Różne</option>
      ${allVehicles.map((v) => `<option value="${escapeHtml(v.plate)}">${escapeHtml(v.name.toUpperCase())} (${escapeHtml(v.plate)})</option>`).join("")}
    `;
    if (cur) drvVeh.value = cur;
  }
}

// ==========================================================================
// WYNIK OGÓLNY FIRMY (replika komendy "wynik [miesiac]" z bota WhatsApp)
// ==========================================================================
async function fetchCompanyResult(month) {
  showResultsLoading("Wczytywanie wyniku finansowego firmy...");
  try {
    const rates = await getNbpRates();

    const { data: invoices, error: invError } = await supabaseClient
      .from("invoices")
      .select("net_amount, currency, issue_date, service_month")
      .or(getMonthInvoiceFilter(month));
    if (invError) throw invError;

    let totalRevenue = 0;
    let usedForeign = false;
    (invoices || []).forEach((inv) => {
      const net = Number(inv.net_amount || 0);
      const cur = String(inv.currency || "PLN").toUpperCase();
      const rate = Number(rates[cur] || 1);
      if (cur !== "PLN") usedForeign = true;
      totalRevenue += net * rate;
    });

    const { data: expenses, error: expError } = await supabaseClient
      .from("expenses")
      .select("category, amount")
      .eq("expense_month", month);
    if (expError) throw expError;

    let totalExpenses = 0;
    const categories = {};
    (expenses || []).forEach((exp) => {
      const amt = Number(exp.amount || 0);
      totalExpenses += amt;
      const cat = String(exp.category || "inne").toUpperCase();
      categories[cat] = (categories[cat] || 0) + amt;
    });

    const profit = totalRevenue - totalExpenses;

    renderCompanyResult({
      month,
      invoiceCount: (invoices || []).length,
      totalRevenue,
      totalExpenses,
      categories,
      profit,
      usedForeign
    });
    clearResultsStatus();
  } catch (err) {
    console.error(err);
    showResultsError("Nie udało się wczytać wyniku firmy — sprawdź połączenie.");
  }
}

function renderCompanyResult(r) {
  const el = document.getElementById("wf-result");
  if (!el) return;
  const profitClass = r.profit >= 0 ? "positive" : "negative";

  const categoryRows = Object.entries(r.categories)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => `<tr><td>${escapeHtml(cat)}</td><td>-${amt.toFixed(2)} PLN</td></tr>`)
    .join("");

  el.innerHTML = `
    <div class="result-cards">
      <div class="result-card">
        <div class="result-label">Przychody (z ${r.invoiceCount} faktur)</div>
        <div class="result-value positive">${r.totalRevenue.toFixed(2)} PLN</div>
      </div>
      <div class="result-card">
        <div class="result-label">Koszty razem</div>
        <div class="result-value negative">-${r.totalExpenses.toFixed(2)} PLN</div>
      </div>
      <div class="result-card">
        <div class="result-label">Czysty dochód netto firmy</div>
        <div class="result-value ${profitClass}">${r.profit.toFixed(2)} PLN</div>
      </div>
    </div>
    ${categoryRows
      ? `<h4>Podział kosztów wg kategorii:</h4>
         <table class="category-table"><thead><tr><th>Kategoria</th><th>Kwota netto</th></tr></thead><tbody>${categoryRows}</tbody></table>`
      : `<p class="empty-note">Brak wprowadzonych kosztów w tym miesiącu.</p>`}
    ${r.usedForeign ? `<p class="currency-note">Faktury w obcych walutach przeliczono wg tabeli kursów NBP.</p>` : ""}
  `;
}

// ==========================================================================
// PODSUMOWANIE SPRZEDAŻY (replika komendy "podsumowanie [miesiac]" z bota WhatsApp)
// ==========================================================================
async function fetchCompanySummary(month) {
  showResultsLoading("Wczytywanie podsumowania sprzedaży...");
  try {
    const rates = await getNbpRates();

    const { data: invoices, error } = await supabaseClient
      .from("invoices")
      .select("invoice_number, net_amount, gross_amount, currency, paid, issue_date, service_month")
      .or(getMonthInvoiceFilter(month));
    if (error) throw error;

    let totalGross = 0;
    let totalNet = 0;
    let paidGross = 0;
    let unpaidGross = 0;
    let usedForeign = false;

    (invoices || []).forEach((inv) => {
      const cur = String(inv.currency || "PLN").toUpperCase();
      const rate = Number(rates[cur] || 1);
      const gross = Number(inv.gross_amount || 0) * rate;
      const net = Number(inv.net_amount || 0) * rate;
      totalGross += gross;
      totalNet += net;
      if (inv.paid) paidGross += gross;
      else unpaidGross += gross;
      if (cur !== "PLN") usedForeign = true;
    });

    renderCompanySummary({
      invoiceCount: (invoices || []).length,
      totalNet,
      totalGross,
      paidGross,
      unpaidGross,
      usedForeign
    });
    clearResultsStatus();
  } catch (err) {
    console.error(err);
    showResultsError("Nie udało się wczytać podsumowania — sprawdź połączenie.");
  }
}

function renderCompanySummary(r) {
  const el = document.getElementById("pf-result");
  if (!el) return;
  el.innerHTML = `
    <div class="result-cards">
      <div class="result-card">
        <div class="result-label">Liczba faktur</div>
        <div class="result-value">${r.invoiceCount}</div>
      </div>
      <div class="result-card">
        <div class="result-label">Suma netto</div>
        <div class="result-value">${r.totalNet.toFixed(2)} PLN</div>
      </div>
      <div class="result-card">
        <div class="result-label">Suma brutto</div>
        <div class="result-value">${r.totalGross.toFixed(2)} PLN</div>
      </div>
    </div>
    <div class="result-cards">
      <div class="result-card">
        <div class="result-label">Opłacone (brutto)</div>
        <div class="result-value positive">${r.paidGross.toFixed(2)} PLN</div>
      </div>
      <div class="result-card">
        <div class="result-label">Do zapłaty (brutto)</div>
        <div class="result-value negative">${r.unpaidGross.toFixed(2)} PLN</div>
      </div>
    </div>
    ${r.usedForeign ? `<p class="currency-note">Faktury w obcych walutach przeliczono wg tabeli kursów NBP.</p>` : ""}
  `;
}

function initResultsView() {
  const curMonth = document.getElementById("wf-month-select")?.value;
  if (curMonth) {
    fetchCompanyResult(curMonth);
  }
}

const btnLoadWf = document.getElementById("btn-load-wf");
if (btnLoadWf) {
  btnLoadWf.addEventListener("click", () => {
    const month = document.getElementById("wf-month-select")?.value;
    if (month) fetchCompanyResult(month);
  });
}

const btnLoadPf = document.getElementById("btn-load-pf");
if (btnLoadPf) {
  btnLoadPf.addEventListener("click", () => {
    const month = document.getElementById("pf-month-select")?.value;
    if (month) fetchCompanySummary(month);
  });
}

// ==========================================================================
// WYNIK POJAZDU (replika komendy "wynik [pojazd] [miesiac]")
// ==========================================================================
async function fetchVehicleResult(vehicleId, month) {
  showResultsLoading("Wczytywanie wyniku pojazdu...");
  try {
    const { startOfMonth, endOfMonth } = getMonthRange(month);
    const rates = await getNbpRates();

    const { data: invoices, error: invError } = await supabaseClient
      .from("invoices")
      .select("net_amount, currency, issue_date, service_month")
      .eq("vehicle_id", vehicleId)
      .eq("allocation_type", "vehicle")
      .or(getMonthInvoiceFilter(month));
    if (invError) throw invError;

    const { data: expenses, error: expError } = await supabaseClient
      .from("expenses")
      .select("category, amount")
      .eq("vehicle_id", vehicleId)
      .eq("allocation_type", "vehicle")
      .eq("expense_month", month);
    if (expError) throw expError;

    let revenue = 0;
    let usedForeign = false;
    (invoices || []).forEach((inv) => {
      const cur = String(inv.currency || "PLN").toUpperCase();
      const rate = Number(rates[cur] || 1);
      revenue += Number(inv.net_amount || 0) * rate;
      if (cur !== "PLN") usedForeign = true;
    });

    let expensesTotal = 0;
    const byCategory = {};
    (expenses || []).forEach((exp) => {
      const amount = Number(exp.amount || 0);
      const category = String(exp.category || "inne").toUpperCase();
      expensesTotal += amount;
      byCategory[category] = (byCategory[category] || 0) + amount;
    });

    const profit = revenue - expensesTotal;

    renderVehicleResult({ revenue, expensesTotal, byCategory, profit, invoiceCount: (invoices || []).length, usedForeign });
    clearResultsStatus();
  } catch (err) {
    console.error(err);
    showResultsError("Nie udało się wczytać wyniku pojazdu — sprawdź połączenie.");
  }
}

function renderVehicleResult(r) {
  const el = document.getElementById("wp-result");
  const profitClass = r.profit >= 0 ? "positive" : "negative";

  const categoryRows = Object.entries(r.byCategory)
    .map(([cat, amt]) => `<tr><td>${escapeHtml(cat)}</td><td>-${amt.toFixed(2)} PLN</td></tr>`)
    .join("");

  el.innerHTML = `
    <div class="result-cards">
      <div class="result-card">
        <div class="result-label">Przychód netto (${r.invoiceCount} faktur)</div>
        <div class="result-value positive">${r.revenue.toFixed(2)} PLN</div>
      </div>
      <div class="result-card">
        <div class="result-label">Koszty razem</div>
        <div class="result-value negative">-${r.expensesTotal.toFixed(2)} PLN</div>
      </div>
      <div class="result-card">
        <div class="result-label">Wynik netto</div>
        <div class="result-value ${profitClass}">${r.profit.toFixed(2)} PLN</div>
      </div>
    </div>
    ${categoryRows
      ? `<table class="category-table"><thead><tr><th>Kategoria kosztu</th><th>Kwota</th></tr></thead><tbody>${categoryRows}</tbody></table>`
      : `<p class="empty-note">Brak kosztów przypisanych do tego pojazdu w tym miesiącu.</p>`}
    ${r.usedForeign ? `<p class="currency-note">Faktury w obcych walutach przeliczono po aktualnym kursie NBP.</p>` : ""}
  `;
}

document.getElementById("btn-load-wp").addEventListener("click", () => {
  const vehicleId = document.getElementById("wp-vehicle-select").value;
  const month = document.getElementById("wp-month-select").value;
  if (!vehicleId || !month) return;
  fetchVehicleResult(vehicleId, month);
});

// ==========================================================================
// WYPLATA KIEROWCY (replika komendy "wyplata [kierowca] [miesiac]")
// ==========================================================================
async function fetchDriverPayout(driverName, month) {
  showResultsLoading("Wczytywanie wypłaty...");
  try {
    const { startOfMonth, endOfMonth } = getMonthRange(month);

    const { data: driver, error: drvError } = await supabaseClient
      .from("drivers")
      .select("*")
      .ilike("name", driverName)
      .maybeSingle();
    if (drvError) throw drvError;
    if (!driver) {
      renderDriverPayout(null);
      clearResultsStatus();
      return;
    }

    const { data: trips, error: tripsErr } = await supabaseClient
      .from("driver_trips")
      .select("*")
      .ilike("driver_name", driverName)
      .lte("start_date", endOfMonth)
      .or(`end_date.gte.${startOfMonth},end_date.is.null`);
    if (tripsErr) throw tripsErr;

    let totalDaysInMonth = 0;
    const tripsSummary = [];

    (trips || []).forEach((t) => {
      const tripStart = t.start_date;
      const tripEnd = t.end_date || endOfMonth;
      const effectiveStart = tripStart < startOfMonth ? startOfMonth : tripStart;
      const effectiveEnd = tripEnd > endOfMonth ? endOfMonth : tripEnd;
      const sMs = new Date(effectiveStart).getTime();
      const eMs = new Date(effectiveEnd).getTime();
      const daysInThisMonth = Math.max(1, Math.round((eMs - sMs) / (1000 * 60 * 60 * 24)) + 1);
      totalDaysInMonth += daysInThisMonth;
      tripsSummary.push({
        start: tripStart,
        end: t.end_date || "w trasie",
        days: daysInThisMonth,
        description: t.description || ""
      });
    });

    const baseSalary = Number(driver.base_salary) || 0;
    const dailyRate = Number(driver.daily_rate) || 0;
    const totalDailyPay = totalDaysInMonth * dailyRate;
    const totalPayout = baseSalary + totalDailyPay;

    renderDriverPayout({ driverName: driver.name, baseSalary, dailyRate, totalDaysInMonth, totalDailyPay, totalPayout, tripsSummary });
    clearResultsStatus();
  } catch (err) {
    console.error(err);
    showResultsError("Nie udało się wczytać wypłaty — sprawdź połączenie.");
  }
}

function renderDriverPayout(r) {
  const el = document.getElementById("wy-result");

  if (!r) {
    el.innerHTML = `<p class="empty-note">Nie znaleziono kierowcy w bazie.</p>`;
    return;
  }

  const tripRows = r.tripsSummary
    .map(
      (t) =>
        `<tr><td>${t.start}</td><td>${t.end}</td><td>${t.days}</td><td>${escapeHtml(t.description)}</td></tr>`
    )
    .join("");

  el.innerHTML = `
    <div class="result-cards">
      <div class="result-card">
        <div class="result-label">Podstawa</div>
        <div class="result-value">${r.baseSalary.toFixed(2)} PLN</div>
      </div>
      <div class="result-card">
        <div class="result-label">Dni w trasie x stawka</div>
        <div class="result-value">${r.totalDaysInMonth} x ${r.dailyRate.toFixed(2)} = ${r.totalDailyPay.toFixed(2)} PLN</div>
      </div>
      <div class="result-card">
        <div class="result-label">Do wypłaty</div>
        <div class="result-value positive">${r.totalPayout.toFixed(2)} PLN</div>
      </div>
    </div>
    ${tripRows
      ? `<table class="trips-table"><thead><tr><th>Od</th><th>Do</th><th>Dni w m-cu</th><th>Opis</th></tr></thead><tbody>${tripRows}</tbody></table>`
      : `<p class="empty-note">Brak zarejestrowanych tras w tym miesiącu.</p>`}
  `;
}

document.getElementById("btn-load-wy").addEventListener("click", () => {
  const driverName = document.getElementById("wy-driver-select").value;
  const month = document.getElementById("wy-month-select").value;
  if (!driverName || !month) return;
  fetchDriverPayout(driverName, month);
});

// ==========================================================================
// PODSUMOWANIE POJAZDU (replika komendy "podsumowanie [pojazd] [miesiac]")
// ==========================================================================
async function fetchVehicleSummary(vehicleId, month) {
  showResultsLoading("Wczytywanie podsumowania...");
  try {
    const { startOfMonth, endOfMonth } = getMonthRange(month);
    const rates = await getNbpRates();

    const { data: invoices, error } = await supabaseClient
      .from("invoices")
      .select("invoice_number, net_amount, gross_amount, currency, paid, issue_date, service_month")
      .eq("vehicle_id", vehicleId)
      .eq("allocation_type", "vehicle")
      .or(getMonthInvoiceFilter(month));
    if (error) throw error;

    let netTotal = 0;
    let grossTotal = 0;
    let paidGrossTotal = 0;
    let unpaidGrossTotal = 0;
    let usedForeign = false;

    (invoices || []).forEach((inv) => {
      const cur = String(inv.currency || "PLN").toUpperCase();
      const rate = Number(rates[cur] || 1);
      const net = Number(inv.net_amount || 0) * rate;
      const gross = Number(inv.gross_amount || 0) * rate;
      netTotal += net;
      grossTotal += gross;
      if (inv.paid) paidGrossTotal += gross;
      else unpaidGrossTotal += gross;
      if (cur !== "PLN") usedForeign = true;
    });

    renderVehicleSummary({
      invoiceCount: (invoices || []).length,
      netTotal,
      grossTotal,
      paidGrossTotal,
      unpaidGrossTotal,
      usedForeign
    });
    clearResultsStatus();
  } catch (err) {
    console.error(err);
    showResultsError("Nie udało się wczytać podsumowania — sprawdź połączenie.");
  }
}

function renderVehicleSummary(r) {
  const el = document.getElementById("pp-result");
  el.innerHTML = `
    <div class="result-cards">
      <div class="result-card">
        <div class="result-label">Liczba faktur</div>
        <div class="result-value">${r.invoiceCount}</div>
      </div>
      <div class="result-card">
        <div class="result-label">Razem netto</div>
        <div class="result-value">${r.netTotal.toFixed(2)} PLN</div>
      </div>
      <div class="result-card">
        <div class="result-label">Razem brutto</div>
        <div class="result-value">${r.grossTotal.toFixed(2)} PLN</div>
      </div>
    </div>
    <div class="result-cards">
      <div class="result-card">
        <div class="result-label">Opłacone brutto</div>
        <div class="result-value positive">${r.paidGrossTotal.toFixed(2)} PLN</div>
      </div>
      <div class="result-card">
        <div class="result-label">Do zapłaty brutto</div>
        <div class="result-value negative">${r.unpaidGrossTotal.toFixed(2)} PLN</div>
      </div>
    </div>
    ${r.usedForeign ? `<p class="currency-note">Faktury w obcych walutach przeliczono po aktualnym kursie NBP.</p>` : ""}
  `;
}

document.getElementById("btn-load-pp").addEventListener("click", () => {
  const vehicleId = document.getElementById("pp-vehicle-select").value;
  const month = document.getElementById("pp-month-select").value;
  if (!vehicleId || !month) return;
  fetchVehicleSummary(vehicleId, month);
});

// ==========================================================================
// POROWNANIE POJAZDOW (replika komendy "porownanie [miesiac]")
// ==========================================================================
async function fetchComparison(month) {
  showResultsLoading("Wczytywanie porównania...");
  try {
    const { startOfMonth, endOfMonth } = getMonthRange(month);
    const rates = await getNbpRates();

    const { data: vehicles, error: vehError } = await supabaseClient
      .from("vehicles")
      .select("id, name, plate")
      .eq("active", true)
      .order("name");
    if (vehError) throw vehError;

    if (!vehicles || vehicles.length === 0) {
      renderComparison([]);
      clearResultsStatus();
      return;
    }

    const vehicleIds = vehicles.map((v) => v.id);

    const { data: invoices, error: invError } = await supabaseClient
      .from("invoices")
      .select("vehicle_id, net_amount, currency, issue_date, service_month")
      .in("vehicle_id", vehicleIds)
      .eq("allocation_type", "vehicle")
      .or(getMonthInvoiceFilter(month));
    if (invError) throw invError;

    const { data: expenses, error: expError } = await supabaseClient
      .from("expenses")
      .select("vehicle_id, amount")
      .in("vehicle_id", vehicleIds)
      .eq("allocation_type", "vehicle")
      .eq("expense_month", month);
    if (expError) throw expError;

    const revenueByVehicle = {};
    const countByVehicle = {};
    const expensesByVehicle = {};

    vehicles.forEach((v) => {
      revenueByVehicle[v.id] = 0;
      countByVehicle[v.id] = 0;
      expensesByVehicle[v.id] = 0;
    });

    (invoices || []).forEach((inv) => {
      if (!inv.vehicle_id) return;
      const cur = String(inv.currency || "PLN").toUpperCase();
      const rate = Number(rates[cur] || 1);
      const vId = Number(inv.vehicle_id);
      revenueByVehicle[vId] = (revenueByVehicle[vId] || 0) + Number(inv.net_amount || 0) * rate;
      countByVehicle[vId] = (countByVehicle[vId] || 0) + 1;
    });

    (expenses || []).forEach((exp) => {
      if (!exp.vehicle_id) return;
      const vId = Number(exp.vehicle_id);
      expensesByVehicle[vId] = (expensesByVehicle[vId] || 0) + Number(exp.amount || 0);
    });

    const comparison = vehicles
      .map((v) => {
        const revenue = revenueByVehicle[v.id] || 0;
        const costs = expensesByVehicle[v.id] || 0;
        return {
          name: v.name.toUpperCase(),
          plate: v.plate,
          revenue,
          costs,
          profit: revenue - costs,
          invoicesCount: countByVehicle[v.id] || 0
        };
      })
      .sort((a, b) => b.profit - a.profit);

    renderComparison(comparison);
    clearResultsStatus();
  } catch (err) {
    console.error(err);
    showResultsError("Nie udało się wczytać porównania — sprawdź połączenie.");
  }
}

function renderComparison(comparison) {
  const el = document.getElementById("por-result");

  if (!comparison.length) {
    el.innerHTML = `<p class="empty-note">Brak aktywnych pojazdów do porównania.</p>`;
    return;
  }

  const rows = comparison
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.name)} (${escapeHtml(item.plate)})</td>
        <td>${item.invoicesCount}</td>
        <td>${item.revenue.toFixed(2)} PLN</td>
        <td>-${item.costs.toFixed(2)} PLN</td>
        <td class="${item.profit >= 0 ? "positive" : "negative"}">${item.profit.toFixed(2)} PLN</td>
      </tr>`
    )
    .join("");

  const companyRevenue = comparison.reduce((sum, i) => sum + i.revenue, 0);
  const companyCosts = comparison.reduce((sum, i) => sum + i.costs, 0);
  const companyProfit = companyRevenue - companyCosts;

  el.innerHTML = `
    <table class="comparison-table">
      <thead>
        <tr><th>Pojazd</th><th>Faktury</th><th>Przychód netto</th><th>Koszty</th><th>Wynik netto</th></tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="total-row">
          <td>Suma pojazdów</td>
          <td>-</td>
          <td>${companyRevenue.toFixed(2)} PLN</td>
          <td>-${companyCosts.toFixed(2)} PLN</td>
          <td>${companyProfit.toFixed(2)} PLN</td>
        </tr>
      </tbody>
    </table>
    <p class="currency-note">Porównanie obejmuje tylko faktury i koszty przypisane bezpośrednio do pojazdów. Dokumenty wspólne dla firmy nie są doliczane.</p>
  `;
}

document.getElementById("btn-load-por").addEventListener("click", () => {
  const month = document.getElementById("por-month-select").value;
  if (!month) return;
  fetchComparison(month);
});

// =========================================================================

// =========================================================================
// REGUŁY — panel administracyjny
// =========================================================================
let rulesById = new Map();
let rulesVehicles = [];

function setRulesStatus(text, error = false) {
  rulesStatusEl.textContent = text;
  rulesStatusEl.className = `status-bar ${error ? "error" : ""}`.trim();
}
function validNip(value) {
  const nip = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{10}$/.test(nip)) throw new Error("NIP musi mieć dokładnie 10 cyfr.");
  return nip;
}
function ruleCell(row, label, value) {
  const cell = document.createElement("td");
  cell.dataset.label = label;
  cell.textContent = String(value ?? "—");
  row.append(cell);
}
function renderRuleCategory(category, tbodyId) {
  const body = document.getElementById(tbodyId);
  body.replaceChildren();
  const matching = [...rulesById.values()].filter(rule => rule.category === category);
  if (!matching.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = category === "vat_rate" ? 5 : 4;
    cell.textContent = "Brak reguł";
    row.append(cell); body.append(row);
    return;
  }
  for (const rule of matching) {
    const row = document.createElement("tr");
    if (category === "payment_terms_default") {
      ruleCell(row, "Klucz", rule.key);
      ruleCell(row, "Dni", rule.value?.days);
    } else if (category === "vehicle_by_nip") {
      ruleCell(row, "NIP", rule.key);
      ruleCell(row, "Pojazd", rule.value?.vehicle);
    } else {
      ruleCell(row, "Kraj", rule.key);
      ruleCell(row, "Paliwo", rule.value?.paliwo_vat);
      ruleCell(row, "Myto", rule.value?.myto_vat);
    }
    ruleCell(row, "Stan", rule.active ? "Aktywna" : "Wyłączona");
    const actions = document.createElement("td");
    actions.dataset.label = "Akcje";
    actions.className = "row-actions";
    for (const action of ["edit", "toggle"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-secondary btn-small";
      button.textContent = action === "edit" ? "Edytuj" : (rule.active ? "Wyłącz" : "Włącz");
      button.dataset.ruleAction = action;
      button.dataset.ruleId = String(rule.id);
      actions.append(button);
    }
    row.append(actions); body.append(row);
  }
}
async function loadRulesView() {
  setRulesStatus("Wczytywanie reguł...");
  const [{ data: rules, error: rulesError }, { data: vehicles, error: vehiclesError }] = await Promise.all([
    supabaseClient.from("rules").select("id,category,key,value,active").order("category").order("key"),
    supabaseClient.from("vehicles").select("name,plate").eq("active", true).order("name")
  ]);
  if (rulesError || vehiclesError) {
    setRulesStatus((rulesError || vehiclesError).message, true);
    return;
  }
  rulesById = new Map((rules || []).map(rule => [String(rule.id), rule]));
  rulesVehicles = vehicles || [];
  const select = document.getElementById("vehicle-rule-select");
  select.replaceChildren(new Option("Wybierz pojazd", ""));
  for (const v of rulesVehicles) select.add(new Option(`${v.name} (${v.plate})`, v.plate));
  renderRuleCategory("payment_terms_default", "payment-rules-tbody");
  renderRuleCategory("vehicle_by_nip", "vehicle-rules-tbody");
  renderRuleCategory("vat_rate", "vat-rules-tbody");
  setRulesStatus("");
}
async function saveRule(category, key, value) {
  const current = [...rulesById.values()].find(row => row.category === category && row.key === key);
  const payload = { category, key, value, active: true, updated_at: new Date().toISOString() };
  const { error } = current
    ? await supabaseClient.from("rules").update(payload).eq("id", current.id)
    : await supabaseClient.from("rules").insert(payload);
  if (error) throw error;
  await loadRulesView();
  setRulesStatus("Zapisano regułę.");
}
document.getElementById("payment-rule-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const raw = document.getElementById("payment-rule-key").value.trim();
    const key = raw.toLowerCase() === "default" ? "default" : validNip(raw);
    const rawDays = document.getElementById("payment-rule-days").value.trim();
    const days = Number(rawDays);
    if (rawDays === "" || !Number.isInteger(days) || days < 0 || days > 365) throw new Error("Podaj 0–365 pełnych dni.");
    await saveRule("payment_terms_default", key, { days });
  } catch (error) { setRulesStatus(error.message, true); }
});
document.getElementById("vehicle-rule-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const key = validNip(document.getElementById("vehicle-rule-nip").value);
    const vehicle = document.getElementById("vehicle-rule-select").value;
    if (!rulesVehicles.some(v => v.plate === vehicle)) throw new Error("Wybierz aktywny pojazd.");
    await saveRule("vehicle_by_nip", key, { vehicle });
  } catch (error) { setRulesStatus(error.message, true); }
});
document.getElementById("vat-rule-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const raw = document.getElementById("vat-rule-country").value.trim().toUpperCase();
    const key = raw === "_DEFAULT" ? "_default" : raw;
    if (key !== "_default" && !/^[A-Z]{2}$/.test(key)) throw new Error("Podaj kod kraju, np. PL, albo _default.");
    const fuelRaw = document.getElementById("vat-rule-fuel").value.trim();
    const tollRaw = document.getElementById("vat-rule-toll").value.trim();
    const fuel = Number(fuelRaw), toll = Number(tollRaw);
    if (!fuelRaw || !tollRaw || ![fuel, toll].every(x => Number.isFinite(x) && x >= 1 && x <= 2)) throw new Error("Dzielniki VAT muszą być liczbami od 1.00 do 2.00.");
    await saveRule("vat_rate", key, { paliwo_vat: fuel, myto_vat: toll });
  } catch (error) { setRulesStatus(error.message, true); }
});
rulesView.addEventListener("click", async event => {
  const button = event.target.closest("button[data-rule-action]");
  if (!button || !rulesView.contains(button)) return;
  const rule = rulesById.get(button.dataset.ruleId);
  if (!rule) return;
  if (button.dataset.ruleAction === "edit") {
    if (rule.category === "payment_terms_default") {
      document.getElementById("payment-rule-key").value = rule.key;
      document.getElementById("payment-rule-days").value = rule.value?.days ?? "";
    } else if (rule.category === "vehicle_by_nip") {
      document.getElementById("vehicle-rule-nip").value = rule.key;
      document.getElementById("vehicle-rule-select").value = rule.value?.vehicle ?? "";
    } else {
      document.getElementById("vat-rule-country").value = rule.key;
      document.getElementById("vat-rule-fuel").value = rule.value?.paliwo_vat ?? "";
      document.getElementById("vat-rule-toll").value = rule.value?.myto_vat ?? "";
    }
    return;
  }
  button.disabled = true;
  const { error } = await supabaseClient.from("rules")
    .update({ active: !rule.active, updated_at: new Date().toISOString() }).eq("id", rule.id);
  button.disabled = false;
  if (error) setRulesStatus(error.message, true);
  else await loadRulesView();
});

// =========================================================================
// MODUŁ: POBIERZ Z KSEF
// =========================================================================
const ksefModal = document.getElementById("ksef-modal");
const btnKsefSync = document.getElementById("btn-ksef-sync");
const btnExecuteKsefSync = document.getElementById("btn-execute-ksef-sync");
const btnCancelKsefModal = document.getElementById("btn-cancel-ksef-modal");
const errKsefModal = document.getElementById("err-ksef-modal");
const ksefProgressMsg = document.getElementById("ksef-progress-msg");

function openKsefModal() {
  if (ksefModal) {
    if (errKsefModal) errKsefModal.textContent = "";
    if (ksefProgressMsg) ksefProgressMsg.textContent = "";
    ksefModal.classList.remove("hidden");
  }
}

function closeKsefModal() {
  if (ksefModal) {
    ksefModal.classList.add("hidden");
    if (errKsefModal) errKsefModal.textContent = "";
    if (ksefProgressMsg) ksefProgressMsg.textContent = "";
  }
}

if (btnKsefSync) btnKsefSync.addEventListener("click", openKsefModal);
if (btnCancelKsefModal) btnCancelKsefModal.addEventListener("click", closeKsefModal);

if (btnExecuteKsefSync) {
  btnExecuteKsefSync.addEventListener("click", async () => {
    const mode = document.querySelector('input[name="ksef-range-mode"]:checked')?.value || "today";
    const daysBack = Number(document.getElementById("ksef-days-input")?.value) || 30;
    const from = document.getElementById("ksef-date-from")?.value;
    const to = document.getElementById("ksef-date-to")?.value;

    if (errKsefModal) errKsefModal.textContent = "";
    if (ksefProgressMsg) ksefProgressMsg.textContent = "⏳ Łączę z KSeF i pobieram faktury...";
    btnExecuteKsefSync.disabled = true;

    if (mode === "range" && (!from || !to)) {
      if (errKsefModal) errKsefModal.textContent = "Podaj poprawny zakres dat (od i do).";
      if (ksefProgressMsg) ksefProgressMsg.textContent = "";
      btnExecuteKsefSync.disabled = false;
      return;
    }

    try {
      const { data, error } = await supabaseClient.functions.invoke("whatsapp-webhook", {
        body: { action: "pobierz", mode, daysBack, from, to }
      });
      if (error) throw error;
      if (data && data.ok) {
        if (ksefProgressMsg) ksefProgressMsg.textContent = `✅ ${data.message || `Pobrano ${data.count} faktur.`}`;
        await fetchInvoices();
        setTimeout(closeKsefModal, 1500);
      } else {
        if (errKsefModal) errKsefModal.textContent = data?.error || data?.message || "Wystąpił błąd podczas pobierania.";
        if (ksefProgressMsg) ksefProgressMsg.textContent = "";
      }
    } catch (err) {
      console.error(err);
      if (errKsefModal) errKsefModal.textContent = `Błąd połączenia: ${err.message || "Nie udało się połączyć z KSeF."}`;
      if (ksefProgressMsg) ksefProgressMsg.textContent = "";
    } finally {
      btnExecuteKsefSync.disabled = false;
    }
  });
}

// =========================================================================
// MODUŁ: ZLECENIA TRANSPORTOWE (ODCZYT PDF/DOCX, DOPASOWYWANIE I SUPABASE STORAGE)
// =========================================================================

async function downloadOrViewOrderFile(invoice) {
  if (!invoice || !invoice.order_file_url) return;
  showLoading("Otwieranie pliku zlecenia...");
  try {
    const { data, error } = await supabaseClient
      .storage
      .from("orders")
      .createSignedUrl(invoice.order_file_url, 300);

    if (error) {
      const { data: pubData } = supabaseClient
        .storage
        .from("orders")
        .getPublicUrl(invoice.order_file_url);

      if (pubData && pubData.publicUrl) {
        window.open(pubData.publicUrl, "_blank");
        clearStatus();
        return;
      }
      throw error;
    }

    if (data && data.signedUrl) {
      window.open(data.signedUrl, "_blank");
      clearStatus();
    } else {
      throw new Error("Nie udało się uzyskać adresu pliku.");
    }
  } catch (err) {
    console.error(err);
    showError("Błąd pobierania pliku: " + (err.message || "Brak dostępu do bucketu 'orders'."));
  }
}

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

function extractOrderNumberFromFileName(fileName) {
  if (!fileName) return null;
  const baseName = fileName.replace(/\.[^/.]+$/, "");
  return extractOrderNumberFromText(baseName);
}

async function extractTextFromPdf(file) {
  if (typeof pdfjsLib === "undefined") {
    throw new Error("Biblioteka PDF.js nie została załadowana.");
  }
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  let fullText = "";

  const maxPages = Math.min(pdf.numPages, 5);
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((item) => item.str);
    fullText += strings.join(" ") + "\n";
  }

  return fullText;
}

async function extractTextFromDocx(file) {
  if (typeof mammoth === "undefined") {
    throw new Error("Biblioteka Mammoth.js nie została załadowana.");
  }
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value || "";
}

function normalizeOrderForComparison(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findMatchingInvoiceForOrder(orderNumber) {
  if (!orderNumber || !allInvoices.length) return null;
  const normTarget = normalizeOrderForComparison(orderNumber);
  if (!normTarget) return null;

  // 1. Dokładne dopasowanie do order_number pobranego z KSeF
  const exact = allInvoices.find((inv) => {
    if (!inv.order_number) return false;
    return normalizeOrderForComparison(inv.order_number) === normTarget;
  });
  if (exact) return exact;

  // 2. Jeśli numer zlecenia zawiera się w numerze faktury (lub odwrotnie)
  const byInvoiceNumber = allInvoices.find((inv) => {
    if (!inv.invoice_number) return false;
    const normInv = normalizeOrderForComparison(inv.invoice_number);
    return normInv.includes(normTarget) || normTarget.includes(normInv);
  });
  if (byInvoiceNumber) return byInvoiceNumber;

  return null;
}

function openOrdersModal(targetInvoice = null) {
  targetOrderInvoiceId = targetInvoice ? targetInvoice.id : null;
  parsedOrdersQueue = [];
  if (errOrdersModal) errOrdersModal.textContent = "";
  if (ordersFilesInput) ordersFilesInput.value = "";
  if (ordersPreviewContainer) ordersPreviewContainer.classList.add("hidden");
  if (ordersPreviewTbody) ordersPreviewTbody.innerHTML = "";
  if (ordersPreviewCount) ordersPreviewCount.textContent = "0";
  if (btnSaveOrdersBatch) {
    btnSaveOrdersBatch.disabled = true;
    btnSaveOrdersBatch.textContent = "💾 Zapisz i przypisz do faktur";
  }
  if (ordersModal) ordersModal.classList.remove("hidden");
}

function closeOrdersModal() {
  if (ordersModal) ordersModal.classList.add("hidden");
  parsedOrdersQueue = [];
  targetOrderInvoiceId = null;
  if (errOrdersModal) errOrdersModal.textContent = "";
}

async function handleOrdersFilesSelected(files) {
  if (!files || !files.length) return;
  if (errOrdersModal) errOrdersModal.textContent = "";
  showLoading(`Przetwarzanie ${files.length} plików zleceń...`);

  const targetInvoice = targetOrderInvoiceId
    ? allInvoices.find((inv) => String(inv.id) === String(targetOrderInvoiceId))
    : null;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      let text = "";
      if (ext === "pdf") {
        text = await extractTextFromPdf(file);
      } else if (ext === "docx") {
        text = await extractTextFromDocx(file);
      }

      let orderNumber = extractOrderNumberFromText(text);
      if (!orderNumber) {
        orderNumber = extractOrderNumberFromFileName(file.name);
      }

      let matchedInv = null;
      if (targetInvoice) {
        matchedInv = targetInvoice;
      } else if (orderNumber) {
        matchedInv = findMatchingInvoiceForOrder(orderNumber);
      }

      parsedOrdersQueue.push({
        id: "order-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5),
        file,
        fileName: file.name,
        fileSize: (file.size / 1024).toFixed(1) + " KB",
        orderNumber: orderNumber || "",
        matchedInvoiceId: matchedInv ? matchedInv.id : null,
      });
    } catch (err) {
      console.warn("Błąd parsowania pliku " + file.name + ":", err);
      parsedOrdersQueue.push({
        id: "order-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5),
        file,
        fileName: file.name,
        fileSize: (file.size / 1024).toFixed(1) + " KB",
        orderNumber: extractOrderNumberFromFileName(file.name) || "",
        matchedInvoiceId: targetInvoice ? targetInvoice.id : null,
      });
    }
  }

  clearStatus();
  renderOrdersPreviewQueue();
}

function renderOrdersPreviewQueue() {
  if (!ordersPreviewTbody || !ordersPreviewContainer) return;

  ordersPreviewTbody.innerHTML = "";
  if (!parsedOrdersQueue.length) {
    ordersPreviewContainer.classList.add("hidden");
    if (btnSaveOrdersBatch) btnSaveOrdersBatch.disabled = true;
    return;
  }

  ordersPreviewContainer.classList.remove("hidden");
  if (ordersPreviewCount) ordersPreviewCount.textContent = String(parsedOrdersQueue.length);

  parsedOrdersQueue.forEach((item, index) => {
    const tr = document.createElement("tr");

    let optionsHtml = `<option value="">-- Wybierz fakturę ręcznie --</option>`;
    allInvoices.forEach((inv) => {
      const isSelected = String(inv.id) === String(item.matchedInvoiceId);
      const orderLabel = inv.order_number ? ` [KSeF: ${escapeHtml(inv.order_number)}]` : "";
      const invLabel = `${escapeHtml(inv.invoice_number || "-")} (${escapeHtml(inv.seller_name || "-")}, ${formatAmount(inv.gross_amount, inv.currency)})${orderLabel}`;
      optionsHtml += `<option value="${inv.id}" ${isSelected ? "selected" : ""}>${invLabel}</option>`;
    });

    const statusBadge = item.matchedInvoiceId
      ? `<span class="badge badge-paid">✅ Dopasowano</span>`
      : `<span class="badge badge-unpaid">⚠️ Brak dopasowania</span>`;

    tr.innerHTML = `
      <td>
        <div style="font-weight: 600; color: #1e293b; font-size: 0.88rem;">${escapeHtml(item.fileName)}</div>
        <div style="font-size: 0.75rem; color: #64748b;">${item.fileSize}</div>
      </td>
      <td>
        <input type="text" class="input-order-num" data-index="${index}" value="${escapeHtml(item.orderNumber)}" placeholder="Wpisz nr zlecenia" style="width: 100%; min-width: 130px; padding: 4px 8px; font-size: 0.85rem;" />
      </td>
      <td>
        <select class="select-order-inv" data-index="${index}" style="width: 100%; min-width: 200px; padding: 4px 8px; font-size: 0.85rem;">
          ${optionsHtml}
        </select>
      </td>
      <td>${statusBadge}</td>
      <td style="text-align: center;">
        <button type="button" class="btn btn-secondary btn-small btn-remove-order" data-index="${index}" title="Usuń z listy">✕</button>
      </td>
    `;

    ordersPreviewTbody.appendChild(tr);
  });

  const hasAnyMatch = parsedOrdersQueue.some((item) => item.matchedInvoiceId);
  if (btnSaveOrdersBatch) btnSaveOrdersBatch.disabled = !hasAnyMatch;
}

if (ordersPreviewTbody) {
  ordersPreviewTbody.addEventListener("input", (e) => {
    if (e.target.classList.contains("input-order-num")) {
      const idx = Number(e.target.dataset.index);
      if (parsedOrdersQueue[idx]) {
        parsedOrdersQueue[idx].orderNumber = e.target.value.trim();
        if (!parsedOrdersQueue[idx].matchedInvoiceId && parsedOrdersQueue[idx].orderNumber) {
          const autoMatch = findMatchingInvoiceForOrder(parsedOrdersQueue[idx].orderNumber);
          if (autoMatch) {
            parsedOrdersQueue[idx].matchedInvoiceId = autoMatch.id;
            renderOrdersPreviewQueue();
            return;
          }
        }
      }
    }
  });

  ordersPreviewTbody.addEventListener("change", (e) => {
    if (e.target.classList.contains("select-order-inv")) {
      const idx = Number(e.target.dataset.index);
      if (parsedOrdersQueue[idx]) {
        parsedOrdersQueue[idx].matchedInvoiceId = e.target.value ? e.target.value : null;
        renderOrdersPreviewQueue();
      }
    }
  });

  ordersPreviewTbody.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-remove-order");
    if (btn) {
      const idx = Number(btn.dataset.index);
      parsedOrdersQueue.splice(idx, 1);
      renderOrdersPreviewQueue();
    }
  });
}

async function saveOrdersBatch() {
  const toSave = parsedOrdersQueue.filter((item) => item.matchedInvoiceId);
  if (!toSave.length) {
    if (errOrdersModal) errOrdersModal.textContent = "Przypisz przynajmniej jedno zlecenie do faktury przed zapisem.";
    return;
  }

  if (btnSaveOrdersBatch) {
    btnSaveOrdersBatch.disabled = true;
    btnSaveOrdersBatch.textContent = "Zapisywanie...";
  }
  if (errOrdersModal) errOrdersModal.textContent = "";
  showLoading(`Zapisywanie ${toSave.length} zleceń...`);

  let successCount = 0;
  const failErrors = [];

  for (const item of toSave) {
    try {
      const invId = item.matchedInvoiceId;
      const cleanFileName = item.file.name.replace(/[^a-zA-Z0-9\._\-]/g, "_");
      const filePath = `${invId}/${Date.now()}_${cleanFileName}`;

      const { error: uploadError } = await supabaseClient
        .storage
        .from("orders")
        .upload(filePath, item.file, { upsert: true });

      if (uploadError) {
        throw new Error(`Upload pliku '${item.file.name}' nie powiódł się: ${uploadError.message}. Upewnij się, że bucket 'orders' istnieje w Supabase Storage.`);
      }

      const invoice = allInvoices.find((inv) => String(inv.id) === String(invId));
      const finalOrderNumber = item.orderNumber || (invoice ? invoice.order_number : null) || null;

      const { error: updateError } = await supabaseClient
        .from(TABLE_NAME)
        .update({
          order_number: finalOrderNumber,
          order_file_url: filePath,
          order_file_name: item.fileName,
        })
        .eq("id", invId);

      if (updateError) throw updateError;
      successCount++;
    } catch (err) {
      console.error(err);
      failErrors.push(err.message);
    }
  }

  clearStatus();
  if (btnSaveOrdersBatch) {
    btnSaveOrdersBatch.disabled = false;
    btnSaveOrdersBatch.textContent = "💾 Zapisz i przypisz do faktur";
  }

  if (failErrors.length) {
    if (errOrdersModal) {
      errOrdersModal.textContent = `Zapisano ${successCount} zleceń. Błędy: ${failErrors.join("; ")}`;
    }
    await fetchInvoices();
  } else {
    closeOrdersModal();
    await fetchInvoices();
  }
}

if (btnOpenOrdersUpload) btnOpenOrdersUpload.addEventListener("click", () => openOrdersModal(null));
if (btnCancelOrdersModal) btnCancelOrdersModal.addEventListener("click", closeOrdersModal);
if (btnSaveOrdersBatch) btnSaveOrdersBatch.addEventListener("click", saveOrdersBatch);

if (ordersDropZone) {
  ordersDropZone.addEventListener("click", () => {
    if (ordersFilesInput) ordersFilesInput.click();
  });

  ordersDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    ordersDropZone.classList.add("dragover");
  });

  ordersDropZone.addEventListener("dragleave", () => {
    ordersDropZone.classList.remove("dragover");
  });

  ordersDropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    ordersDropZone.classList.remove("dragover");
    if (e.dataTransfer && e.dataTransfer.files) {
      handleOrdersFilesSelected(e.dataTransfer.files);
    }
  });
}

if (ordersFilesInput) {
  ordersFilesInput.addEventListener("change", (e) => {
    if (e.target.files) {
      handleOrdersFilesSelected(e.target.files);
    }
  });
}

// =========================================================================
// MODUŁ: KOSZTY I WYDATKI (replika komend: koszt, koszty, usun_koszt, przypisz_koszt)
// =========================================================================
let allExpenses = [];
let currentExpenseVehicleModalId = null;

const expensesStatusEl = document.getElementById("expenses-status");
const expensesTbodyEl = document.getElementById("expenses-tbody");
const expFilterMonthEl = document.getElementById("exp-filter-month");
const expFilterVehicleEl = document.getElementById("exp-filter-vehicle");
const expSearchInputEl = document.getElementById("exp-search-input");
const btnOpenAddExpense = document.getElementById("btn-open-add-expense");

const expenseFormModal = document.getElementById("expense-form-modal");
const expenseForm = document.getElementById("expense-form");
const btnCancelExpenseForm = document.getElementById("btn-cancel-expense-form");

const expenseVehicleModal = document.getElementById("expense-vehicle-modal");
const expModalVehicleSelect = document.getElementById("exp-modal-vehicle-select");
const btnSaveExpenseVehicle = document.getElementById("btn-save-expense-vehicle");
const btnCancelExpenseVehicle = document.getElementById("btn-cancel-expense-vehicle");
const expenseVehicleLabel = document.getElementById("expense-vehicle-label");
const errExpenseVehicleModal = document.getElementById("err-expense-vehicle-modal");

function showExpensesStatus(msg, isError = false) {
  if (!expensesStatusEl) return;
  expensesStatusEl.textContent = msg;
  expensesStatusEl.className = `status-bar ${isError ? "error" : "loading"}`.trim();
}

function clearExpensesStatus() {
  if (!expensesStatusEl) return;
  expensesStatusEl.textContent = "";
  expensesStatusEl.className = "status-bar";
}

function parseAllocation(selectedValue) {
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

async function loadExpensesView() {
  if (allVehicles.length === 0) {
    await loadVehiclesAndDrivers();
  }
  await fetchExpenses();
}

async function fetchExpenses() {
  showExpensesStatus("Wczytywanie wydatków...");
  try {
    const month = expFilterMonthEl ? expFilterMonthEl.value : "";
    let query = supabaseClient
      .from("expenses")
      .select("id, category, amount, expense_month, description, vehicle_id, allocation_type, source, created_at")
      .order("created_at", { ascending: false });

    if (month) {
      query = query.eq("expense_month", month);
    }

    const { data, error } = await query;
    if (error) throw error;

    allExpenses = data || [];
    renderExpensesTable();
    clearExpensesStatus();
  } catch (err) {
    console.error(err);
    showExpensesStatus("Nie udało się wczytać wydatków — sprawdź połączenie.", true);
  }
}

function renderExpensesTable() {
  if (!expensesTbodyEl) return;
  expensesTbodyEl.innerHTML = "";

  const vehicleFilter = expFilterVehicleEl ? expFilterVehicleEl.value : "all";
  const search = expSearchInputEl ? expSearchInputEl.value.trim().toLowerCase() : "";

  let list = [...allExpenses];

  if (vehicleFilter === "unassigned") {
    list = list.filter((e) => !e.vehicle_id && e.allocation_type !== "shared");
  } else if (vehicleFilter === "shared") {
    list = list.filter((e) => e.allocation_type === "shared");
  } else if (vehicleFilter !== "all") {
    list = list.filter((e) => e.allocation_type === "vehicle" && String(e.vehicle_id) === String(vehicleFilter));
  }

  if (search) {
    list = list.filter((e) => {
      const cat = (e.category || "").toLowerCase();
      const desc = (e.description || "").toLowerCase();
      return cat.includes(search) || desc.includes(search);
    });
  }

  if (!list.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="8" style="text-align:center; color:#6b7280;">Brak kosztów do wyświetlenia w tym miesiącu.</td>`;
    expensesTbodyEl.appendChild(tr);
    return;
  }

  list.forEach((e) => {
    const tr = document.createElement("tr");
    const sourceBadge = e.source === "e100" ? `<span class="badge badge-service-month">E100</span> ` : "";
    const dateStr = e.created_at ? e.created_at.slice(0, 10) : "-";

    tr.innerHTML = `
      <td data-label="ID">#${e.id}</td>
      <td data-label="Kategoria"><strong>${escapeHtml(String(e.category || "").toUpperCase())}</strong></td>
      <td data-label="Kwota">${formatAmount(e.amount, "PLN")}</td>
      <td data-label="Miesiąc">${escapeHtml(e.expense_month || "-")}</td>
      <td data-label="Opis">${sourceBadge}${escapeHtml(e.description || "-")}</td>
      <td data-label="Przypisanie">${renderVehicleBadge(e)}</td>
      <td data-label="Data wpisu">${dateStr}</td>
      <td data-label="Akcje">
        <div class="row-actions">
          <button class="btn btn-secondary btn-small" data-expense-action="assign" data-id="${e.id}">Pojazd</button>
          <button class="btn btn-secondary btn-small" data-expense-action="delete" data-id="${e.id}" style="color:var(--color-danger)">Usuń</button>
        </div>
      </td>
    `;
    expensesTbodyEl.appendChild(tr);
  });
}

if (expFilterMonthEl) expFilterMonthEl.addEventListener("change", fetchExpenses);
if (expFilterVehicleEl) expFilterVehicleEl.addEventListener("change", renderExpensesTable);
if (expSearchInputEl) expSearchInputEl.addEventListener("input", renderExpensesTable);

if (expensesTbodyEl) {
  expensesTbodyEl.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button[data-expense-action]");
    if (!btn) return;
    const action = btn.dataset.expenseAction;
    const id = btn.dataset.id;
    const expense = allExpenses.find((e) => String(e.id) === String(id));
    if (!expense) return;

    if (action === "assign") {
      openExpenseVehicleModal(expense);
    } else if (action === "delete") {
      openConfirmModal(
        `Czy na pewno usunąć wydatek #${expense.id} (${String(expense.category).toUpperCase()}, ${expense.amount} PLN)?`,
        async () => {
          showExpensesStatus("Usuwanie wydatku...");
          try {
            const { error } = await supabaseClient.from("expenses").delete().eq("id", expense.id);
            if (error) throw error;
            await fetchExpenses();
          } catch (err) {
            console.error(err);
            showExpensesStatus("Nie udało się usunąć kosztu: " + err.message, true);
          }
        }
      );
    }
  });
}

function openExpenseForm() {
  if (!expenseFormModal) return;
  expenseForm.reset();
  document.getElementById("err-exp-amount").textContent = "";
  document.getElementById("err-exp-month").textContent = "";
  const curMonth = expFilterMonthEl?.value || new Date().toISOString().slice(0, 7);
  document.getElementById("exp-month").value = curMonth;
  expenseFormModal.classList.remove("hidden");
}

function closeExpenseForm() {
  if (expenseFormModal) expenseFormModal.classList.add("hidden");
}

if (btnOpenAddExpense) btnOpenAddExpense.addEventListener("click", openExpenseForm);
if (btnCancelExpenseForm) btnCancelExpenseForm.addEventListener("click", closeExpenseForm);

if (expenseForm) {
  expenseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const category = document.getElementById("exp-category").value;
    const amountRaw = document.getElementById("exp-amount").value.trim();
    const month = document.getElementById("exp-month").value.trim();
    const vehicleVal = document.getElementById("exp-vehicle").value;
    const description = document.getElementById("exp-description").value.trim();

    let valid = true;
    const errAmt = document.getElementById("err-exp-amount");
    const errM = document.getElementById("err-exp-month");
    errAmt.textContent = "";
    errM.textContent = "";

    const amount = Number(amountRaw);
    if (!amountRaw || Number.isNaN(amount) || amount <= 0) {
      errAmt.textContent = "Podaj poprawną kwotę większą od 0.";
      valid = false;
    }

    if (!/^\d{4}-\d{2}$/.test(month)) {
      errM.textContent = "Format miesiąca: RRRR-MM (np. 2026-09).";
      valid = false;
    }

    if (!valid) return;

    const alloc = parseAllocation(vehicleVal);
    showExpensesStatus("Zapisywanie wydatku...");

    try {
      const { error } = await supabaseClient.from("expenses").insert({
        category,
        amount: Math.round(amount * 100) / 100,
        expense_month: month,
        description: description || null,
        vehicle_id: alloc.vehicle_id,
        allocation_type: alloc.allocation_type,
      });

      if (error) throw error;
      closeExpenseForm();
      await fetchExpenses();
    } catch (err) {
      console.error(err);
      showExpensesStatus("Nie udało się zapisać wydatku: " + err.message, true);
    }
  });
}

function openExpenseVehicleModal(expense) {
  if (!expenseVehicleModal) return;
  currentExpenseVehicleModalId = expense.id;
  if (expenseVehicleLabel) {
    expenseVehicleLabel.textContent = `Koszt #${expense.id} (${String(expense.category).toUpperCase()} - ${expense.amount} PLN)`;
  }
  if (errExpenseVehicleModal) errExpenseVehicleModal.textContent = "";

  if (expModalVehicleSelect) {
    if (expense.allocation_type === "shared") {
      expModalVehicleSelect.value = "shared";
    } else if (expense.allocation_type === "vehicle" && expense.vehicle_id) {
      expModalVehicleSelect.value = String(expense.vehicle_id);
    } else {
      expModalVehicleSelect.value = "unassigned";
    }
  }

  expenseVehicleModal.classList.remove("hidden");
}

function closeExpenseVehicleModal() {
  if (expenseVehicleModal) expenseVehicleModal.classList.add("hidden");
  currentExpenseVehicleModalId = null;
}

if (btnCancelExpenseVehicle) btnCancelExpenseVehicle.addEventListener("click", closeExpenseVehicleModal);

if (btnSaveExpenseVehicle) {
  btnSaveExpenseVehicle.addEventListener("click", async () => {
    if (!currentExpenseVehicleModalId) return;
    const selectedVal = expModalVehicleSelect ? expModalVehicleSelect.value : "unassigned";
    const alloc = parseAllocation(selectedVal);

    showExpensesStatus("Przypisywanie kosztu...");
    try {
      const { error } = await supabaseClient
        .from("expenses")
        .update({
          vehicle_id: alloc.vehicle_id,
          allocation_type: alloc.allocation_type,
        })
        .eq("id", currentExpenseVehicleModalId);

      if (error) throw error;
      closeExpenseVehicleModal();
      await fetchExpenses();
    } catch (err) {
      console.error(err);
      if (errExpenseVehicleModal) errExpenseVehicleModal.textContent = err.message;
    }
  });
}

// =========================================================================
// MODUŁ: IMPORT RAPORTÓW E100 (.XLSX) (replika parsowania i komendy cofnij_e100)
// =========================================================================
let e100ParsedTransactions = [];
let e100DetectedPlate = "";
let e100ReportPeriod = "";

const e100FileInput = document.getElementById("e100-file-input");
const e100FileDetails = document.getElementById("e100-file-details");
const e100PreviewTbody = document.getElementById("e100-preview-tbody");
const e100PreviewCount = document.getElementById("e100-preview-count");
const e100PreviewSummary = document.getElementById("e100-preview-summary");
const e100TargetMonth = document.getElementById("e100-target-month");
const e100TargetVehicle = document.getElementById("e100-target-vehicle");
const e100FilterFromDate = document.getElementById("e100-filter-from-date");
const btnSaveE100Import = document.getElementById("btn-save-e100-import");
const btnCancelE100Preview = document.getElementById("btn-cancel-e100-preview");

const e100HistoryMonth = document.getElementById("e100-history-month");
const e100HistoryVehicle = document.getElementById("e100-history-vehicle");
const btnLoadE100History = document.getElementById("btn-load-e100-history");
const btnRevertE100 = document.getElementById("btn-revert-e100");
const e100HistorySummary = document.getElementById("e100-history-summary");
const e100HistoryTbody = document.getElementById("e100-history-tbody");

if (e100FileInput) {
  e100FileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target.result);
        if (typeof XLSX === "undefined") {
          throw new Error("Biblioteka SheetJS (XLSX) nie została załadowana.");
        }
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        const cellB2 = worksheet["B2"] ? String(worksheet["B2"].v || "").trim() : "";
        let reportPeriod = "";
        if (cellB2.toLowerCase().includes("okres")) {
          reportPeriod = cellB2.replace(/^.*okres[:\s]*/i, "").trim();
        }
        e100ReportPeriod = reportPeriod;

        let colCar = -1, colDate = -1, colService = -1, colCountry = -1, colAmount = -1, colCurrency = -1, colQty = -1;
        let headerRowIndex = -1;

        for (let r = 0; r < Math.min(rows.length, 25); r++) {
          const row = rows[r] || [];
          for (let c = 0; c < row.length; c++) {
            const val = String(row[c] || "").toLowerCase().trim();
            if (val.includes("samochod") || val.includes("pojazd") || val.includes("numer karty")) colCar = c;
            if (val.includes("data")) colDate = c;
            if (val.includes("usługa") || val.includes("usluga") || val.includes("towar")) colService = c;
            if (val.includes("kraj") || val.includes("państwo")) colCountry = c;
            if (val.includes("kwota") || val.includes("brutto") || val.includes("wartość")) colAmount = c;
            if (val.includes("waluta")) colCurrency = c;
            if (val.includes("ilość") || val.includes("ilosc") || val.includes("litry")) colQty = c;
          }
          if (colDate !== -1 && colAmount !== -1) {
            headerRowIndex = r;
            break;
          }
        }

        if (headerRowIndex === -1) {
          throw new Error("Nie udało się rozpoznać nagłówków kolumn raportu E100 w pliku Excel.");
        }

        const transactions = [];
        let detectedPlate = "";

        for (let r = headerRowIndex + 1; r < rows.length; r++) {
          const row = rows[r];
          if (!row || !row[colDate] || row[colAmount] === undefined) continue;

          if (colCar !== -1 && row[colCar] && !detectedPlate) {
            detectedPlate = String(row[colCar]).trim();
          }

          transactions.push({
            date: String(row[colDate] || "").trim(),
            service: String(row[colService] || "").trim(),
            country: String(row[colCountry] || "").trim().toUpperCase(),
            gross: Number(String(row[colAmount]).replace(",", ".")) || 0,
            currency: String(row[colCurrency] || "PLN").trim().toUpperCase(),
            qty: Number(String(row[colQty] || 0).replace(",", ".")) || 0,
            report_period: reportPeriod || null,
          });
        }

        if (transactions.length === 0) {
          throw new Error("W pliku nie znaleziono żadnych transakcji.");
        }

        e100ParsedTransactions = transactions;
        e100DetectedPlate = detectedPlate;

        if (e100PreviewCount) e100PreviewCount.textContent = transactions.length;

        if (e100TargetVehicle) {
          const cleanPlate = detectedPlate.replace(/[\s-]/g, "").toLowerCase();
          const matchedVeh = allVehicles.find((v) => {
            const vPlate = String(v.plate).replace(/[\s-]/g, "").toLowerCase();
            const vName = String(v.name).replace(/[\s-]/g, "").toLowerCase();
            return cleanPlate.includes(vPlate) || vPlate.includes(cleanPlate) || cleanPlate.includes(vName);
          });
          if (matchedVeh) {
            e100TargetVehicle.value = String(matchedVeh.id);
          } else {
            e100TargetVehicle.value = "unassigned";
          }
        }

        if (e100PreviewTbody) {
          e100PreviewTbody.innerHTML = transactions.slice(0, 50).map((t) => `
            <tr>
              <td>${escapeHtml(t.date)}</td>
              <td>${escapeHtml(t.service)}</td>
              <td>${escapeHtml(t.country)}</td>
              <td>${t.qty > 0 ? t.qty.toFixed(1) + " L" : "-"}</td>
              <td>${t.gross.toFixed(2)}</td>
              <td>${escapeHtml(t.currency)}</td>
            </tr>
          `).join("");
        }

        const totalGrossPreview = transactions.reduce((s, t) => s + t.gross, 0);
        if (e100PreviewSummary) {
          e100PreviewSummary.innerHTML = `
            <div class="result-card">
              <div class="result-label">Liczba transakcji</div>
              <div class="result-value">${transactions.length}</div>
            </div>
            <div class="result-card">
              <div class="result-label">Wykryty pojazd</div>
              <div class="result-value" style="font-size:1.1rem;">${escapeHtml(detectedPlate || "Brak w arkuszu")}</div>
            </div>
            <div class="result-card">
              <div class="result-label">Okres raportu</div>
              <div class="result-value" style="font-size:1rem;">${escapeHtml(reportPeriod || "Wg dat")}</div>
            </div>
          `;
        }

        if (e100FileDetails) e100FileDetails.classList.remove("hidden");
      } catch (err) {
        console.error(err);
        alert("Błąd odczytu pliku E100: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

if (btnCancelE100Preview) {
  btnCancelE100Preview.addEventListener("click", () => {
    e100ParsedTransactions = [];
    if (e100FileDetails) e100FileDetails.classList.add("hidden");
    if (e100FileInput) e100FileInput.value = "";
  });
}

function getVatDivisor(rules, country, kind) {
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

if (btnSaveE100Import) {
  btnSaveE100Import.addEventListener("click", async () => {
    if (!e100ParsedTransactions.length) return;
    const targetMonth = e100TargetMonth?.value;
    if (!targetMonth) {
      alert("Wybierz miesiąc docelowy.");
      return;
    }

    const vehVal = e100TargetVehicle?.value;
    const alloc = parseAllocation(vehVal);
    const filterFromDate = e100FilterFromDate?.value;

    showExpensesStatus("Przeliczam transakcje E100 wg reguł VAT i kursów NBP...");
    btnSaveE100Import.disabled = true;

    try {
      const [{ data: rulesData }, rates] = await Promise.all([
        supabaseClient.from("rules").select("*"),
        getNbpRates(),
      ]);
      const rules = rulesData || [];

      let fuelNetPln = 0;
      let fuelLiters = 0;
      let tollNetPln = 0;
      const detailRows = [];

      for (const t of e100ParsedTransactions) {
        if (filterFromDate && t.date.includes(".")) {
          const parts = t.date.split(".");
          if (parts.length >= 2) {
            const rowIso = `${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
            const filterIso = filterFromDate.slice(5);
            if (rowIso < filterIso) continue;
          }
        }

        const sLow = t.service.toLowerCase();
        const isFuel = sLow.includes("on") || sLow.includes("paliwo") || sLow.includes("diesel");
        const isToll = sLow.includes("drogi") || sLow.includes("toll") || sLow.includes("e-box") || sLow.includes("t4e");

        const divisor = getVatDivisor(rules, t.country, isFuel ? "paliwo" : "myto");
        const net = divisor ? t.gross / divisor : t.gross;
        const exchangeRate = Number(rates[t.currency] || 1);
        const netPln = net * exchangeRate;

        if (isFuel) {
          fuelLiters += Number(t.qty || 0);
          fuelNetPln += netPln;
        } else {
          tollNetPln += netPln;
        }

        detailRows.push({
          vehicle_id: alloc.vehicle_id,
          truck_plate: e100DetectedPlate || "Pojazd",
          transaction_date: t.date,
          service: t.service,
          country: t.country,
          qty: t.qty,
          gross_amount: t.gross,
          currency: t.currency,
          net_amount_pln: Math.round(netPln * 100) / 100,
          expense_month: targetMonth,
          report_period: t.report_period,
        });
      }

      const plateLabel = alloc.vehicle_id
        ? (allVehicles.find((v) => v.id === alloc.vehicle_id)?.plate || e100DetectedPlate)
        : e100DetectedPlate;

      if (fuelNetPln > 0) {
        const { error: fuelErr } = await supabaseClient.from("expenses").insert({
          category: "paliwo",
          amount: Math.round(fuelNetPln * 100) / 100,
          expense_month: targetMonth,
          description: `E100 Paliwo ${plateLabel} (${fuelLiters.toFixed(1)}L)`,
          vehicle_id: alloc.vehicle_id,
          allocation_type: alloc.allocation_type,
          source: "e100",
        });
        if (fuelErr) throw fuelErr;
      }

      if (tollNetPln > 0) {
        const { error: tollErr } = await supabaseClient.from("expenses").insert({
          category: "autostrady",
          amount: Math.round(tollNetPln * 100) / 100,
          expense_month: targetMonth,
          description: `E100 Myto ${plateLabel}`,
          vehicle_id: alloc.vehicle_id,
          allocation_type: alloc.allocation_type,
          source: "e100",
        });
        if (tollErr) throw tollErr;
      }

      if (detailRows.length > 0) {
        const { error: detErr } = await supabaseClient.from("e100_transactions").insert(detailRows);
        if (detErr) {
          console.warn("Zapis bez report_period:", detErr.message);
          const fallback = detailRows.map(({ report_period, ...rest }) => rest);
          await supabaseClient.from("e100_transactions").insert(fallback);
        }
      }

      alert(`✅ Pomyślnie zaimportowano raport E100 do miesiąca ${targetMonth}!\nDodano: Paliwo ${(fuelNetPln).toFixed(2)} PLN, Myto ${(tollNetPln).toFixed(2)} PLN.\nŁącznie pozycji: ${detailRows.length}.`);

      e100ParsedTransactions = [];
      if (e100FileDetails) e100FileDetails.classList.add("hidden");
      if (e100FileInput) e100FileInput.value = "";
      clearExpensesStatus();
      await fetchExpenses();
    } catch (err) {
      console.error(err);
      alert("Błąd zapisu raportu E100: " + err.message);
      clearExpensesStatus();
    } finally {
      btnSaveE100Import.disabled = false;
    }
  });
}

if (btnLoadE100History) {
  btnLoadE100History.addEventListener("click", async () => {
    const month = e100HistoryMonth ? e100HistoryMonth.value : "";
    const veh = e100HistoryVehicle ? e100HistoryVehicle.value : "all";
    if (!month) return;

    showExpensesStatus("Wczytywanie historii transakcji E100...");
    try {
      let query = supabaseClient
        .from("e100_transactions")
        .select("*")
        .eq("expense_month", month)
        .order("id", { ascending: true });

      if (veh !== "all") {
        query = query.eq("vehicle_id", veh);
      }

      const { data, error } = await query;
      if (error) throw error;

      const items = data || [];
      const totalNet = items.reduce((s, i) => s + (Number(i.net_amount_pln) || 0), 0);
      const totalLiters = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);

      if (e100HistorySummary) {
        e100HistorySummary.innerHTML = `
          <div class="result-cards" style="margin-top:12px;">
            <div class="result-card">
              <div class="result-label">Liczba transakcji</div>
              <div class="result-value">${items.length}</div>
            </div>
            <div class="result-card">
              <div class="result-label">Paliwo łącznie</div>
              <div class="result-value">${totalLiters.toFixed(1)} L</div>
            </div>
            <div class="result-card">
              <div class="result-label">Łączny koszt netto</div>
              <div class="result-value">${totalNet.toFixed(2)} PLN</div>
            </div>
          </div>
        `;
      }

      if (e100HistoryTbody) {
        if (!items.length) {
          e100HistoryTbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#6b7280;">Brak transakcji E100 w wybranym miesiącu.</td></tr>`;
        } else {
          e100HistoryTbody.innerHTML = items.map((i) => `
            <tr>
              <td>${escapeHtml(i.transaction_date || "-")}</td>
              <td>${escapeHtml(i.truck_plate || "-")}</td>
              <td>${escapeHtml(i.service || "-")}</td>
              <td>${escapeHtml(i.country || "-")}</td>
              <td>${Number(i.qty) > 0 ? Number(i.qty).toFixed(1) + " L" : "-"}</td>
              <td>${Number(i.gross_amount || 0).toFixed(2)} ${escapeHtml(i.currency || "PLN")}</td>
              <td>${Number(i.net_amount_pln || 0).toFixed(2)} PLN</td>
              <td>${escapeHtml(i.report_period || "-")}</td>
            </tr>
          `).join("");
        }
      }
      clearExpensesStatus();
    } catch (err) {
      console.error(err);
      showExpensesStatus("Błąd wczytywania transakcji E100: " + err.message, true);
    }
  });
}

if (btnRevertE100) {
  btnRevertE100.addEventListener("click", () => {
    const month = e100HistoryMonth ? e100HistoryMonth.value : "";
    if (!month) return;

    openConfirmModal(
      `Czy na pewno chcesz cofnąć import E100 dla miesiąca ${month}? Zostaną usunięte wszystkie wpisy kosztów E100 oraz szczegółowe transakcje.`,
      async () => {
        showExpensesStatus("Cofanie importu E100...");
        try {
          const { error: expErr } = await supabaseClient
            .from("expenses")
            .delete()
            .eq("expense_month", month)
            .or("source.eq.e100,description.ilike.E100%");
          if (expErr) throw expErr;

          const { error: trErr } = await supabaseClient
            .from("e100_transactions")
            .delete()
            .eq("expense_month", month);
          if (trErr) console.warn(trErr.message);

          alert(`Pomyślnie cofnięto import E100 za miesiąc ${month}!`);
          clearExpensesStatus();
          await fetchExpenses();
          if (e100HistoryTbody) e100HistoryTbody.innerHTML = "";
          if (e100HistorySummary) e100HistorySummary.innerHTML = "";
        } catch (err) {
          console.error(err);
          showExpensesStatus("Błąd usuwania importu E100: " + err.message, true);
        }
      }
    );
  });
}

// =========================================================================
// MODUŁ: KIEROWCY I TRASY (replika komend: kierowca, wyjazd, zjazd, trasa, wyjazdy, usun_wyjazd)
// =========================================================================
let allDrivers = [];
let allTrips = [];

const driversStatusEl = document.getElementById("drivers-status");
const driversTbody = document.getElementById("drivers-tbody");
const tripsTbody = document.getElementById("trips-tbody");
const btnOpenAddDriver = document.getElementById("btn-open-add-driver");
const driverFormModal = document.getElementById("driver-form-modal");
const driverForm = document.getElementById("driver-form");
const btnCancelDriverForm = document.getElementById("btn-cancel-driver-form");

const tripStartModal = document.getElementById("trip-start-modal");
const tripStartForm = document.getElementById("trip-start-form");
const btnOpenTripStart = document.getElementById("btn-open-trip-start");
const btnCancelTripStart = document.getElementById("btn-cancel-trip-start");

const tripEndModal = document.getElementById("trip-end-modal");
const tripEndForm = document.getElementById("trip-end-form");
const tripEndActiveSelect = document.getElementById("trip-end-active-select");
const btnOpenTripEnd = document.getElementById("btn-open-trip-end");
const btnCancelTripEnd = document.getElementById("btn-cancel-trip-end");

const tripManualModal = document.getElementById("trip-manual-modal");
const tripManualForm = document.getElementById("trip-manual-form");
const btnOpenTripManual = document.getElementById("btn-open-trip-manual");
const btnCancelTripManual = document.getElementById("btn-cancel-trip-manual");

const tripsFilterDriver = document.getElementById("trips-filter-driver");
const tripsFilterMonth = document.getElementById("trips-filter-month");

function showDriversStatus(msg, isError = false) {
  if (!driversStatusEl) return;
  driversStatusEl.textContent = msg;
  driversStatusEl.className = `status-bar ${isError ? "error" : "loading"}`.trim();
}

function clearDriversStatus() {
  if (!driversStatusEl) return;
  driversStatusEl.textContent = "";
  driversStatusEl.className = "status-bar";
}

async function loadDriversView() {
  await Promise.all([fetchDrivers(), fetchTrips()]);
}

async function fetchDrivers() {
  showDriversStatus("Wczytywanie kierowców...");
  try {
    const { data, error } = await supabaseClient.from("drivers").select("*").order("name");
    if (error) throw error;
    allDrivers = data || [];
    renderDriversTable();
    clearDriversStatus();
  } catch (err) {
    console.error(err);
    showDriversStatus("Błąd wczytywania kierowców: " + err.message, true);
  }
}

function renderDriversTable() {
  if (!driversTbody) return;
  driversTbody.innerHTML = "";

  if (!allDrivers.length) {
    driversTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#6b7280;">Brak zdefiniowanych kierowców w bazie.</td></tr>`;
    return;
  }

  allDrivers.forEach((d) => {
    const tr = document.createElement("tr");
    const activeBadge = d.active
      ? `<span class="badge badge-active">Aktywny</span>`
      : `<span class="badge badge-inactive">Nieaktywny</span>`;

    tr.innerHTML = `
      <td data-label="Kierowca"><strong>${escapeHtml(d.name)}</strong></td>
      <td data-label="Podstawa">${Number(d.base_salary || 0).toFixed(2)} PLN</td>
      <td data-label="Dniówka">${Number(d.daily_rate || 0).toFixed(2)} PLN/dzień</td>
      <td data-label="Domyślny pojazd">${escapeHtml(d.default_vehicle || "—")}</td>
      <td data-label="Stan">${activeBadge}</td>
      <td data-label="Akcje">
        <div class="row-actions">
          <button class="btn btn-secondary btn-small" data-driver-action="edit" data-id="${d.id}">Edytuj stawkę</button>
          <button class="btn btn-secondary btn-small" data-driver-action="toggle-active" data-id="${d.id}" data-active="${d.active}">
            ${d.active ? "Wyłącz" : "Włącz"}
          </button>
        </div>
      </td>
    `;
    driversTbody.appendChild(tr);
  });
}

if (driversTbody) {
  driversTbody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-driver-action]");
    if (!btn) return;
    const action = btn.dataset.driverAction;
    const id = btn.dataset.id;
    const driver = allDrivers.find((d) => String(d.id) === String(id));
    if (!driver) return;

    if (action === "edit") {
      document.getElementById("driver-form-title").textContent = `Edytuj kierowcę: ${driver.name}`;
      document.getElementById("driver-name-input").value = driver.name;
      document.getElementById("driver-base-input").value = driver.base_salary || "";
      document.getElementById("driver-rate-input").value = driver.daily_rate || "";
      if (document.getElementById("driver-vehicle-input")) {
        document.getElementById("driver-vehicle-input").value = driver.default_vehicle || "";
      }
      driverFormModal.classList.remove("hidden");
    } else if (action === "toggle-active") {
      const cur = btn.dataset.active === "true";
      showDriversStatus("Zmieniam stan kierowcy...");
      try {
        const { error } = await supabaseClient.from("drivers").update({ active: !cur }).eq("id", driver.id);
        if (error) throw error;
        await fetchDrivers();
      } catch (err) {
        showDriversStatus(err.message, true);
      }
    }
  });
}

if (btnOpenAddDriver) {
  btnOpenAddDriver.addEventListener("click", () => {
    document.getElementById("driver-form-title").textContent = "Dodaj kierowcę";
    driverForm.reset();
    driverFormModal.classList.remove("hidden");
  });
}

if (btnCancelDriverForm) {
  btnCancelDriverForm.addEventListener("click", () => {
    driverFormModal.classList.add("hidden");
  });
}

if (driverForm) {
  driverForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("driver-name-input").value.trim();
    const base = Number(document.getElementById("driver-base-input").value) || 0;
    const rate = Number(document.getElementById("driver-rate-input").value) || 0;
    const defVeh = document.getElementById("driver-vehicle-input")?.value || null;

    if (!name) return;

    showDriversStatus("Zapisywanie kierowcy...");
    try {
      const { error } = await supabaseClient
        .from("drivers")
        .upsert(
          { name, base_salary: base, daily_rate: rate, default_vehicle: defVeh, active: true },
          { onConflict: "name" }
        );

      if (error) throw error;
      driverFormModal.classList.add("hidden");
      await fetchDrivers();
      await loadVehiclesAndDrivers();
    } catch (err) {
      showDriversStatus("Błąd zapisu kierowcy: " + err.message, true);
    }
  });
}

// EWIDENCJA TRAS
async function fetchTrips() {
  showDriversStatus("Wczytywanie tras...");
  try {
    const { data, error } = await supabaseClient
      .from("driver_trips")
      .select("*")
      .order("start_date", { ascending: false });

    if (error) throw error;
    allTrips = data || [];
    renderTripsTable();
    clearDriversStatus();
  } catch (err) {
    console.error(err);
    showDriversStatus("Błąd wczytywania tras: " + err.message, true);
  }
}

function renderTripsTable() {
  if (!tripsTbody) return;
  tripsTbody.innerHTML = "";

  const filterDrv = tripsFilterDriver ? tripsFilterDriver.value : "all";
  const filterM = tripsFilterMonth ? tripsFilterMonth.value : "all";

  let list = [...allTrips];

  if (filterDrv !== "all") {
    list = list.filter((t) => (t.driver_name || "").toLowerCase() === filterDrv.toLowerCase());
  }

  if (filterM !== "all") {
    list = list.filter((t) => (t.start_date && t.start_date.startsWith(filterM)) || (t.end_date && t.end_date.startsWith(filterM)));
  }

  if (!list.length) {
    tripsTbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#6b7280;">Brak zarejestrowanych tras.</td></tr>`;
    return;
  }

  list.forEach((t) => {
    const tr = document.createElement("tr");
    const isOngoing = !t.end_date;
    const statusBadge = isOngoing
      ? `<span class="badge badge-trip-ongoing">🟢 W trasie</span>`
      : `<span class="badge badge-trip-finished">Zakończona</span>`;

    const finishBtn = isOngoing
      ? `<button class="btn btn-primary btn-small" data-trip-action="finish" data-id="${t.id}">Zakończ zjazd</button>`
      : "";

    tr.innerHTML = `
      <td data-label="ID">#${t.id}</td>
      <td data-label="Kierowca"><strong>${escapeHtml(t.driver_name)}</strong></td>
      <td data-label="Data od">${t.start_date || "-"}</td>
      <td data-label="Data do">${t.end_date || "—"}</td>
      <td data-label="Dni">${t.days_count != null ? t.days_count + " dni" : "—"}</td>
      <td data-label="Opis">${escapeHtml(t.description || "-")}</td>
      <td data-label="Status">${statusBadge}</td>
      <td data-label="Akcje">
        <div class="row-actions">
          ${finishBtn}
          <button class="btn btn-secondary btn-small" data-trip-action="delete" data-id="${t.id}" style="color:var(--color-danger)">Usuń</button>
        </div>
      </td>
    `;
    tripsTbody.appendChild(tr);
  });
}

if (tripsFilterDriver) tripsFilterDriver.addEventListener("change", renderTripsTable);
if (tripsFilterMonth) tripsFilterMonth.addEventListener("change", renderTripsTable);

if (tripsTbody) {
  tripsTbody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-trip-action]");
    if (!btn) return;
    const action = btn.dataset.tripAction;
    const id = btn.dataset.id;
    const trip = allTrips.find((t) => String(t.id) === String(id));
    if (!trip) return;

    if (action === "finish") {
      openTripEndModal(trip.id);
    } else if (action === "delete") {
      openConfirmModal(
        `Czy na pewno usunąć wyjazd #${trip.id} kierowcy ${trip.driver_name} (${trip.start_date})?`,
        async () => {
          showDriversStatus("Usuwanie wyjazdu...");
          try {
            const { error } = await supabaseClient.from("driver_trips").delete().eq("id", trip.id);
            if (error) throw error;
            await fetchTrips();
          } catch (err) {
            showDriversStatus(err.message, true);
          }
        }
      );
    }
  });
}

// WYJAZD
if (btnOpenTripStart) {
  btnOpenTripStart.addEventListener("click", () => {
    tripStartForm.reset();
    document.getElementById("trip-start-date").value = new Date().toISOString().slice(0, 10);
    tripStartModal.classList.remove("hidden");
  });
}
if (btnCancelTripStart) btnCancelTripStart.addEventListener("click", () => tripStartModal.classList.add("hidden"));

if (tripStartForm) {
  tripStartForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const driver = document.getElementById("trip-start-driver").value;
    const startDate = document.getElementById("trip-start-date").value;
    const desc = document.getElementById("trip-start-desc").value.trim();

    if (!driver || !startDate) return;

    showDriversStatus("Rejestracja wyjazdu...");
    try {
      const { error } = await supabaseClient.from("driver_trips").insert({
        driver_name: driver,
        start_date: startDate,
        description: desc || null,
      });

      if (error) throw error;
      tripStartModal.classList.add("hidden");
      await fetchTrips();
    } catch (err) {
      showDriversStatus(err.message, true);
    }
  });
}

// ZJAZD
function openTripEndModal(selectedTripId = null) {
  if (!tripEndModal) return;
  const activeTrips = allTrips.filter((t) => !t.end_date);

  if (activeTrips.length === 0) {
    alert("Brak kierowców będących obecnie w trasie.");
    return;
  }

  tripEndActiveSelect.innerHTML = activeTrips.map((t) => `
    <option value="${t.id}" ${selectedTripId && String(t.id) === String(selectedTripId) ? "selected" : ""}>
      ${escapeHtml(t.driver_name)} (od ${t.start_date}${t.description ? ` - ${escapeHtml(t.description)}` : ""})
    </option>
  `).join("");

  document.getElementById("trip-end-date").value = new Date().toISOString().slice(0, 10);
  tripEndModal.classList.remove("hidden");
}

if (btnOpenTripEnd) btnOpenTripEnd.addEventListener("click", () => openTripEndModal());
if (btnCancelTripEnd) btnCancelTripEnd.addEventListener("click", () => tripEndModal.classList.add("hidden"));

if (tripEndForm) {
  tripEndForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tripId = tripEndActiveSelect.value;
    const endDate = document.getElementById("trip-end-date").value;
    const trip = allTrips.find((t) => String(t.id) === String(tripId));

    if (!trip || !endDate) return;

    const sMs = new Date(trip.start_date).getTime();
    const eMs = new Date(endDate).getTime();
    const daysCount = Math.max(1, Math.round((eMs - sMs) / (1000 * 60 * 60 * 24)) + 1);

    showDriversStatus("Zapisywanie zjazdu...");
    try {
      const { error } = await supabaseClient
        .from("driver_trips")
        .update({
          end_date: endDate,
          days_count: daysCount,
        })
        .eq("id", trip.id);

      if (error) throw error;
      tripEndModal.classList.add("hidden");
      await fetchTrips();
    } catch (err) {
      showDriversStatus(err.message, true);
    }
  });
}

// TRASA ARCHIWALNA
if (btnOpenTripManual) {
  btnOpenTripManual.addEventListener("click", () => {
    tripManualForm.reset();
    document.getElementById("trip-manual-start").value = new Date().toISOString().slice(0, 10);
    document.getElementById("trip-manual-end").value = new Date().toISOString().slice(0, 10);
    tripManualModal.classList.remove("hidden");
  });
}
if (btnCancelTripManual) btnCancelTripManual.addEventListener("click", () => tripManualModal.classList.add("hidden"));

if (tripManualForm) {
  tripManualForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const driver = document.getElementById("trip-manual-driver").value;
    const startDate = document.getElementById("trip-manual-start").value;
    const endDate = document.getElementById("trip-manual-end").value;
    const desc = document.getElementById("trip-manual-desc").value.trim();

    if (!driver || !startDate || !endDate) return;

    const sMs = new Date(startDate).getTime();
    const eMs = new Date(endDate).getTime();
    const daysCount = Math.max(1, Math.round((eMs - sMs) / (1000 * 60 * 60 * 24)) + 1);

    showDriversStatus("Dodawanie trasy...");
    try {
      const { error } = await supabaseClient.from("driver_trips").insert({
        driver_name: driver,
        start_date: startDate,
        end_date: endDate,
        days_count: daysCount,
        description: desc || null,
      });

      if (error) throw error;
      tripManualModal.classList.add("hidden");
      await fetchTrips();
    } catch (err) {
      showDriversStatus(err.message, true);
    }
  });
}

// =========================================================================
// MODUŁ: ZARZĄDZANIE POJAZDAMI (replika komend: pojazdy, pojazd_dodaj)
// =========================================================================
const vehiclesStatusEl = document.getElementById("vehicles-status");
const vehiclesTbody = document.getElementById("vehicles-tbody");
const btnOpenAddVehicle = document.getElementById("btn-open-add-vehicle");
const vehicleFormModal = document.getElementById("vehicle-form-modal");
const vehicleForm = document.getElementById("vehicle-form");
const btnCancelVehicleForm = document.getElementById("btn-cancel-vehicle-form");

function showVehiclesStatus(msg, isError = false) {
  if (!vehiclesStatusEl) return;
  vehiclesStatusEl.textContent = msg;
  vehiclesStatusEl.className = `status-bar ${isError ? "error" : "loading"}`.trim();
}

function clearVehiclesStatus() {
  if (!vehiclesStatusEl) return;
  vehiclesStatusEl.textContent = "";
  vehiclesStatusEl.className = "status-bar";
}

async function loadVehiclesView() {
  await fetchVehiclesList();
}

async function fetchVehiclesList() {
  showVehiclesStatus("Wczytywanie pojazdów...");
  try {
    const { data, error } = await supabaseClient.from("vehicles").select("*").order("name");
    if (error) throw error;
    allVehicles = data || [];
    renderVehiclesTable();
    updateVehicleSelects();
    clearVehiclesStatus();
  } catch (err) {
    console.error(err);
    showVehiclesStatus("Błąd wczytywania pojazdów: " + err.message, true);
  }
}

function renderVehiclesTable() {
  if (!vehiclesTbody) return;
  vehiclesTbody.innerHTML = "";

  if (!allVehicles.length) {
    vehiclesTbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#6b7280;">Brak zdefiniowanych pojazdów w bazie.</td></tr>`;
    return;
  }

  allVehicles.forEach((v) => {
    const tr = document.createElement("tr");
    const activeBadge = v.active
      ? `<span class="badge badge-active">Aktywny</span>`
      : `<span class="badge badge-inactive">Nieaktywny</span>`;

    tr.innerHTML = `
      <td data-label="ID">#${v.id}</td>
      <td data-label="Nazwa"><strong>${escapeHtml(String(v.name).toUpperCase())}</strong></td>
      <td data-label="Rejestracja">${escapeHtml(v.plate)}</td>
      <td data-label="Stan">${activeBadge}</td>
      <td data-label="Akcje">
        <div class="row-actions">
          <button class="btn btn-secondary btn-small" data-veh-action="toggle-active" data-id="${v.id}" data-active="${v.active}">
            ${v.active ? "Wyłącz" : "Włącz"}
          </button>
        </div>
      </td>
    `;
    vehiclesTbody.appendChild(tr);
  });
}

if (vehiclesTbody) {
  vehiclesTbody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-veh-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const v = allVehicles.find((veh) => String(veh.id) === String(id));
    if (!v) return;

    const cur = btn.dataset.active === "true";
    showVehiclesStatus("Zmieniam stan pojazdu...");
    try {
      const { error } = await supabaseClient.from("vehicles").update({ active: !cur }).eq("id", v.id);
      if (error) throw error;
      await fetchVehiclesList();
      await loadVehiclesAndDrivers();
    } catch (err) {
      showVehiclesStatus(err.message, true);
    }
  });
}

if (btnOpenAddVehicle) {
  btnOpenAddVehicle.addEventListener("click", () => {
    vehicleForm.reset();
    vehicleFormModal.classList.remove("hidden");
  });
}

if (btnCancelVehicleForm) {
  btnCancelVehicleForm.addEventListener("click", () => {
    vehicleFormModal.classList.add("hidden");
  });
}

if (vehicleForm) {
  vehicleForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("veh-name-input").value.trim().toLowerCase();
    const plate = document.getElementById("veh-plate-input").value.trim().toUpperCase();

    if (!name || !plate) return;

    showVehiclesStatus("Dodawanie pojazdu...");
    try {
      const { error } = await supabaseClient.from("vehicles").upsert(
        { name, plate, active: true },
        { onConflict: "plate" }
      );

      if (error) throw error;
      vehicleFormModal.classList.add("hidden");
      await fetchVehiclesList();
      await loadVehiclesAndDrivers();
    } catch (err) {
      showVehiclesStatus("Błąd dodawania pojazdu: " + err.message, true);
    }
  });
}

// INICJALIZACJA
// =========================================================================
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", async () => {
    const { data } = await supabaseClient.auth.getSession();
    renderAuthState(data.session);
    if (data.session) {
      await loadVehiclesAndDrivers();
      await fetchInvoices();
    }
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getMonthRange,
    getMonthInvoiceFilter,
    invoiceBelongsToMonth,
    generateMonthOptions,
    renderVehicleBadge
  };
}
