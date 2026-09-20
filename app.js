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
let currentEditInvoiceId = null;
let currentDueDateInvoiceId = null;
let pendingConfirmAction = null;

// =========================================================================
// ELEMENTY DOM - FAKTURY
// =========================================================================
const globalStatusEl = document.getElementById("global-status");
const searchInputEl = document.getElementById("search-input");
const filterStatusEl = document.getElementById("filter-status");
const sortSelectEl = document.getElementById("sort-select");
const tbodyEl = document.getElementById("invoices-tbody");

const invoiceFormModal = document.getElementById("invoice-form-modal");
const invoiceForm = document.getElementById("invoice-form");
const invoiceFormTitle = document.getElementById("invoice-form-title");

const confirmModal = document.getElementById("confirm-modal");
const confirmModalText = document.getElementById("confirm-modal-text");

const dueDateModal = document.getElementById("due-date-modal");

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const resultsView = document.getElementById("results-view");
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
    await fetchInvoices();
    await loadVehiclesAndDrivers();
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
        "id, invoice_number, ksef_number, seller_name, seller_nip, issue_date, due_date, net_amount, gross_amount, currency, paid"
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

// =========================================================================
// RENDEROWANIE TABELI FAKTUR
// =========================================================================
function renderTable(invoices) {
  tbodyEl.innerHTML = "";

  if (!invoices.length) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = `<td colspan="11" style="text-align:center; color:#6b7280;">Brak faktur do wyświetlenia.</td>`;
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
      <td data-label="Data wystawienia">${invoice.issue_date || "-"}</td>
      <td data-label="Termin płatności">${invoice.due_date || "-"}</td>
      <td data-label="Netto">${formatAmount(invoice.net_amount, invoice.currency)}</td>
      <td data-label="Brutto">${formatAmount(invoice.gross_amount, invoice.currency)}</td>
      <td data-label="Waluta">${escapeHtml(invoice.currency || "-")}</td>
      <td data-label="Status">${statusBadge}</td>
      <td data-label="Akcje">
        <div class="row-actions">
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
    paid: document.getElementById("f-paid").value === "true"
  };

  if (!validateInvoiceForm(formData)) return;

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
    paid: formData.paid
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
  const endOfMonth = new Date(year, monthNum, 0).toISOString().split("T")[0];
  return { startOfMonth, endOfMonth };
}

// Wypelnia selecty pojazdow, kierowcow i miesiecy w zakladce Wyniki.
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

    const vehicleOptions = (vehicles || [])
      .map((v) => `<option value="${v.id}">${escapeHtml(v.name.toUpperCase())} (${escapeHtml(v.plate)})</option>`)
      .join("");
    document.getElementById("wp-vehicle-select").innerHTML = vehicleOptions;
    document.getElementById("pp-vehicle-select").innerHTML = vehicleOptions;

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
      .select("net_amount, currency")
      .eq("vehicle_id", vehicleId)
      .eq("allocation_type", "vehicle")
      .gte("issue_date", startOfMonth)
      .lte("issue_date", endOfMonth);
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
      .select("invoice_number, net_amount, gross_amount, currency, paid")
      .eq("vehicle_id", vehicleId)
      .eq("allocation_type", "vehicle")
      .gte("issue_date", startOfMonth)
      .lte("issue_date", endOfMonth);
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
      .select("vehicle_id, net_amount, currency")
      .in("vehicle_id", vehicleIds)
      .eq("allocation_type", "vehicle")
      .gte("issue_date", startOfMonth)
      .lte("issue_date", endOfMonth);
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
// INICJALIZACJA
// =========================================================================
document.addEventListener("DOMContentLoaded", async () => {
  const { data } = await supabaseClient.auth.getSession();
  renderAuthState(data.session);
  if (data.session) {
    await fetchInvoices();
    await loadVehiclesAndDrivers();
  }
});
