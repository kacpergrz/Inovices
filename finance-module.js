import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const url = "https://ncjttizrnukovuotrowp.supabase.co";
const key = "sb_publishable_hlZffOls0AOUJzMZHyhtQg_s5PNjxuJ";
const sb = createClient(url, key);

const money = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(Number(n || 0));

function monthRange(month) {
  const [year, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = new Date(year, m, 0).toISOString().slice(0, 10);
  return { start, end };
}

async function getNbpRates() {
  const rates = { PLN: 1 };
  try {
    const response = await fetch("https://api.nbp.pl/api/exchangerates/tables/a/?format=json");
    const data = await response.json();
    (data[0]?.rates || []).forEach(rate => { rates[rate.code] = Number(rate.mid); });
  } catch (_) {
    rates.EUR = 4.3;
  }
  return rates;
}

async function render() {
  const host = document.getElementById("appContainer");
  if (!host || key.startsWith("WSTAW")) return;

  const month = new Date().toISOString().slice(0, 7);
  const { start, end } = monthRange(month);

  const rates = await getNbpRates();

  // Przychód liczony tak samo jak komenda "wynik" w bocie WhatsApp:
  // suma net_amount z invoices, przeliczona na PLN po kursie NBP.
  const [{ data: invoices }, { data: expenses }, { data: vehicles }] = await Promise.all([
    sb.from("invoices").select("net_amount,currency").gte("issue_date", start).lte("issue_date", end),
    sb.from("expenses").select("amount,category,vehicle_id").eq("expense_month", month),
    sb.from("vehicles").select("name,plate")
  ]);

  let income = 0;
  let usedForeign = false;
  (invoices || []).forEach(inv => {
    const net = Number(inv.net_amount || 0);
    const cur = (inv.currency || "PLN").toUpperCase();
    const rate = rates[cur] || 1;
    if (cur !== "PLN") usedForeign = true;
    income += net * rate;
  });

  const costs = (expenses || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const panel = document.createElement("section");
  panel.id = "financeModule";
  panel.innerHTML = `
    <hr>
    <h2>Panel finansowo-transportowy</h2>
    <p>Miesiąc: ${month}${usedForeign ? " (przeliczono waluty po kursie NBP)" : ""}</p>
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      <strong>Przychody: ${money(income)}</strong>
      <strong>Koszty: ${money(costs)}</strong>
      <strong>Wynik: ${money(income - costs)}</strong>
      <strong>Pojazdy: ${(vehicles || []).length}</strong>
    </div>
    <p class="muted" style="font-size:12px">Przychód liczony identycznie jak komenda "wynik" w bocie WhatsApp: suma net_amount z faktur (invoices) za dany miesiąc.</p>
  `;

  host.prepend(panel);
}

render();
