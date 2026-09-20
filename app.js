// =========================================================================
// KONFIGURACJA SUPABASE
// =========================================================================
// TODO: uzupelnic przed wdrozeniem
const SUPABASE_URL = "https://ncjttizrnukovuotrowp.supabase.co";
// TODO: uzupelnic przed wdrozeniem
const SUPABASE_ANON_KEY = "sb_publishable_wtxfaXXPywMenu46Ea5KHQ_n33G9u4w";

// Inicjalizacja klienta Supabase (biblioteka wgrana z CDN w index.html)
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TABLE_NAME = "invoices";

// Stan aplikacji
let allInvoices = [];
let currentEditInvoiceId = null;
let currentDueDateInvoiceId = null;
let pendingConfirmAction = null;

// =========================================================================
// ELEMENTY DOM
// =========================================================================
const globalStatusEl = document.getElementById("global-status");
const searchInputEl = document.getElementById("search-input");
const tbodyEl = document.getElementById("invoices-tbody");

const invoiceFormModal = document.getElementById("invoice-form-modal");
const invoiceForm = document.getElementById("invoice-form");
const invoiceFormTitle = document.getElementById("invoice-form-title");

const confirmModal = document.getElementById("confirm-modal");
const confirmModalText = document.getElementById("confirm-modal-text");

const dueDateModal = document.getElementById("due-date-modal");

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const loginErrorEl = document.getElementById("login-error");
const btnLogout = document.getElementById("btn-logout");

// =========================================================================
// AUTORYZACJA (Supabase Auth) - logowanie/wylogowanie, ochrona panelu Faktury
// =========================================================================

// Przelacza widok logowania / panelu Faktury w zaleznosci od stanu sesji.
function renderAuthState(session) {
  if (session) {
    loginView.classList.add("hidden");
    appView.classList.remove("hidden");
    btnLogout.classList.remove("hidden");
  } else {
    loginView.classList.remove("hidden");
    appView.classList.add("hidden");
    btnLogout.classList.add("hidden");
  }
}

// Logowanie e-mail + haslo. Konta tworzone recznie w Supabase Dashboard (panel nie ma rejestracji).
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
  } catch (err) {
    console.error(err);
    clearStatus();
    loginErrorEl.textContent = "Nieprawidłowy e-mail lub hasło.";
  }
});

// Wylogowanie z panelu.
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

// Reaguje na zmiany sesji (np. wygasniecie tokenu) w trakcie pracy z panelem.
supabaseClient.auth.onAuthStateChange((_event, session) => {
  renderAuthState(session);
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

function formatAmount(value, currency) {
  const num = Number(value);
  if (Number.isNaN(num)) return "-";
  return num.toFixed(2) + " " + (currency || "");
}

// =========================================================================
// WALIDACJA FORMULARZA
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

// Walidacja pol formularza "Dodaj/Edytuj fakture". Zwraca true jesli dane sa poprawne.
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
// FUNKCJE CRUD - SUPABASE
// =========================================================================

// Pobiera wszystkie faktury z bazy i renderuje tabele.
async function fetchInvoices() {
  showLoading("Wczytywanie faktur...");
  try {
    const { data, error } = await supabaseClient
      .from(TABLE_NAME)
      .select(
        "id, invoice_number, ksef_number, seller_name, seller_nip, issue_date, due_date, net_amount, gross_amount, currency, paid"
      )
      .order("issue_date", { ascending: false });

    if (error) throw error;

    allInvoices = data || [];
    renderTable(allInvoices);
    clearStatus();
  } catch (err) {
    console.error(err);
    showError("Nie udało się wczytać faktur — sprawdź połączenie.");
  }
}

// Wyszukiwanie faktur po sprzedawcy lub NIP (zapytanie ilike do Supabase).
async function searchInvoices(term) {
  if (!term) {
    await fetchInvoices();
    return;
  }
  showLoading("Wyszukiwanie...");
  try {
    const { data, error } = await supabaseClient
      .from(TABLE_NAME)
      .select(
        "id, invoice_number, ksef_number, seller_name, seller_nip, issue_date, due_date, net_amount, gross_amount, currency, paid"
      )
      .or(`seller_name.ilike.%${term}%,seller_nip.ilike.%${term}%`)
      .order("issue_date", { ascending: false });

    if (error) throw error;

    allInvoices = data || [];
    renderTable(allInvoices);
    clearStatus();
  } catch (err) {
    console.error(err);
    showError("Nie udało się wyszukać faktur — sprawdź połączenie.");
  }
}

// Dodaje nowa fakture do bazy (INSERT).
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

// Aktualizuje istniejaca fakture (UPDATE po id).
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

// Przelacza status platnosci faktury (oplacona <-> nieoplacona).
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

// Ustawia termin platnosci - albo przez liczbe dni od daty wystawienia, albo przez konkretna date.
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
// RENDEROWANIE TABELI
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
// OBSLUGA WYSZUKIWANIA
// =========================================================================
let searchDebounceTimer = null;
searchInputEl.addEventListener("input", (e) => {
  clearTimeout(searchDebounceTimer);
  const term = e.target.value.trim();
  searchDebounceTimer = setTimeout(() => {
    searchInvoices(term);
  }, 350);
});

// =========================================================================
// OBSLUGA MODALA DODAJ/EDYTUJ FAKTURE
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

// Podglad przeliczenia kwoty na PLN po srednim kursie NBP (informacyjny, nie zapisywany do bazy).
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
// AKCJE W WIERSZACH TABELI (delegacja zdarzen)
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

// =========================================================================
// INICJALIZACJA
// =========================================================================
document.addEventListener("DOMContentLoaded", async () => {
  const { data } = await supabaseClient.auth.getSession();
  renderAuthState(data.session);
  if (data.session) {
    await fetchInvoices();
  }
});
