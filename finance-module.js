import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
const url = "https://ncjttizrnukovuotrowp.supabase.co";
const key = "sb_publishable_hlZffOls0AOUJzMZHyhtQg_s5PNjxuJ";
const sb = createClient(url, key);

const money = n => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(Number(n || 0));

async function render() {
  const host = document.getElementById("appContainer");
  if (!host || key.startsWith("WSTAW")) return;

  const month = new Date().toISOString().slice(0, 7);

  const [{ data: expenses }, { data: revenues }, { data: vehicles }] = await Promise.all([
    sb.from("expenses").select("amount,category,vehicle_id").eq("expense_month", month),
    sb.from("revenues").select("amount").gte("revenue_date", month + "-01").lte("revenue_date", month + "-31"),
    sb.from("vehicles").select("name,plate")
  ]);

  const costs = (expenses || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const income = (revenues || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const panel = document.createElement("section");
  panel.id = "financeModule";
  panel.innerHTML = `
    <hr>
    <h2>Panel finansowo-transportowy</h2>
    <p>Miesiąc: ${month}</p>
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      <strong>Przychody: ${money(income)}</strong>
      <strong>Koszty: ${money(costs)}</strong>
      <strong>Wynik: ${money(income - costs)}</strong>
      <strong>Pojazdy: ${(vehicles || []).length}</strong>
    </div>
    <p>Pełne dane wymagają uruchomienia migracji SQL z tego pakietu.</p>
  `;

  host.prepend(panel);
}

render();
