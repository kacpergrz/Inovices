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
// NAWIGACJA GLOWNA: FAKTURY / WYNIKI
// =========================================================================
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.dataset.target;
    appView.classList.toggle("hidden", target !== "app-view");
    resultsView.classList.toggle("hidden", target !== "results-view");
    rulesView.classList.toggle("hidden", target !== "rules-view");
    if (target === "rules-view") loadRulesView();
  });
});

// Nawigacja pod-zakladek wewnatrz Wynikow
document.querySelectorAll(".sub-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".sub-tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.dataset.subtarget;
    document.querySelectorAll(".sub-panel").forEach((panel) => {
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
        "id, invoice_number, ksef_number, seller_name, seller_nip, issue_date, due_date, net_amount, gross_amount, currency, paid, vehicle_id, allocation_type, service_month"
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

function renderTable(invoices) {
  tbodyEl.innerHTML = "";

  if (!invoices.length) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = `<td colspan="12" style="text-align:center; color:#6b7280;">Brak faktur do wyświetlenia.</td>`;
    tbodyEl.appendChild(emptyRow);
    return;
  }

  invoices.forEach((invoice) => {
    const tr = document.createElement("tr");

    const statusBadge = invoice.paid
      ? `<span class="badge badge-paid">Opłacona</span>`
      : `<span class="badge badge-unpaid">Nieopłacona</span>`;

    tr.innerHTML = `
      <td data-label="Numer faktury">${escapeHtml(invoice.invoice_number || "-")}</td>
      <td data-label="Numer KSeF">${escapeHtml(invoice.ksef_number || "-")}</td>
      <td data-label="Sprzedawca">${escapeHtml(invoice.seller_name || "-")}</td>
      <td data-label="NIP">${escapeHtml(invoice.seller_nip || "-")}</td>
      <td data-label="Data wystawienia">${invoice.issue_date || "-"}${invoice.service_month ? `<br><span class="badge badge-service-month" title="Przypisano do miesiąca: ${escapeHtml(invoice.service_month)}">Rozl.: ${escapeHtml(invoice.service_month)}</span>` : ""}</td>
      <td data-label="Termin płatności">${invoice.due_date || "-"}</td>
      <td data-label="Netto">${formatAmount(invoice.net_amount, invoice.currency)}</td>
      <td data-label="Brutto">${formatAmount(invoice.gross_amount, invoice.currency)}</td>
      <td data-label="Waluta">${escapeHtml(invoice.currency || "-")}</td>
      <td data-label="Status">${statusBadge}</td>
      <td data-label="Pojazd">${renderVehicleBadge(invoice)}</td>
      <td data-label="Akcje">
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

  const formData = {
    invoice_number: document.getElementById("f-invoice-number").value,
    ksef_number: document.getElementById("f-ksef-number").value || null,
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
  ["wp-month-select", "wy-month-select", "pp-month-select", "por-month-select"].forEach((id) => {
    document.getElementById(id).innerHTML = monthOptions;
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
    document.getElementById("wp-vehicle-select").innerHTML = vehicleOptions;
    document.getElementById("pp-vehicle-select").innerHTML = vehicleOptions;

    updateVehicleSelects();
    updateServiceMonthSelect();

    if (allInvoices.length > 0) {
      applyFiltersAndRender();
    }

    const { data: drivers, error: drvError } = await supabaseClient
      .from("drivers")
      .select("name")
      .eq("active", true)
      .order("name");
    if (drvError) throw drvError;

    const driverOptions = (drivers || [])
      .map((d) => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`)
      .join("");
    document.getElementById("wy-driver-select").innerHTML = driverOptions;
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
