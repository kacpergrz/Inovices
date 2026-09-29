true";
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
document.addEventListener("DOMContentLoaded", async () => {
  const { data } = await supabaseClient.auth.getSession();
  renderAuthState(data.session);
  if (data.session) {
    await fetchInvoices();
    await loadVehiclesAndDrivers();
  }
});
