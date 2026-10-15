import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const supabaseUrl =
  Deno.env.get("APP_SUPABASE_URL") ??
  Deno.env.get("SUPABASE_URL") ??
  "";

const supabaseServiceKey =
  Deno.env.get("APP_SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Brak SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

type RuleMap = Map<string, Map<string, any>>;

async function loadRules(): Promise<RuleMap> {
  const { data, error } = await supabase
    .from("rules")
    .select("category, key, value")
    .eq("active", true);

  // Nie importuj faktur ani E100, jeśli baza reguł nie odpowiada.
  // Inaczej można nieświadomie zapisać błędne terminy lub kwoty.
  if (error) throw new Error(`Nie udało się pobrać reguł: ${error.message}`);

  const rules: RuleMap = new Map();

  for (const row of data ?? []) {
    if (!rules.has(row.category)) rules.set(row.category, new Map());
    rules.get(row.category)!.set(row.key, row.value);
  }

  return rules;
}

function normalizeNip(value: unknown): string {
  return String(value ?? "").replace(/D/g, "");
}

function rulePaymentDays(inv: any, rules: RuleMap): number | null {
  const paymentRules = rules.get("payment_terms_default");

  // Faktury pobierane od sprzedawców: używamy seller_nip.
  const nip = normalizeNip(inv?.seller_nip);
  const value = (nip && paymentRules?.get(nip)) || paymentRules?.get("default");
  const days = Number(value?.days);

  return Number.isInteger(days) && days >= 0 ? days : null;
}

function ruleVatDivisor(
  rules: RuleMap,
  country: string,
  kind: "paliwo" | "myto"
): number | null {
  const vatRules = rules.get("vat_rate");
  const countryRule = vatRules?.get(String(country ?? "").trim().toUpperCase());
  const defaultRule = vatRules?.get("_default");
  const field = kind === "paliwo" ? "paliwo_vat" : "myto_vat";

  const divisor = Number(countryRule?.[field] ?? defaultRule?.[field]);
  return Number.isFinite(divisor) && divisor >= 1 && divisor <= 2
    ? divisor
    : null;
}
const ratesCache = new Map<string, Record<string, number>>();

async function getRatesForDate(dateStr?: string | null): Promise<Record<string, number>> {
  const targetDate = dateStr && isIsoDate(dateStr) ? dateStr : new Date().toISOString().slice(0, 10);

  if (ratesCache.has(targetDate)) {
    return ratesCache.get(targetDate)!;
  }

  const rates: Record<string, number> = { PLN: 1 };
  const cursor = new Date(targetDate);

  // NBP nie publikuje kursow w weekendy/swieta - sprawdzamy do 10 dni wstecz
  for (let i = 0; i < 10; i++) {
    const iso = cursor.toISOString().slice(0, 10);
    try {
      const res = await fetch(`https://api.nbp.pl/api/exchangerates/tables/a/${iso}/?format=json`);
      if (res.ok) {
        const data = await res.json();
        data[0]?.rates?.forEach((r: any) => {
          rates[r.code] = Number(r.mid);
        });
        ratesCache.set(targetDate, rates);
        return rates;
      }
    } catch (_) {
      // ignorujemy i probujemy dzien wczesniej
    }
    cursor.setDate(cursor.getDate() - 1);
  }

  rates.EUR = 4.3; // kurs zapasowy, gdy NBP nie odpowiada
  ratesCache.set(targetDate, rates);
  return rates;
}

async function buildRatesMapForDates(dates: (string | null | undefined)[]) {
  const uniqueDates = Array.from(new Set(dates.filter((d): d is string => Boolean(d))));
  const map = new Map<string, Record<string, number>>();
  await Promise.all(uniqueDates.map(async (d) => {
    map.set(d, await getRatesForDate(d));
  }));
  return map;
}

function rateFor(map: Map<string, Record<string, number>>, dateStr: string | null | undefined, currency: string) {
  const cur = String(currency || "PLN").toUpperCase();
  if (cur === "PLN") return 1;
  const rates = (dateStr && map.get(dateStr)) || {};
  return Number(rates[cur] || 1);
}

type ParsedCommand =
  | { type: "dodaj"; num: string; issue_date: string; payment_days: number; due_date: string }
  | { type: "status"; num: string; paid: boolean }
  | { type: "termin"; num: string; due_date?: string; days?: number }
  | { type: "lista"; from?: string; to?: string; month?: string }
  | { type: "nieoplacone" }
  | { type: "szukaj"; query: string } // <-- NOWE
  | { type: "pilne" } // <-- NOWE
  | { type: "podsumowanie"; month: string } // <-- NOWE
  | { type: "koszty_lista"; month: string }
  | { type: "usun_koszt"; id: number }

  | { type: "ostatnia" }
  | { type: "koszt"; category: string; amount: number; month: string }
  | { type: "wynik"; month: string }
  | { type: "pokaz"; num: string }
  | { type: "usun"; num: string }
  | { type: "pobierz"; mode: "today" }
  | { type: "pobierz"; mode: "daysBack"; daysBack: number }
  | { type: "pobierz"; mode: "range"; from: string; to: string }
  | { type: "kierowca_ustaw"; name: string; baseSalary: number; dailyRate: number }
  | { type: "wyjazd"; name: string; date: string; description?: string }
  | { type: "zjazd"; name: string; date: string }
  | { type: "usun_wyjazd"; id: number }
  | { type: "trasa_reczna"; name: string; startDate: string; endDate: string; description?: string }
  | { type: "wyplata"; name: string; month: string }
  | { type: "cofnij_e100"; month: string }
  | { type: "e100_lista"; month: string; vehicle?: string }
  | { type: "pojazdy" }
  | { type: "pojazd_dodaj"; name: string; plate: string }
  | { type: "przypisz_fakture"; num: string; vehicle: string }
  | { type: "przypisz_koszt"; id: number; vehicle: string }
  | { type: "wynik_pojazdu"; vehicle: string; month: string }
  | { type: "podsumowanie_pojazdu"; vehicle: string; month: string }
  | { type: "nieprzypisane" }
  | { type: "wyjazdy"; name: string }
  | { type: "porownanie"; month: string }
  | { type: "przypisz_miesiac"; num: string; month: string }
  | { type: "error"; message: string };

function normalizeText(text: string) {
  return String(text ?? "").trim();
}
function normalizePolishWord(text: string): string {
  return String(text ?? "")
    .replace(/ą/g, "a").replace(/Ą/g, "A")
    .replace(/ć/g, "c").replace(/Ć/g, "C")
    .replace(/ę/g, "e").replace(/Ę/g, "E")
    .replace(/ł/g, "l").replace(/Ł/g, "L")
    .replace(/ń/g, "n").replace(/Ń/g, "N")
    .replace(/ó/g, "o").replace(/Ó/g, "O")
    .replace(/ś/g, "s").replace(/Ś/g, "S")
    .replace(/ź/g, "z").replace(/Ź/g, "Z")
    .replace(/ż/g, "z").replace(/Ż/g, "Z");
}


function getIncomingCommand(msg: any): string | null {
  if (!msg) return null;
  if (msg.type === "text") return msg.text?.body ?? null;

  if (msg.type === "interactive") {
    if (msg.interactive?.type === "button_reply") {
      return msg.interactive?.button_reply?.id ?? msg.interactive?.button_reply?.title ?? null;
    }
    if (msg.interactive?.type === "list_reply") {
      return msg.interactive?.list_reply?.id ?? msg.interactive?.list_reply?.title ?? null;
    }
  }

  if (typeof msg.body === "string") return msg.body;
  return null;
}

function isIsoDate(value: string) {
  const val = String(value || "").trim();
  
  // Sprawdza czy data ma dokładnie 10 znaków (np. 2026-07-01)
  if (val.length !== 10) return false;
  
  // Sprawdza czy na 5 i 8 pozycji jest myślnik
  if (val[4] !== "-" || val[7] !== "-") return false;
  
  // Sprawdza czy to jest prawdziwa data
  const d = new Date(val);
  return !Number.isNaN(d.getTime());
}

function getTodayIsoInPoland(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

function escapePostgrestValue(value: string) {
  return String(value ?? "").replaceAll(",", "\\,");
}
// Przeliczanie kwot brutto z raportu E100 na kwoty netto
function calculateNetto(service: string, country: string, grossAmount: number): number {
  const s = String(service || "").toLowerCase();
  const c = String(country || "").toUpperCase();

  // 1. Paliwo (ON)
  if (s.includes("on") || s.includes("paliwo") || s.includes("diesel")) {
    if (c === "PL") return grossAmount / 1.23; // Polska 23%
    if (c === "AT") return grossAmount / 1.20; // Austria 20%
    if (c === "DE") return grossAmount / 1.19; // Niemcy 19%
    if (c === "CZ") return grossAmount / 1.21; // Czechy 21%
    if (c === "IT") return grossAmount / 1.22; // Włochy 22%
    return grossAmount / 1.20;                 // Domyślny VAT UE na paliwo
  }

  // 2. Myto i autostrady
  if (s.includes("drogi") || s.includes("toll") || s.includes("e-box") || s.includes("t4e")) {
    if (c === "AT") return grossAmount / 1.20; // ASFiNAG Austria: 20%
    if (c === "IT") return grossAmount / 1.22; // Włochy autostrady: 22%
    if (c === "FR") return grossAmount / 1.20; // Francja: 20%
    if (c === "PL") return grossAmount;        // e-TOLL Polska: brak VAT
    if (c === "CZ") return grossAmount;        // Czechy myto: brak VAT
    return grossAmount;
  }

  return grossAmount;
}
function parseMonthParam(value: string): string | null {
  const param = String(value ?? "").trim().toLowerCase();

  if (/^\d{4}-\d{2}$/.test(param)) {
    return param;
  }

  const polishMonths: Record<string, string> = {
    styczen: "01",
    styczeń: "01",
    luty: "02",
    marzec: "03",
    kwiecien: "04",
    kwiecień: "04",
    maj: "05",
    czerwiec: "06",
    lipiec: "07",
    sierpien: "08",
    sierpień: "08",
    wrzesien: "09",
    wrzesień: "09",
    padziernik: "10",
    pazdziernik: "10",
    październik: "10",
    listopad: "11",
    grudzien: "12",
    grudzień: "12",
  };

  return polishMonths[param]
    ? `${new Date().getFullYear()}-${polishMonths[param]}`
    : null;
}

function parseE100DateToSortKey(dateStr: string): string {
  const s = String(dateStr || "").trim();
  if (!s) return "";

  if (s.includes(".")) {
    const parts = s.split(".");
    if (parts.length >= 3) {
      const [d, m, y] = parts;
      const fullY = y.length === 2 ? `20${y}` : (y.length === 4 ? y : y.padStart(4, "20"));
      return `${fullY}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    if (parts.length === 2) {
      const [d, m] = parts;
      return `9999-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }

  if (s.includes("-")) {
    const parts = s.split("-");
    if (parts.length === 3 && parts[0].length === 4) {
      return s.slice(0, 10);
    }
    if (parts.length === 3 && parts[2].length === 4) {
      const [d, m, y] = parts;
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }

  return s;
}

function getE100DateRange(transactions: { date: string }[]): { minDate: string; maxDate: string } | null {
  const items = transactions
    .map((t) => ({ raw: String(t.date || "").trim(), key: parseE100DateToSortKey(t.date) }))
    .filter((item) => Boolean(item.raw && item.key));

  if (items.length === 0) return null;

  items.sort((a, b) => a.key.localeCompare(b.key));
  return {
    minDate: items[0].raw,
    maxDate: items[items.length - 1].raw,
  };
}

function normalizeVehicleKey(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]/g, "");
}

async function findVehicle(value: string) {
  const key = normalizeVehicleKey(value);

  if (
    !key ||
    key === "firma" ||
    key === "wspolne" ||
    key === "wspólne"
  ) {
    return null;
  }

  const { data, error } = await supabase
    .from("vehicles")
    .select("id, name, plate, active")
    .eq("active", true);

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).find((vehicle: any) => {
    return (
      normalizeVehicleKey(vehicle.name) === key ||
      normalizeVehicleKey(vehicle.plate) === key
    );
  }) || null;
}

function vehicleLabel(vehicle: any, allocationType = "unassigned") {
  if (vehicle) {
    return `${String(vehicle.name).toUpperCase()} (${vehicle.plate})`;
  }

  if (allocationType === "shared") {
    return "WSPÓLNE DLA FIRMY";
  }

  return "NIEPRZYPISANE";
}

async function getRates() {
  const rates: Record<string, number> = { PLN: 1 };

  try {
    const response = await fetch(
      "https://api.nbp.pl/api/exchangerates/tables/a/?format=json"
    );

    const data = await response.json();

    data[0]?.rates?.forEach((rate: any) => {
      rates[rate.code] = Number(rate.mid);
    });
  } catch (_) {
    rates.EUR = 4.3;
  }

  return rates;
}


function parseCommand(input: string): ParsedCommand {
  const text = String(input ?? "").trim();
  const parts = text.split(/\s+/).filter(Boolean);
  const action = normalizePolishWord(String(parts[0] ?? "").trim().toLowerCase());
    if (action === "pojazdy") {
    return { type: "pojazdy" };
  }

  if (
    action === "pojazd" &&
    String(parts[1] ?? "").toLowerCase() === "dodaj"
  ) {
    if (parts.length < 4) {
      return {
        type: "error",
        message: "Format: pojazd dodaj [NAZWA] [REJESTRACJA]",
      };
    }

    return {
      type: "pojazd_dodaj",
      name: String(parts[2]).toLowerCase(),
      plate: String(parts[3]).toUpperCase(),
    };
  }

  if (action === "przypisz") {
    const vehicle = String(parts[parts.length - 1] ?? "");
    const num = parts.slice(1, -1).join(" ");

    if (!num || !vehicle) {
      return {
        type: "error",
        message: "Format: przypisz [NUMER_FV] [POJAZD|firma]",
      };
    }

    return {
      type: "przypisz_fakture",
      num,
      vehicle,
    };
  }

  if (action === "przypisz_koszt") {
    const id = Number(parts[1]);
    const vehicle = String(parts[2] ?? "");

    if (!id || !vehicle) {
      return {
        type: "error",
        message: "Format: przypisz_koszt [ID] [POJAZD|firma]",
      };
    }

    return {
      type: "przypisz_koszt",
      id,
      vehicle,
    };
  }

  if (action === "porownanie") {
    const month = parseMonthParam(String(parts[1] ?? ""));

    if (!month) {
      return {
        type: "error",
        message: "Format: porownanie [miesiąc], np. porownanie wrzesien",
      };
    }

    return {
      type: "porownanie",
      month,
    };
  }

  if (
    (action === "wynik" || action === "podsumowanie") &&
    parts.length >= 3
  ) {
    const month = parseMonthParam(String(parts[2] ?? ""));

    if (!month) {
      return {
        type: "error",
        message: `Format: ${action} [pojazd] [miesiąc]`,
      };
    }

    if (action === "wynik") {
      return {
        type: "wynik_pojazdu",
        vehicle: String(parts[1]),
        month,
      };
    }

    return {
      type: "podsumowanie_pojazdu",
      vehicle: String(parts[1]),
      month,
    };
  }

    if (action === "lista") {
    // 1. Format: lista YYYY-MM-DD YYYY-MM-DD
    if (parts.length === 3) {
      const from = String(parts[1] ?? "").trim();
      const to = String(parts[2] ?? "").trim();

      if (!isIsoDate(from) || !isIsoDate(to)) {
        return { type: "error", message: "Format: lista YYYY-MM-DD YYYY-MM-DD" };
      }

      return { type: "lista", from, to };
    }

    // 2. Format: lista YYYY-MM lub lista MIESIĄC (np. lista lipiec)
    if (parts.length === 2) {
      const param = String(parts[1] ?? "").trim().toLowerCase();
      
      // Sprawdzamy czy to format YYYY-MM
      if (/^\d{4}-\d{2}$/.test(param)) {
        return { type: "lista", month: param };
      }

      // Słowniczek polskich miesięcy
      const polishMonths: Record<string, string> = {
        styczen: "01", styczeń: "01", luty: "02", marzec: "03",
        kwiecien: "04", kwiecień: "04", maj: "05", czerwiec: "06",
        lipiec: "07", sierpien: "08", sierpień: "08", wrzesien: "09",
        wrzesień: "09", pazdziernik: "10", październik: "10", listopad: "11",
        grudzien: "12", grudzień: "12"
      };

      if (polishMonths[param]) {
        const year = new Date().getFullYear(); // Bierze obecny rok
        const monthNum = polishMonths[param];
        return { type: "lista", month: `${year}-${monthNum}` };
      }

      return { type: "error", message: "Format: lista, lista lipiec, lista YYYY-MM, albo lista YYYY-MM-DD YYYY-MM-DD" };
    }
    
    // 3. Domyślne zachowanie: po prostu "lista"
    return { type: "lista" };
  }
    // ==========================================
  // KOMENDA: KOSZT [kategoria] [kwota] [miesiąc]
  // ==========================================
  if (action === "koszt") {
    if (parts.length < 4) {
      return { type: "error", message: "Format: koszt [kategoria] [kwota] [miesiąc]\nNp. koszt paliwo 8500 lipiec" };
    }
    const category = parts[1].toLowerCase();
    const amountStr = parts[2].replace(",", "."); // Zabezpieczenie przed przecinkami
    const amount = Number(amountStr);
    const param = String(parts[3]).trim().toLowerCase();

    if (Number.isNaN(amount) || amount <= 0) {
      return { type: "error", message: "Podaj prawidłową kwotę, np. 8500 lub 150.50" };
    }

    let month = param;
    if (!/^\d{4}-\d{2}$/.test(param)) {
      const polishMonths: Record<string, string> = {
        styczen: "01", styczeń: "01", luty: "02", marzec: "03",
        kwiecien: "04", kwiecień: "04", maj: "05", czerwiec: "06",
        lipiec: "07", sierpien: "08", sierpień: "08", wrzesien: "09",
        wrzesień: "09", pazdziernik: "10", październik: "10", listopad: "11",
        grudzien: "12", grudzień: "12"
      };
      if (polishMonths[param]) {
        month = `${new Date().getFullYear()}-${polishMonths[param]}`;
      } else {
         return { type: "error", message: "Nieznany miesiąc. Użyj formatu YYYY-MM lub nazwy (np. lipiec)." };
      }
    }
    return { type: "koszt", category, amount, month };
  }
    // ==========================================
  // KOMENDA: KOSZTY [miesiąc] (lista wprowadzonych wydatków)
  // ==========================================
  if (action === "koszty") {
    const param = String(parts[1] ?? "").trim().toLowerCase();
    if (!param) return { type: "error", message: "Podaj miesiąc! Np. koszty lipiec" };

    let month = param;
    if (!/^\d{4}-\d{2}$/.test(param)) {
      const polishMonths: Record<string, string> = {
        styczen: "01", styczeń: "01", luty: "02", marzec: "03", kwiecien: "04", kwiecień: "04", maj: "05", czerwiec: "06", lipiec: "07", sierpien: "08", sierpień: "08", wrzesien: "09", wrzesień: "09", pazdziernik: "10", październik: "10", listopad: "11", grudzien: "12", grudzień: "12"
      };
      if (polishMonths[param]) month = `${new Date().getFullYear()}-${polishMonths[param]}`;
      else return { type: "error", message: "Format: koszty lipiec lub koszty 2026-07" };
    }
    return { type: "koszty_lista", month };
  }

  // ==========================================
  // KOMENDA: USUN KOSZT [ID]
  // ==========================================
  if (action === "usun_koszt" || action === "usunkoszt") {
    const id = Number(parts[1]);
    if (Number.isNaN(id) || !id) {
       return { type: "error", message: "Podaj prawidłowy numer ID wydatku, np. usun_koszt 5" };
    }
    return { type: "usun_koszt", id };
  }
    if (action === "cofnij_e100" || action === "usun_e100") {
    if (parts.length < 2) {
      return { type: "error", message: "Użycie: cofnij_e100 [miesiąc]\nNp.: cofnij_e100 lipiec" };
    }
    const param = String(parts[1]).trim().toLowerCase();
    let month = param;
    const polishMonths: Record<string, string> = {
      styczen: "01", styczeń: "01", luty: "02", marzec: "03", kwiecien: "04", kwiecień: "04",
      maj: "05", czerwiec: "06", lipiec: "07", sierpien: "08", sierpień: "08",
      wrzesien: "09", wrzesień: "09", pazdziernik: "10", październik: "10",
      listopad: "11", grudzien: "12", grudzień: "12"
    };
    if (!/^\d{4}-\d{2}$/.test(param)) {
      if (polishMonths[param]) month = `${new Date().getFullYear()}-${polishMonths[param]}`;
      else return { type: "error", message: "Nieznany miesiąc. Podaj np. lipiec lub 2026-07." };
    }
    return { type: "cofnij_e100", month };
  }

  if (action === "e100" || action === "transakcje_e100" || action === "e100_transakcje") {
    if (parts.length < 2) {
      return {
        type: "error",
        message: "Użycie: e100 [miesiąc] lub e100 [miesiąc] [pojazd]\nNp.: *e100 lipiec* lub *e100 lipiec DW12345*",
      };
    }

    // Szukamy miesiąca w dowolnym argumencie
    let foundMonth: string | null = null;
    let monthIdx = -1;
    for (let i = 1; i < parts.length; i++) {
      const m = parseMonthParam(parts[i]);
      if (m) {
        foundMonth = m;
        monthIdx = i;
        break;
      }
    }

    if (foundMonth && monthIdx !== -1) {
      const remaining = parts.filter((_, idx) => idx !== 0 && idx !== monthIdx).join(" ").trim();
      return {
        type: "e100_lista",
        month: foundMonth,
        vehicle: remaining || undefined,
      };
    }

    return {
      type: "error",
      message: "Podaj prawidłowy miesiąc! Np. *e100 lipiec* lub *e100 2026-07*",
    };
  }
  if (action === "przypisz_miesiac") {
  const num = parts.slice(1, -1).join(" ");
  const month = parts[parts.length - 1];
  if (!num || !/^\d{4}-\d{2}$/.test(month)) { 
    return { type: "error", message: "Format: przypisz_miesiac [NUMER_FV] RRRR-MM" };
  }
  return { type: "przypisz_miesiac", num, month };
}


    if (action === "usun_wyjazd" || action === "cofnij_wyjazd" || action === "anuluj_wyjazd") {
      const id = parseInt(parts[1], 10);
      
      if (!id || isNaN(id) || id <= 0) {
        return { 
          type: "error", 
          message: "⚠️ Podaj poprawny numer ID wyjazdu.\n\n*Przykład:* `usun_wyjazd 14`" 
        };
      }
      
      return { type: "usun_wyjazd", id };
    }

  // ==========================================
  // KOMENDA: WYNIK [miesiąc]
  // ==========================================
  if (action === "wynik") {
    const param = String(parts[1] ?? "").trim().toLowerCase();
    if (!param) return { type: "error", message: "Podaj miesiąc! Np. wynik lipiec" };

    let month = param;
    if (!/^\d{4}-\d{2}$/.test(param)) {
      const polishMonths: Record<string, string> = {
        styczen: "01", styczeń: "01", luty: "02", marzec: "03", kwiecien: "04", kwiecień: "04", maj: "05", czerwiec: "06", lipiec: "07", sierpien: "08", sierpień: "08", wrzesien: "09", wrzesień: "09", pazdziernik: "10", październik: "10", listopad: "11", grudzien: "12", grudzień: "12"
      };
      if (polishMonths[param]) {
         month = `${new Date().getFullYear()}-${polishMonths[param]}`;
      } else {
         return { type: "error", message: "Format: wynik lipiec lub wynik 2026-07" };
      }
    }
    return { type: "wynik", month };
  }


  if (action === "ostatnia") return { type: "ostatnia" };
  if (action === "nieoplacone") return { type: "nieoplacone" };
    
      if (action === "pilne") return { type: "pilne" };

        if (action === "szukaj") {
            const query = parts.slice(1).join(" ");
                if (!query) return { type: "error", message: "Format: szukaj NIP_LUB_NAZWA" };
                    return { type: "szukaj", query };
                      }
                        if (action === "podsumowanie") {
    const param = String(parts[1] ?? "").trim().toLowerCase();

    if (!param) {
      return { type: "error", message: "Podaj miesiąc! Format: podsumowanie YYYY-MM lub podsumowanie lipiec" };
    }

    // 1. Sprawdzamy czy to twardy format YYYY-MM (np. 2026-07)
    if (/^\d{4}-\d{2}$/.test(param)) {
      return { type: "podsumowanie", month: param };
    }

    // 2. Jeśli to słowo, używamy naszego słowniczka polskich miesięcy
    const polishMonths: Record<string, string> = {
      styczen: "01", styczeń: "01", luty: "02", marzec: "03",
      kwiecien: "04", kwiecień: "04", maj: "05", czerwiec: "06",
      lipiec: "07", sierpien: "08", sierpień: "08", wrzesien: "09",
      wrzesień: "09", pazdziernik: "10", październik: "10", listopad: "11",
      grudzien: "12", grudzień: "12"
    };

    if (polishMonths[param]) {
      const year = new Date().getFullYear(); // Automatycznie bierze obecny rok
      const monthNum = polishMonths[param];
      return { type: "podsumowanie", month: `${year}-${monthNum}` };
    }

    return { type: "error", message: "Format: podsumowanie YYYY-MM (np. podsumowanie 2026-07) lub podsumowanie lipiec" };
  }

  if (action === "pobierz") {
    if (parts.length === 1) {
      return { type: "pobierz", mode: "today" };
    }

    if (parts.length === 2 && /^\d+$/.test(parts[1])) {
      return { type: "pobierz", mode: "daysBack", daysBack: Number(parts[1]) };
    }

    if (parts.length === 3) {
      const from = String(parts[1] ?? "").trim();
      const to = String(parts[2] ?? "").trim();

      if (!isIsoDate(from) || !isIsoDate(to)) {
        return { type: "error", message: "Format: pobierz YYYY-MM-DD YYYY-MM-DD lub pobierz [dni]" };
      }

      return { type: "pobierz", mode: "range", from, to };
    }

    return {
      type: "error",
      message: "Użyj: *pobierz* (z dzisiaj), *pobierz 30* (z 30 dni) albo *pobierz YYYY-MM-DD YYYY-MM-DD*",
    };
  }

  if (action === "pokaz") {
    const num = parts.slice(1).join(" ");
    if (!num) return { type: "error", message: "Format: pokaz NUM" };
    return { type: "pokaz", num };
  }

  if (action === "usun") {
    const num = parts.slice(1).join(" ");
    if (!num) return { type: "error", message: "Format: usun NUM" };
    return { type: "usun", num };
  }

  if (action === "status") {
    const statusRaw = String(parts[parts.length - 1] ?? "").toLowerCase().replaceAll("ł", "l");
    const num = parts.slice(1, -1).join(" ");

    if (!num || !statusRaw) {
      return { type: "error", message: "Format: status NUM oplacona|nieoplacona" };
    }

    if (statusRaw !== "oplacona" && statusRaw !== "nieoplacona") {
      return { type: "error", message: "Status musi być: oplacona albo nieoplacona" };
    }

    return { type: "status", num, paid: statusRaw === "oplacona" };
  }
    if (action === "termin") {
    // Sprawdzamy, czy użytkownik wpisał na końcu słowo "dni" (np. termin FV 30 dni)
    const lastPart = String(parts[parts.length - 1] ?? "").trim().toLowerCase();
    const isDaysText = lastPart === "dni";
    
    const val = isDaysText ? String(parts[parts.length - 2] ?? "").trim() : lastPart;
    const num = isDaysText ? parts.slice(1, -2).join(" ") : parts.slice(1, -1).join(" ");

    if (!num || !val) {
      return { type: "error", message: "Format: termin NUM YYYY-MM-DD albo termin NUM 30 dni" };
    }

    // Jeśli podał datę w formacie YYYY-MM-DD
    if (isIsoDate(val)) {
      return { type: "termin", num, due_date: val };
    }

    // Jeśli podał same dni
    const days = Number(val);
    if (!Number.isNaN(days) && days >= 0) {
      return { type: "termin", num, days };
    }

    return { type: "error", message: "Format: termin NUM YYYY-MM-DD albo termin NUM 30 dni" };
  }
  if (action === "kierowca") {
    if (parts.length < 4) {
      return { type: "error", message: "Użycie: kierowca [imię] [podstawa] [dniówka]\nNp.: kierowca Janek 4000 450" };
    }
    const name = parts[1];
    const baseSalary = Number(parts[2].replace(",", "."));
    const dailyRate = Number(parts[3].replace(",", "."));
    if (isNaN(baseSalary) || isNaN(dailyRate)) {
      return { type: "error", message: "Podstawa i dniówka muszą być liczbami." };
    }
    return { type: "kierowca_ustaw", name, baseSalary, dailyRate };
  }

  // ==========================================
  // KOMENDA: WYJAZD [imię] [opcjonalnie data YYYY-MM-DD] [opis]
  // np. wyjazd Janek Niemcy  LUB  wyjazd Janek 2026-07-01 Trasa EU
  // ==========================================
    // ==========================================
  // KOMENDA: WYJAZD [imię] [opcjonalnie data YYYY-MM-DD] [opis]
  // ==========================================
  if (action === "wyjazd") {
    if (parts.length < 2) {
      return { type: "error", message: "Użycie: wyjazd [imię] [data opcjonalnie] [opis]\nNp.: wyjazd Janek Hiszpania" };
    }
    const name = parts[1];
    let tripDate = new Date().toISOString().split("T")[0];
    let descIndex = 2;

    if (parts[2] && /^\d{4}-\d{2}-\d{2}$/.test(parts[2])) {
      tripDate = parts[2];
      descIndex = 3;
    }
    const description = parts.slice(descIndex).join(" ").trim();
    return { type: "wyjazd", name, date: tripDate, description };
  }

  // ==========================================
  // KOMENDA: ZJAZD [imię] [opcjonalnie data YYYY-MM-DD]
  // ==========================================
  if (action === "zjazd") {
    if (parts.length < 2) {
      return { type: "error", message: "Użycie: zjazd [imię] [data opcjonalnie]\nNp.: zjazd Janek" };
    }
    const name = parts[1];
    const today = new Date().toISOString().split("T")[0];
    const tripDate = (parts[2] && /^\d{4}-\d{2}-\d{2}$/.test(parts[2])) ? parts[2] : today;
    return { type: "zjazd", name, date: tripDate };
  }
   if (action === "nieprzypisane") return { type: "nieprzypisane" };

  if (action === "wyjazdy" || action === "trasy") {
   const name = parts[1];
   if (!name) {
     return { type: "error", message: "Użycie: wyjazdy [imię]\nNp.: wyjazdy Kamil" };
   }
   return { type: "wyjazdy", name };
 }

  // ==========================================
  // KOMENDA: TRASA [imię] [start YYYY-MM-DD] [koniec YYYY-MM-DD] [opis]
  // np. trasa Janek 2026-07-01 2026-07-21 Kółko zachód
  // ==========================================
  if (action === "trasa") {
    if (parts.length < 4 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[2]) || !/^\d{4}-\d{2}-\d{2}$/.test(parts[3])) {
      return { type: "error", message: "Użycie: trasa [imię] [YYYY-MM-DD] [YYYY-MM-DD] [opis]\nNp.: trasa Janek 2026-07-01 2026-07-21 Francja" };
    }
    const name = parts[1];
    const startDate = parts[2];
    const endDate = parts[3];
    const description = parts.slice(4).join(" ").trim();
    return { type: "trasa_reczna", name, startDate, endDate, description };
  }

  // ==========================================
  // KOMENDA: WYPLATA [imię] [miesiąc]
  // np. wyplata Janek lipiec
  // ==========================================
  if (action === "wyplata") {
    if (parts.length < 3) {
      return { type: "error", message: "Użycie: wyplata [imię] [miesiąc]\nNp.: wyplata Janek lipiec" };
    }
    const name = parts[1];
    const param = String(parts[2]).trim().toLowerCase();
    let month = param;

    if (!/^\d{4}-\d{2}$/.test(param)) {
      const polishMonths: Record<string, string> = {
        styczen: "01", styczeń: "01", luty: "02", marzec: "03", kwiecien: "04", kwiecień: "04",
        maj: "05", czerwiec: "06", lipiec: "07", sierpien: "08", sierpień: "08",
        wrzesien: "09", wrzesień: "09", pazdziernik: "10", październik: "10",
        listopad: "11", grudzien: "12", grudzień: "12"
      };
      if (polishMonths[param]) {
        month = `${new Date().getFullYear()}-${polishMonths[param]}`;
      } else {
        return { type: "error", message: "Nieznany miesiąc. Podaj np. lipiec lub 2026-07." };
      }
    }
    return { type: "wyplata", name, month };
  }

  if (action === "dodaj") {
    if (parts.length < 5) {
      return { type: "error", message: "Format: dodaj NUM ISSUE_DATE PAYMENT_DAYS DUE_DATE" };
    }

    const due_date = String(parts[parts.length - 1] ?? "").trim();
    const payment_days_raw = String(parts[parts.length - 2] ?? "").trim();
    const issue_date = String(parts[parts.length - 3] ?? "").trim();
    const num = parts.slice(1, -3).join(" ");
    const payment_days = Number(payment_days_raw);

    if (!num || !issue_date || !due_date || Number.isNaN(payment_days)) {
      return { type: "error", message: "Format: dodaj NUM ISSUE_DATE PAYMENT_DAYS DUE_DATE" };
    }

    return { type: "dodaj", num, issue_date, payment_days, due_date };
  }
    return {
    type: "error",
    message: `❌ Nieznana komenda. Oto co potrafię:

*POBIERANIE I PRZEGLĄDANIE FAKTUR:*
• *pobierz* — pobiera faktury z dzisiejszego dnia
• *pobierz 30* — pobiera faktury z ostatnich 30 dni (lub innej liczby dni)
• *pobierz 2026-07-01 2026-07-31* — pobiera faktury z wybranego zakresu
• *lista* — pokazuje ostatnie faktury
• *lista lipiec* lub *lista 2026-07* — faktury z wybranego miesiąca
• *lista 2026-07-01 2026-07-31* — faktury z wybranego zakresu
• *szukaj [nazwa lub NIP]* — wyszukuje faktury
• *pokaz [NUMER_FV]* — pokazuje szczegóły faktury
• *ostatnia* — pokazuje ostatnią fakturę z KSeF

*FINANSE I KOSZTY:*
• *koszt [kategoria] [kwota] [miesiąc]*
  np. *koszt paliwo 8500 lipiec*
• *koszty lipiec* — pokazuje koszty wraz z ich ID
• *usun_koszt [ID]* — usuwa koszt
  np. *usun_koszt 5*
• *wynik lipiec* — oblicza przychód, koszty i czysty dochód netto
• *podsumowanie lipiec* — podsumowuje przychody z faktur

*PŁATNOŚCI:*
• *nieoplacone* — pokazuje nieopłacone faktury
• *pilne* — pokazuje faktury przeterminowane lub z terminem do 3 dni
• *status [NUMER_FV] oplacona*
• *status [NUMER_FV] nieoplacona*
• *termin [NUMER_FV] 14 dni*
• *termin [NUMER_FV] 2026-08-30*
• *nieprzypisane* — pokazuje faktury (i koszty) bez przypisania do pojazdu

*KIEROWCY I TRASY:*
• *kierowca [imię] [podstawa] [dniówka]*
  np. *kierowca Janek 4000 450*
• *wyjazd [imię] [data opcjonalnie] [opis]*
  np. *wyjazd Janek 2026-09-15 Włochy*
• *zjazd [imię] [data opcjonalnie]*
  np. *zjazd Janek 2026-09-20*
• *trasa [imię] [data_od] [data_do] [opis]*
  np. *trasa Janek 2026-08-03 2026-08-28 Włochy*
• *usun_wyjazd [ID]* — usuwa zapisaną trasę
• *wyplata [imię] [miesiąc]*
  np. *wyplata Janek sierpien*
• *wyjazdy [imię]* — lista wyjazdów kierowcy z ich ID (do usun_wyjazd)
np. *wyjazdy Kamil*
*RAPORTY E100:*
• Wyślij raport E100 w pliku *.xlsx*
• Po otrzymaniu pliku odpisz miesiącem, np. *wrzesien* lub *2026-09*
• Możesz dodać datę początkową, np. *wrzesien od 15.09*
• *podglad* — podgląd transakcji z wgranego raportu z datami
• *e100 [miesiąc]* — lista zaimportowanych transakcji z datami
  np. *e100 wrzesien* lub *e100 wrzesien DW12345*
• *anuluj* — przerywa import raportu przed zapisaniem kosztów
• *cofnij_e100 [miesiąc]* — usuwa koszty dodane z importu E100
  np. *cofnij_e100 sierpien*

*ZARZĄDZANIE FAKTURAMI:*
• *usun [NUMER_FV]* — usuwa fakturę
• *dodaj [NUMER] [DATA_WYST] [DNI_PLAT] [TERMIN]*
  np. *dodaj FV/12/2026 2026-09-01 14 2026-09-15*
  *PRZYPISANIE MIESIĄCA ROZLICZENIA:*
  • *przypisz_miesiac [NUMER_FV] RRRR-MM*
    np. *przypisz_miesiac FV/123/2026 2026-09*`,
  };

}

function buildInvoiceOrFilter(num: string) {
  const safe = escapePostgrestValue(num);
  return `num.eq.${safe},invoice_number.eq.${safe},ksef_number.eq.${safe}`;
}

function addDays(dateText: string, days: number) {
  const d = new Date(dateText);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function inferPaymentDays(inv: any, rules?: RuleMap): number | null {
  const raw =
    inv?.payment_days ??
    inv?.paymentTermsDays ??
    inv?.payment_terms_days ??
    inv?.termin_dni ??
    inv?.payment_term_days ??
    null;

  if (raw !== null && raw !== "") {
    const days = Number(raw);
    if (Number.isInteger(days) && days >= 0) return days;
  }

  // Jeśli termin płatności i data wystawienia są znane (np. z XML KSeF), wylicz liczbę dni terminu
  if (inv?.due_date && inv?.issue_date) {
    const issueTime = new Date(inv.issue_date).getTime();
    const dueTime = new Date(inv.due_date).getTime();
    if (!isNaN(issueTime) && !isNaN(dueTime)) {
      const diffDays = Math.round((dueTime - issueTime) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0) return diffDays;
    }
  }

  return rules ? rulePaymentDays(inv, rules) : null;
}
function inferDueDate(inv: any, rules?: RuleMap) {
  // Termin podany przez brokera ma pierwszeństwo przed regułami.
  if (inv?.due_date) return inv.due_date;

  const issueDate = inv?.issue_date ?? null;
  const paymentDays = inferPaymentDays(inv, rules);

  if (!issueDate || paymentDays === null) return null;
  return addDays(issueDate, paymentDays);
}

async function markMessageIfNew(messageId: string) {
  const { data: existing, error: selectError } = await supabase
    .from("processed_webhook_messages")
    .select("message_id")
    .eq("message_id", messageId)
    .maybeSingle();

  if (selectError) {
    console.error("[Dedup] select error:", selectError.message);
  }

  if (existing) {
    return false;
  }

  const { error: insertError } = await supabase
    .from("processed_webhook_messages")
    .insert({ message_id: messageId });

  if (insertError) {
    const msg = String(insertError.message || "").toLowerCase();
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return false;
    }
    console.error("[Dedup] insert error:", insertError.message);
    return false;
  }

  return true;
}

async function sendWhatsAppMessage(to: string, body: string) {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

  if (!token || !phoneNumberId) {
    throw new Error("Brak WHATSAPP_ACCESS_TOKEN lub WHATSAPP_PHONE_NUMBER_ID");
  }

  const response = await fetch(`https://graph.facebook.com/v22.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`WhatsApp API error: ${response.status} ${errText}`);
  }

  return true;
}

async function fetchInvoicesFromBroker(params: { daysBack?: number; from?: string; to?: string }) {
  let brokerBaseUrl = (Deno.env.get("KSEF_BROKER_URL") ?? "").trim();
  const brokerApiKey = (Deno.env.get("KSEF_BROKER_API_KEY") ?? "").trim();

  if (!brokerBaseUrl || !brokerApiKey) {
    throw new Error("Brak KSEF_BROKER_URL lub KSEF_BROKER_API_KEY");
  }

  while (brokerBaseUrl.endsWith("/")) {
    brokerBaseUrl = brokerBaseUrl.slice(0, -1);
  }

  const body =
    params.from && params.to
      ? { from: params.from, to: params.to }
      : { daysBack: params.daysBack ?? 30 };

  const res = await fetch(`${brokerBaseUrl}/fetch-invoices`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${brokerApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Broker error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return Array.isArray(data?.invoices) ? data.invoices : [];
}

function decodeXmlEntities(str: string): string {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function cleanOrderNumber(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = decodeXmlEntities(raw)
    .replace(/^["'„”«»#\(\)\[\]\:\s\.\,\;\\/\-]+|["'„”«»#\(\)\[\]\:\s\.\,\;\\/\-]+$/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

function parseOrderNumberFromText(rawText: string): string | null {
  if (!rawText || typeof rawText !== "string") return null;
  const text = decodeXmlEntities(rawText);

  const patterns = [
    /\b(?:zlecen(?:ie|ia)?\s+transportow(?:e|ego|ym)?|zlec\.?\s*transp\.?)\s*(?:nr|numer|ref|id|:|\#)?[\s:\.\/\-#\(\)\[\]"'\u201e\u201d]*([A-Za-z0-9\/\-_\.]+)/i,
    /\b(?:zlecen(?:ie|ia)?|zlec\.)\s*(?:nr|numer|ref|id|:|\#)[\s:\.\/\-#\(\)\[\]"'\u201e\u201d]*([A-Za-z0-9\/\-_\.]+)/i,
    /\b(?:nr|numer)\s*zlecenia(?:\s+transportowego)?[\s:\.\/\-#\(\)\[\]"'\u201e\u201d]*([A-Za-z0-9\/\-_\.]+)/i,
    /\bzlecenie[\s:\-]+([A-Za-z0-9\/\-_\.]+)/i,
    /\b(?:order|po)\s*(?:no|nr|number|ref)?[\s:\.\/\-#]+([A-Za-z0-9\/\-_\.]+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidate = cleanOrderNumber(match[1]);
      if (candidate && candidate.length > 1) return candidate;
    }
  }

  return null;
}

function parseRateNumber(val: any): number | null {
  if (val == null) return null;
  if (typeof val === "number") return Number.isFinite(val) && val > 0 ? val : null;
  if (typeof val === "string") {
    const cleaned = val.trim().replace(",", ".");
    const num = Number(cleaned);
    return Number.isFinite(num) && num > 0 ? num : null;
  }
  return null;
}

interface XmlInvoiceData {
  saleDate: string | null;
  dueDate: string | null;
  orderNumber: string | null;
  exchangeRate: number | null;
}

async function fetchXmlDatesFromBroker(ksefNumbers: string[]): Promise<Record<string, XmlInvoiceData>> {
  if (!ksefNumbers || ksefNumbers.length === 0) return {};

  let brokerBaseUrl = (Deno.env.get("KSEF_BROKER_URL") ?? "").trim();
  const brokerApiKey = (Deno.env.get("KSEF_BROKER_API_KEY") ?? "").trim();

  if (!brokerBaseUrl || !brokerApiKey) {
    return {};
  }

  while (brokerBaseUrl.endsWith("/")) {
    brokerBaseUrl = brokerBaseUrl.slice(0, -1);
  }

  try {
    const res = await fetch(`${brokerBaseUrl}/fetch-xml-dates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${brokerApiKey}`,
      },
      body: JSON.stringify({ ksefNumbers }),
    });

    if (!res.ok) {
      console.warn(`[KSeF Broker XML] Błąd ${res.status} pobierania danych XML:`, await res.text());
      return {};
    }

    const data = await res.json();
    const result: Record<string, XmlInvoiceData> = {};

    if (data && typeof data.invoicesData === "object" && data.invoicesData) {
      for (const [key, val] of Object.entries(data.invoicesData as Record<string, any>)) {
        const rawOrder = val?.orderNumber ?? val?.order_number ?? val?.order ?? null;
        const parsedOrder = rawOrder ? (parseOrderNumberFromText(String(rawOrder)) || cleanOrderNumber(String(rawOrder))) : null;
        const notesText = val?.notes || val?.uwagi || val?.comments || val?.description || val?.dodatkowyOpis || val?.xml || val?.rawXml || "";
        const extractedOrderFromNotes = notesText ? parseOrderNumberFromText(String(notesText)) : null;

        const parsedRate = parseRateNumber(
          val?.exchangeRate ??
          val?.exchange_rate ??
          val?.kursWalutyZ ??
          val?.kurs_waluty_z ??
          val?.kursWaluty ??
          val?.kurs_waluty ??
          val?.kurs ??
          val?.rate
        );

        const resolvedOrder = parsedOrder || extractedOrderFromNotes;

        result[key] = {
          saleDate: val?.saleDate ?? null,
          dueDate: val?.dueDate ?? null,
          orderNumber: val?.orderNumber ?? null,
          exchangeRate: parsedRate,
        };
        if (resolvedOrder) {
          result[key].orderNumber = resolvedOrder;
        }
      }
      return result;
    }

    const dates = (data && typeof data.dates === "object" && data.dates) ? data.dates : {};
    const dueDates = (data && typeof data.dueDates === "object" && data.dueDates) ? data.dueDates : {};
    const orderNumbers = (data && typeof data.orderNumbers === "object" && data.orderNumbers) ? data.orderNumbers : {};
    const exchangeRates = (data && typeof data.exchangeRates === "object" && data.exchangeRates) ? data.exchangeRates : {};

    for (const num of ksefNumbers) {
      const saleVal = dates[num];
      const dueVal = dueDates[num];
      const orderVal = orderNumbers[num];
      const rateVal = exchangeRates[num];

      const parsedOrder = orderVal ? (parseOrderNumberFromText(String(orderVal)) || cleanOrderNumber(String(orderVal))) : null;

      result[num] = {
        saleDate: typeof saleVal === "string" ? saleVal : (saleVal?.saleDate ?? null),
        dueDate: typeof dueVal === "string" ? dueVal : (dueVal?.dueDate ?? null),
        orderNumber: parsedOrder || (orderVal ? String(orderVal) : null),
        exchangeRate: parseRateNumber(rateVal),
      };
    }

    return result;
  } catch (err: any) {
    console.warn("[KSeF Broker XML] Błąd wywołania /fetch-xml-dates:", err.message);
    return {};
  }
}

async function getNewInvoicesXmlDates(invoices: any[]): Promise<Record<string, XmlInvoiceData>> {
  const ksefNumbersToCheck = invoices.map((inv: any) => inv.ksef_number).filter(Boolean);
  if (ksefNumbersToCheck.length === 0) return {};

  const { data: existingInvoices } = await supabase
    .from("invoices")
    .select("ksef_number, service_month, order_number, exchange_rate, currency")
    .in("ksef_number", ksefNumbersToCheck);

  // Pomijamy tylko faktury, które już mają w bazie pełen komplet danych z XML
  const completeSet = new Set(
    (existingInvoices || [])
      .filter((inv: any) => {
        const hasOrder = Boolean(inv.order_number);
        const isPln = !inv.currency || inv.currency === "PLN";
        const hasRate = isPln || (inv.exchange_rate != null && Number(inv.exchange_rate) > 0);
        return Boolean(inv.service_month) && hasOrder && hasRate;
      })
      .map((e: any) => e.ksef_number)
  );

  const newKsefNumbers = ksefNumbersToCheck.filter((num: string) => !completeSet.has(num));
  if (newKsefNumbers.length === 0) return {};
  return await fetchXmlDatesFromBroker(newKsefNumbers);
}

function getPreviousDayIso(dateStr?: string | null): string | null {
  if (!dateStr || !isIsoDate(dateStr)) return null;
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function resolveInvoiceExchangeRate(inv: any, xmlInfo?: XmlInvoiceData): Promise<number | null> {
  const cur = String(inv.currency || "PLN").trim().toUpperCase();
  if (cur === "PLN") return 1.0;

  // 1. Kurs z KSeF XML zwrócony przez brokera (np. pole KursWalutyZ ze schematu FA(2))
  if (xmlInfo && xmlInfo.exchangeRate != null && Number(xmlInfo.exchangeRate) > 0) {
    return Number(xmlInfo.exchangeRate);
  }

  // 2. Jeśli broker przekazał kurs bezpośrednio na obiekcie faktury inv
  const invRate = parseRateNumber(
    inv.exchange_rate ??
    inv.exchangeRate ??
    inv.kursWalutyZ ??
    inv.kurs ??
    inv.rate
  );
  if (invRate != null && invRate > 0) {
    return invRate;
  }

  // 3. Sprawdzenie czy w uwagach / opisie faktury nie ma wpisanego kursu (np. "kurs: 4.2851" lub "kurs EUR 4,2851")
  const notesText = String(inv.notes || inv.uwagi || inv.description || inv.comments || "");
  const matchRateInNotes = notesText.match(/\bkurs(?:[\s_]+(?:nbp|waluty|eur|zastosowany))?[\s:\.\-]*([0-9]+[,\.][0-9]{2,6})\b/i);
  if (matchRateInNotes && matchRateInNotes[1]) {
    const fromNotes = parseRateNumber(matchRateInNotes[1]);
    if (fromNotes) return fromNotes;
  }

  // 4. Ostateczny fallback: Kurs z NBP z ostatniego dnia roboczego poprzedzającego datę sprzedaży lub wystawienia (art. 31a ustawy o VAT)
  const effectiveDate = (typeof xmlInfo === "object" && xmlInfo?.saleDate) || inv.sale_date || inv.issue_date || null;
  const dayBefore = getPreviousDayIso(effectiveDate) || effectiveDate;
  if (dayBefore) {
    try {
      const rates = await getRatesForDate(dayBefore);
      if (rates && rates[cur]) {
        return Number(rates[cur]);
      }
    } catch (err: any) {
      console.warn(`[KSeF Sync] Błąd pobierania kursu NBP dla ${cur} (${dayBefore}):`, err?.message || err);
    }
  }

  return null;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const verifyToken = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const AUTO_WYPLATA_PHONE_RAW = Deno.env.get("AUTO_WYPLATA_PHONE") ?? "";
const AUTO_WYPLATA_VEHICLE_FALLBACK = Deno.env.get("AUTO_WYPLATA_VEHICLE") ?? "";

const AUTO_WYPLATA_RECIPIENTS = AUTO_WYPLATA_PHONE_RAW
  .split(",")
  .map((p) => p.trim())
  .filter((p) => p.length > 0);

if (
  req.method === "POST" &&
  CRON_SECRET &&
  req.headers.get("x-cron-secret") === CRON_SECRET
) {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const isLastDayOfMonth = tomorrow.getDate() === 1;

  if (!isLastDayOfMonth) {
    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: "not_last_day_of_month" }),
      { status: 200 }
    );
  }

  if (AUTO_WYPLATA_RECIPIENTS.length === 0) {
    console.error("Brak AUTO_WYPLATA_PHONE w zmiennych srodowiskowych.");
    return new Response(
      JSON.stringify({ ok: false, error: "Brak AUTO_WYPLATA_PHONE" }),
      { status: 200 }
    );
  }

  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [autoYear, autoMonthNum] = month.split("-").map(Number);
  const startOfMonth = `${month}-01`;
  const endOfMonth = new Date(autoYear, autoMonthNum, 0).toISOString().split("T")[0];

  // NOWOSC: rozliczamy WSZYSTKICH aktywnych kierowcow z tabeli drivers, nie tylko jednego z ENV.
  const { data: activeDrivers, error: activeDriversErr } = await supabase
    .from("drivers")
    .select("*")
    .eq("active", true);

  if (activeDriversErr) {
    const msg = `❌ [AUTO] Błąd pobierania kierowców: ${activeDriversErr.message}`;
    for (const phone of AUTO_WYPLATA_RECIPIENTS) {
      await sendWhatsAppMessage(phone, msg);
    }
    return new Response(JSON.stringify({ ok: false, autoTriggered: true, error: true }), { status: 200 });
  }

  if (!activeDrivers || activeDrivers.length === 0) {
    const msg = `ℹ️ [AUTO] Brak aktywnych kierowców do automatycznego rozliczenia za ${month}.`;
    for (const phone of AUTO_WYPLATA_RECIPIENTS) {
      await sendWhatsAppMessage(phone, msg);
    }
    return new Response(JSON.stringify({ ok: true, autoTriggered: true, driversProcessed: 0 }), { status: 200 });
  }

  const autoResults: any[] = [];

  for (const driver of activeDrivers) {
    const driverName = driver.name as string;
    const vehicleKey = (driver.default_vehicle as string | null) || AUTO_WYPLATA_VEHICLE_FALLBACK;

    const { data: trips, error: tripsErr } = await supabase
      .from("driver_trips")
      .select("*")
      .ilike("driver_name", driverName)
      .lte("start_date", endOfMonth)
      .or(`end_date.gte.${startOfMonth},end_date.is.null`);

    if (tripsErr) {
      const msg = `❌ [AUTO] Błąd pobierania tras dla ${driverName}: ${tripsErr.message}`;
      for (const phone of AUTO_WYPLATA_RECIPIENTS) {
        await sendWhatsAppMessage(phone, msg);
      }
      autoResults.push({ driver: driverName, error: true });
      continue;
    }

    let totalDaysInMonth = 0;
    let tripsSummary = "";

    (trips || []).forEach((t) => {
      const tripStart = t.start_date;
      const tripEnd = t.end_date || endOfMonth;

      const effectiveStart = tripStart < startOfMonth ? startOfMonth : tripStart;
      const effectiveEnd = tripEnd > endOfMonth ? endOfMonth : tripEnd;

      const sMs = new Date(effectiveStart).getTime();
      const eMs = new Date(effectiveEnd).getTime();
      const daysInThisMonth = Math.max(1, Math.round((eMs - sMs) / (1000 * 60 * 60 * 24)) + 1);

      totalDaysInMonth += daysInThisMonth;
      const note = t.description ? ` (${t.description})` : "";
      tripsSummary += `• ${tripStart} ➔ ${t.end_date || "w trasie"} : *${daysInThisMonth} dni* w tym m-cu${note}\n`;
    });

    const baseSalary = Number(driver.base_salary) || 0;
    const dailyRate = Number(driver.daily_rate) || 0;
    const totalDailyPay = totalDaysInMonth * dailyRate;
    const totalPayout = baseSalary + totalDailyPay;

    const vehicle = vehicleKey ? await findVehicle(vehicleKey) : null;
    const vehicleNote = vehicle
      ? `🚛 Przypisano do pojazdu: *${String(vehicle.name).toUpperCase()} (${vehicle.plate})*`
      : `⚠️ Brak przypisanego pojazdu — koszt zapisano jako nieprzypisany. Ustaw drivers.default_vehicle albo wpisz *pojazdy*, aby sprawdzić dostępne auta.`;

    const autoDescription = `Wypłata ${driverName} (auto)`;
    const { data: existingCost } = await supabase
      .from("expenses")
      .select("id, amount")
      .eq("expense_month", month)
      .eq("description", autoDescription)
      .maybeSingle();

    let expenseId: number | null = null;
    let alreadyExisted = false;

    if (existingCost) {
      expenseId = existingCost.id;
      alreadyExisted = true;
    } else {
      const { data: insertedCost, error: insertError } = await supabase
        .from("expenses")
        .insert({
          category: "kierowca",
          amount: Math.round(totalPayout * 100) / 100,
          expense_month: month,
          description: autoDescription,
          vehicle_id: vehicle?.id ?? null,
          allocation_type: vehicle ? "vehicle" : "unassigned",
        })
        .select("id")
        .maybeSingle();

      if (insertError) {
        const msg = `⚠️ [AUTO] Wyliczono wypłatę dla ${driverName} (${totalPayout.toFixed(2)} PLN), ale nie udało się zapisać kosztu: ${insertError.message}\n\nZapisz ręcznie:\n*koszt kierowca ${totalPayout.toFixed(0)} ${month} Wypłata ${driverName}*`;
        for (const phone of AUTO_WYPLATA_RECIPIENTS) {
          await sendWhatsAppMessage(phone, msg);
        }
        autoResults.push({ driver: driverName, costSaveFailed: true });
        continue;
      }

      expenseId = insertedCost?.id ?? null;
    }

    const savedInfo = alreadyExisted
      ? `ℹ️ _Koszt za ten miesiąc był już wcześniej zapisany (ID: ${expenseId}) — nie dodano duplikatu._`
      : `✅ *Zapisano jako koszt firmy* (kategoria: kierowca, ID: ${expenseId}).\n${vehicleNote}`;

    const message = `🤖 *AUTOMATYCZNE ROZLICZENIE (ostatni dzień miesiąca)*\n\n👨‍✈️ *ROZLICZENIE: ${driverName.toUpperCase()} (${month})*\n\n💼 *Podstawa:* ${baseSalary.toFixed(2)} PLN\n📅 *Dni w trasie:* ${totalDaysInMonth} dni x ${dailyRate} PLN = *${totalDailyPay.toFixed(2)} PLN*\n\n🛣 *Zrealizowane trasy:*\n${tripsSummary || "Brak zarejestrowanych tras w tym miesiącu.\n"}\n━━━━━━━━━━━━━━━\n💰 *DO WYPŁATY:* *${totalPayout.toFixed(2)} PLN*\n\n${savedInfo}\n\n💡 _Jeśli chcesz to usunąć/poprawić, wpisz:_ *usun_koszt ${expenseId}*`;

    const recipientSet = new Set(AUTO_WYPLATA_RECIPIENTS);
    if (driver.phone) recipientSet.add(String(driver.phone).trim());

    for (const phone of recipientSet) {
      await sendWhatsAppMessage(phone, message);
    }

    autoResults.push({
      driver: driverName,
      expenseId,
      alreadyExisted,
      vehicleId: vehicle?.id ?? null,
      totalPayout,
    });
  }

  return new Response(
    JSON.stringify({ ok: true, autoTriggered: true, month, driversProcessed: autoResults.length, results: autoResults }),
    { status: 200 }
  );
}


    if (req.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");

      if (mode === "subscribe" && token === verifyToken && challenge) {
        return new Response(challenge, {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }

      return new Response("Verification failed", { status: 403 });
    }

    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
        },
      });
    }

    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const rawBody = await req.text();
    let payload: any = null;

    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
    }

    // Direct invocation from web app to sync KSeF invoices
    if (payload?.action === "pobierz" || payload?.command === "pobierz") {
      const mode = payload.mode || "today";
      let fetchParams: { from?: string; to?: string; daysBack?: number } = {};
      if (mode === "today") {
        const todayStr = getTodayIsoInPoland();
        fetchParams = { from: todayStr, to: todayStr };
      } else if (mode === "range") {
        fetchParams = { from: payload.from, to: payload.to };
      } else {
        fetchParams = { daysBack: Number(payload.daysBack) || 30 };
      }

      try {
        const rawInvoices = await fetchInvoicesFromBroker(fetchParams);
        const invoices = rawInvoices.filter((inv: any) =>
          inv &&
          inv.ksef_number &&
          inv.invoice_number &&
          inv.gross_amount != null
        );

        if (invoices.length === 0) {
          return new Response(JSON.stringify({ ok: true, count: 0, message: "Brak faktur w KSeF dla wybranego zakresu." }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            status: 200,
          });
        }

        const rules = await loadRules();
        const { data: activeVehicles } = await supabase
          .from("vehicles")
          .select("id, name, plate")
          .eq("active", true);

        const vehicleByKey = new Map<string, any>();
        for (const vehicle of activeVehicles ?? []) {
          vehicleByKey.set(
            String(vehicle.name).trim().toLowerCase().replace(/[\s-]/g, ""),
            vehicle
          );
          vehicleByKey.set(
            String(vehicle.plate).trim().toLowerCase().replace(/[\s-]/g, ""),
            vehicle
          );
        }

        const xmlDatesMap = await getNewInvoicesXmlDates(invoices);

        // Pobieramy istniejące faktury z bazy, aby zachować stan opłacenia, pojazd oraz pliki
        const { data: existingInvoices } = await supabase
          .from("invoices")
          .select("ksef_number, paid, vehicle_id, allocation_type, order_number, exchange_rate, order_file_url, order_file_name")
          .in("ksef_number", invoices.map((i: any) => i.ksef_number).filter(Boolean));
        const existingMap = new Map((existingInvoices || []).map((e: any) => [e.ksef_number, e]));

        const payloadToInsert = await Promise.all(
          invoices.map(async (inv: any) => {
            const nip = normalizeNip(inv.seller_nip);
            const vehicleRule = rules.get("vehicle_by_nip")?.get(nip);
            const vehicleKey = String(vehicleRule?.vehicle ?? "")
              .trim()
              .toLowerCase()
              .replace(/[\s-]/g, "");

            const vehicle = vehicleByKey.get(vehicleKey) ?? null;

            const existing = existingMap.get(inv.ksef_number);
            const xmlInfo = xmlDatesMap[inv.ksef_number];
            const saleDate = (typeof xmlInfo === "object" && xmlInfo !== null)
              ? xmlInfo.saleDate
              : (typeof xmlInfo === "string" ? xmlInfo : (inv.sale_date || null));
            const ksefDueDate = (typeof xmlInfo === "object" && xmlInfo !== null)
              ? xmlInfo.dueDate
              : null;

            const rawOrderFromXml = (typeof xmlInfo === "object" && xmlInfo !== null) ? xmlInfo.orderNumber : null;
            const parsedOrderFromInv = parseOrderNumberFromText(String(inv.order_number || inv.notes || inv.uwagi || inv.description || inv.comments || ""));
            const ksefOrderNumber = (rawOrderFromXml ? (parseOrderNumberFromText(String(rawOrderFromXml)) || cleanOrderNumber(String(rawOrderFromXml))) : null) ||
                                    parsedOrderFromInv ||
                                    cleanOrderNumber(String(inv.order_number || "")) ||
                                    existing?.order_number ||
                                    null;

            const effectiveDate = saleDate || inv.issue_date || null;
            const serviceMonth = effectiveDate ? effectiveDate.slice(0, 7) : null;

            const invWithDueDate = {
              ...inv,
              due_date: ksefDueDate || inv.due_date || null,
            };

            const ksefExchangeRate = await resolveInvoiceExchangeRate(inv, xmlInfo);

            return {
              ksef_number: inv.ksef_number || null,
              num: inv.invoice_number || inv.ksef_number || null,
              invoice_number: inv.invoice_number || null,
              order_number: ksefOrderNumber || null,
              issue_date: inv.issue_date || null,
              service_month: serviceMonth,
              due_date: inferDueDate(invWithDueDate, rules),
              payment_days: inferPaymentDays(invWithDueDate, rules),
              gross_amount: inv.gross_amount ?? null,
              net_amount: inv.net_amount ?? null,
              currency: inv.currency || "PLN",
              exchange_rate: ksefExchangeRate ?? existing?.exchange_rate ?? null,
              seller_name: inv.seller_name || null,
              seller_nip: inv.seller_nip || null,
              buyer_nip: inv.buyer_nip || null,
              source: "ksef",
              ksef_status: "accepted",
              paid: existing?.paid ?? false,
              vehicle_id: existing?.vehicle_id ?? vehicle?.id ?? null,
              allocation_type: existing?.allocation_type ?? (vehicle ? "vehicle" : "unassigned"),
              order_file_url: existing?.order_file_url ?? null,
              order_file_name: existing?.order_file_name ?? null,
              updated_at: new Date().toISOString(),
            };
          })
        );

        let { error: upsertErr } = await supabase
          .from("invoices")
          .upsert(payloadToInsert, {
            onConflict: "ksef_number",
            ignoreDuplicates: true,
          });

        if (upsertErr && (upsertErr.message?.includes("exchange_rate") || (upsertErr as any).code === "42703")) {
          console.warn("[KSeF Sync] Kolumna exchange_rate nie istnieje w bazie - ponawiam zapis bez kolumny.");
          const safePayload = payloadToInsert.map(({ exchange_rate, ...rest }: any) => rest);
          const retryResult = await supabase
            .from("invoices")
            .upsert(safePayload, {
              onConflict: "ksef_number",
              ignoreDuplicates: true,
            });
          upsertErr = retryResult.error;
        }

        if (upsertErr) throw upsertErr;

        // Uzupełnienie brakującego numeru zlecenia i kursu walut dla istniejących faktur
        const enrichmentPromises = payloadToInsert.map(async (item: any) => {
          if (!item.ksef_number) return;
          const updates: Record<string, any> = {};
          if (item.order_number) updates.order_number = item.order_number;
          if (item.exchange_rate) updates.exchange_rate = item.exchange_rate;
          if (item.service_month) updates.service_month = item.service_month;
          if (item.due_date) updates.due_date = item.due_date;
          if (item.payment_days != null) updates.payment_days = item.payment_days;
          if (Object.keys(updates).length > 0) {
            let { error: updErr } = await supabase
              .from("invoices")
              .update(updates)
              .eq("ksef_number", item.ksef_number);
            if (updErr && (updErr.message?.includes("exchange_rate") || (updErr as any).code === "42703")) {
              delete updates.exchange_rate;
              if (Object.keys(updates).length > 0) {
                await supabase.from("invoices").update(updates).eq("ksef_number", item.ksef_number);
              }
            }
          }
        });
        await Promise.allSettled(enrichmentPromises);

        return new Response(JSON.stringify({ ok: true, count: invoices.length, message: "Pobrano i zapisano " + invoices.length + " faktur z KSeF." }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          status: 200,
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ ok: false, error: err.message || "Błąd pobierania" }), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          status: 400,
        });
      }
    }

    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    const status = value?.statuses?.[0];

    if (status) {
      return new Response(JSON.stringify({ ok: true, type: "status_event_ignored" }), { status: 200 });
    }

    const from = msg?.from ?? null;
    if (!from) {
      return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200 });
    }

    const messageId = msg?.id ?? null;

    if (!messageId) {
      return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200 });
    }

    const isNewMessage = await markMessageIfNew(messageId);

    if (!isNewMessage) {
      console.log("[Dedup] Duplikat webhooka, ignoruję:", messageId);
      return new Response(JSON.stringify({ ok: true, duplicate: true }), { status: 200 });
    }
        // ==========================================
    // 1. ODBIÓR PLIKU XLSX Z E100
    // ==========================================
    if (msg.type === "document") {
      const doc = msg.document;
      const filename = (doc.filename || "").toLowerCase();

      if (!filename.endsWith(".xlsx")) {
        await sendWhatsAppMessage(from, "⚠️ Prześlij raport w formacie Excela (*.xlsx*) z portalu E100.");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "";

      // Pobieranie pliku z WhatsApp
      const mediaRes = await fetch(`https://graph.facebook.com/v19.0/${doc.id}`, {
        headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}` },
      });
      const mediaJson = await mediaRes.json();
      if (!mediaJson.url) {
        await sendWhatsAppMessage(from, "❌ Nie udało się pobrać pliku z WhatsApp.");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const fileRes = await fetch(mediaJson.url, {
        headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}` },
      });
      const fileBuffer = await fileRes.arrayBuffer();

      // Odczyt arkusza przez SheetJS
      const workbook = XLSX.read(new Uint8Array(fileBuffer), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      const cellB2Val = String(sheet?.["B2"]?.w ?? sheet?.["B2"]?.v ?? rawRows[1]?.[1] ?? "").trim();
      const reportPeriod = cellB2Val.replace(/^okres\s*:\s*/i, "").trim();

      let headerIdx = -1;
      for (let i = 0; i < Math.min(25, rawRows.length); i++) {
        const rStr = (rawRows[i] || []).join(" ").toLowerCase();
        if (rStr.includes("numer karty") || rStr.includes("numer samochodu")) {
          headerIdx = i;
          break;
        }
      }

      if (headerIdx === -1) {
        await sendWhatsAppMessage(from, "❌ Nie rozpoznano struktury raportu E100.");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const headers = rawRows[headerIdx].map((h: any) => String(h || "").trim().toLowerCase());
      let colCar = headers.indexOf("numer samochodu");
      if (colCar === -1) {
        colCar = headers.findIndex((h: string) =>
          h.includes("samochod") ||
          h.includes("samochód") ||
          h.includes("pojazd") ||
          h.includes("rejestr") ||
          h.includes("rej") ||
          h.includes("auto")
        );
      }
      const colDate = headers.indexOf("data");
      const colCountry = headers.indexOf("kraj");
      const colService = headers.indexOf("usługa");
      const colQty = headers.indexOf("ilość");
      const colAmount = headers.indexOf("kwota");
      const colCurrency = headers.indexOf("waluta");

      let truckPlate = "Pojazd";
      const transactions = [];

      for (let i = headerIdx + 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || !row[colAmount]) continue;

        if (colCar !== -1 && row[colCar] && truckPlate === "Pojazd") {
          truckPlate = String(row[colCar]).trim();
        }

        transactions.push({
          date: String(row[colDate] || "").trim(),
          service: String(row[colService] || "").trim(),
          country: String(row[colCountry] || "").trim(),
          gross: Number(String(row[colAmount]).replace(",", ".")) || 0,
          currency: String(row[colCurrency] || "PLN").trim().toUpperCase(),
          qty: Number(String(row[colQty]).replace(",", ".")) || 0,
          report_period: reportPeriod || null,
        });
      }

      // Zapisujemy transakcje w tabeli oczekującej
      const detectedVehicle = await findVehicle(truckPlate);
      const displayPlate = detectedVehicle ? `${detectedVehicle.name.toUpperCase()} (${detectedVehicle.plate})` : truckPlate;
      await supabase.from("pending_imports").upsert({
        phone: from,
        truck_plate: displayPlate,
        transactions: transactions,
        vehicle_id: detectedVehicle?.id ?? null,
        created_at: new Date().toISOString()
      }, { onConflict: "phone" });

      const dateRange = getE100DateRange(transactions);
      const fallbackRange = dateRange
        ? (dateRange.minDate === dateRange.maxDate
            ? `${dateRange.minDate}`
            : `od ${dateRange.minDate} do ${dateRange.maxDate}`)
        : "";
      const displayPeriod = reportPeriod || fallbackRange;
      const periodText = displayPeriod ? `📅 *Okres raportu:* ${displayPeriod}\n` : "";

      await sendWhatsAppMessage(from, `📥 *Pobrałem raport E100 dla pojazdu ${displayPlate}!*
${periodText}Znaleziono *${transactions.length}* transakcji.

👉 *Do jakiego miesiąca mam przypisać te koszty?*
Odpisz po prostu: *wrzesien*, *lipiec* lub *lipiec od 28.06* (możesz też podać pojazd, np. *październik mercedes*)

💡 _Możesz też wpisać:_
• *podglad* — podgląd transakcji z datami
• *anuluj* — anuluj import`);

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const incomingCommand = getIncomingCommand(msg);
if (!incomingCommand) {
  return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200 });
}

const command = parseCommand(incomingCommand);
    // 2. SPRAWDZENIE CZY ODPOWIADASZ NA IMPORT E100
    // ==========================================
    const userText = (msg.text?.body || "").trim().toLowerCase();

    const { data: pending } = await supabase
      .from("pending_imports")
      .select("*")
      .eq("phone", from)
      .maybeSingle();

    if (pending && pending.transactions?.length > 0) {
      if (userText === "anuluj" || userText === "cofnij" || userText === "stop") {
        await supabase.from("pending_imports").delete().eq("phone", from);
        await sendWhatsAppMessage(from, "*Anulowano import raportu E100.* Żadne koszty nie zostały zapisane.");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (userText === "podglad" || userText === "podgląd" || userText === "transakcje") {
        const lines = (pending.transactions || []).slice(0, 30).map((t: any) => {
          const qtyStr = Number(t.qty) > 0 ? ` | ${Number(t.qty).toFixed(1)}L` : "";
          return `• *${t.date}* | ${t.service} (${t.country}) | *${t.gross} ${t.currency}*${qtyStr}`;
        });

        const moreNote = pending.transactions.length > 30
          ? `\n\nℹ️ _...oraz jeszcze ${pending.transactions.length - 30} kolejnych transakcji._`
          : "";

        const firstWithPeriod = (pending.transactions || []).find((t: any) => Boolean(t.report_period));
        const dateRange = getE100DateRange(pending.transactions);
        const fallbackRange = dateRange
          ? (dateRange.minDate === dateRange.maxDate
              ? `${dateRange.minDate}`
              : `od ${dateRange.minDate} do ${dateRange.maxDate}`)
          : "";
        const displayPeriod = firstWithPeriod?.report_period || fallbackRange;
        const periodHeader = displayPeriod ? `📅 Okres: *${displayPeriod}*\n` : "";

        const previewMsg = `📄 *Transakcje z raportu E100 dla ${pending.truck_plate}:*
${periodHeader}Łącznie transakcji: *${pending.transactions.length}*

${lines.join("\n")}${moreNote}

👉 *Do jakiego miesiąca mam przypisać te koszty?*
Odpisz: np. *lipiec*, *lipiec od 28.06* lub *anuluj*`;

        await sendWhatsAppMessage(from, previewMsg);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const polishMonths: Record<string, string> = {
        styczen: "01", styczeń: "01", luty: "02", marzec: "03", kwiecien: "04", kwiecień: "04",
        maj: "05", czerwiec: "06", lipiec: "07", sierpien: "08", sierpień: "08",
        wrzesien: "09", wrzesień: "09", padziernik: "10", pazdziernik: "10", październik: "10",
        listopad: "11", grudzien: "12", grudzień: "12"
      };

      let targetMonth = "";
      const currentYear = new Date().getFullYear();

      for (const [name, num] of Object.entries(polishMonths)) {
        if (userText.includes(name)) {
          targetMonth = `${currentYear}-${num}`;
          break;
        }
      }

      const isoMonthMatch = userText.match(/\b(\d{4}-\d{2})\b/);
      if (isoMonthMatch) {
        targetMonth = isoMonthMatch[1];
      }

      if (targetMonth) {
        // Sprawdzamy czy w wiadomości użytkownik podał też pojazd (np. "październik mercedes" lub "2026-10 DW12345")
        const words = userText.split(/\s+/).filter(Boolean);
        for (const w of words) {
          if (
            !w.includes("od") &&
            !polishMonths[w] &&
            !/^\d{4}-\d{2}$/.test(w) &&
            !/^\d{1,2}[./]\d{1,2}/.test(w)
          ) {
            const v = await findVehicle(w);
            if (v) {
              pending.vehicle_id = v.id;
              pending.truck_plate = `${v.name.toUpperCase()} (${v.plate})`;
              break;
            }
          }
        }

        await sendWhatsAppMessage(from, "⏳ Przeliczam kwoty na NETTO i pobieram kurs NBP...");

        let filterDateIso: string | null = null;
        const matchFrom = userText.match(/od\s*(\d{1,2})[./](\d{1,2})/i);
        if (matchFrom) {
          const day = matchFrom[1].padStart(2, "0");
          const m = matchFrom[2].padStart(2, "0");
          filterDateIso = `${m}-${day}`;
        }
                const rates = await getRates();
                const rules = await loadRules();
        const eurRate = Number(rates["EUR"] || 4.30);

        let fuelNetPln = 0;
        let fuelLiters = 0;
        let tollNetPln = 0;
        const e100Rows: any[] = [];

        for (const t of pending.transactions) {
          if (filterDateIso && t.date.includes(".")) {
            const [d, m] = t.date.split(".");
            const rowDate = `${m.padStart(2, "0")}-${d.padStart(2, "0")}`;

            if (rowDate < filterDateIso) continue;
          }

          const sLow = String(t.service ?? "").toLowerCase();
const isFuel =
  sLow.includes("on") ||
  sLow.includes("paliwo") ||
  sLow.includes("diesel");

const isToll =
  sLow.includes("drogi") ||
  sLow.includes("toll") ||
  sLow.includes("e-box") ||
  sLow.includes("t4e");

let net: number;

if (isFuel || isToll) {
  const divisor = ruleVatDivisor(
    rules,
    t.country,
    isFuel ? "paliwo" : "myto"
  );

  if (divisor === null) {
    throw new Error(`Brak poprawnej reguły VAT dla kraju ${t.country}`);
  }

  net = Number(t.gross) / divisor;
} else {
  // Zachowanie obecnej logiki dla pozostałych usług.
  net = calculateNetto(t.service, t.country, Number(t.gross));
}
          const currency = String(t.currency || "PLN").toUpperCase();
          const exchangeRate = Number(rates[currency] || 1);

          // Przelicza PLN, EUR, CZK i każdą inną walutę z tabeli NBP na PLN.
          const netPln = net * exchangeRate;

          if (sLow.includes("on") || sLow.includes("paliwo")) {
            fuelLiters += Number(t.qty || 0);
            fuelNetPln += netPln;
          } else {
            tollNetPln += netPln;
          }

          e100Rows.push({
            vehicle_id: pending.vehicle_id ?? null,
            truck_plate: pending.truck_plate,
            transaction_date: String(t.date || "").trim(),
            service: String(t.service || "").trim(),
            country: String(t.country || "").trim(),
            qty: Number(t.qty) || 0,
            gross_amount: Number(t.gross) || 0,
            currency: currency,
            net_amount_pln: Math.round(netPln * 100) / 100,
            expense_month: targetMonth,
            report_period: t.report_period || null,
          });
        }

        const fuelTotalPln = fuelNetPln;
        const tollTotalPln = tollNetPln;
        let fuelId: number | null = null;
        let tollId: number | null = null;

        if (fuelTotalPln > 0) {
          const { data: fData } = await supabase.from("expenses").insert({
            category: "paliwo",
            amount: Math.round(fuelTotalPln * 100) / 100,
            expense_month: targetMonth,
            description: `E100 Paliwo ${pending.truck_plate} (${fuelLiters.toFixed(1)}L)`,
vehicle_id: pending.vehicle_id ?? null,
allocation_type: pending.vehicle_id ? "vehicle" : "unassigned",
source: "e100",
          }).select("id").maybeSingle();
          if (fData) fuelId = fData.id;
        }

        if (tollTotalPln > 0) {
          const { data: tData } = await supabase.from("expenses").insert({
            category: "autostrady",
            amount: Math.round(tollTotalPln * 100) / 100,
            expense_month: targetMonth,
            description: `E100 Myto ${pending.truck_plate}`,
vehicle_id: pending.vehicle_id ?? null,
allocation_type: pending.vehicle_id ? "vehicle" : "unassigned",
source: "e100",
          }).select("id").maybeSingle();
          if (tData) tollId = tData.id;
        }

        let savedTransactionsCount = 0;
        let e100InsertError: string | null = null;

        if (e100Rows.length > 0) {
          const { error: e100InsertErr } = await supabase
            .from("e100_transactions")
            .insert(e100Rows);

          if (e100InsertErr) {
            console.error("Błąd zapisu e100_transactions (z report_period):", e100InsertErr.message);
            // Fallback: jeśli w tabeli e100_transactions w Supabase nie ma jeszcze kolumny report_period,
            // zapisujemy transakcje bez tego pola, żeby nie utracić danych!
            const rowsWithoutPeriod = e100Rows.map(({ report_period, ...rest }) => rest);
            const { error: fallbackErr } = await supabase
              .from("e100_transactions")
              .insert(rowsWithoutPeriod);

            if (fallbackErr) {
              console.error("Błąd zapisu e100_transactions (fallback):", fallbackErr.message);
              e100InsertError = fallbackErr.message;
            } else {
              savedTransactionsCount = rowsWithoutPeriod.length;
              console.log("Pomyślnie zapisano transakcje bez pola report_period (brak kolumny w schemacie).");
            }
          } else {
            savedTransactionsCount = e100Rows.length;
          }
        }

        await supabase.from("pending_imports").delete().eq("phone", from);

        const idInfo = [
          fuelId ? `• Paliwo ID: *${fuelId}*` : "",
          tollId ? `• Myto ID: *${tollId}*` : ""
        ].filter(Boolean).join("\n");

        const errorWarning = e100InsertError
          ? `\n\n⚠️ *Uwaga: Szczegółowe transakcje nie zapisały się do bazy e100_transactions:* ${e100InsertError}`
          : "";

        const summaryMsg = `✅ *Raport E100 pomyślnie rozliczony!*
🚛 Pojazd: *${pending.truck_plate}*
📅 Przypisano do miesiąca: *${targetMonth}*
💱 Kurs NBP EUR: *${eurRate.toFixed(4)} PLN*

⛽ *PALIWO (NETTO):*
• ${fuelTotalPln.toFixed(2)} PLN (${fuelLiters.toFixed(1)} L)

🛣 *AUTOSTRADY / MYTO (NETTO):*
• ${tollTotalPln.toFixed(2)} PLN

━━━━━━━━━━━━━━━
💰 *Łącznie dodano:* *${(fuelTotalPln + tollTotalPln).toFixed(2)} PLN netto*
📝 Zapisano transakcji: *${savedTransactionsCount}*

📌 *Zapisane pozycje:*
${idInfo}${errorWarning}

💡 _Przeglądaj szczegóły transakcji:_
*e100 ${targetMonth}*

💡 _Gdyby wkradł się błąd, możesz cofnąć ten import wpisując:_
*cofnij_e100 ${targetMonth}*`;

        await sendWhatsAppMessage(from, summaryMsg);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      // Jeśli użytkownik ma oczekujący import, ale wpisał nierozpoznany miesiąc
      await sendWhatsAppMessage(
        from,
        `⚠️ Nie rozpoznałem miesiąca *"${userText}"*.\n\nOdpisz np.: *październik*, *wrzesień* lub *2026-10* (możesz też dopisać pojazd, np. *październik mercedes*).\n\n💡 _Wpisz *anuluj* aby przerwać lub *podglad* aby podejrzeć listę._`
      );
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (command.type === "pojazdy") {
      const { data, error } = await supabase
        .from("vehicles")
        .select("id, name, plate, active")
        .order("name");

      if (error) {
        await sendWhatsAppMessage(
          from,
          `❌ Błąd pobierania pojazdów: ${error.message}`
        );
      } else {
        const lines = (data || []).map((vehicle: any) => {
          const status = vehicle.active ? "aktywny" : "nieaktywny";

          return `• *${String(vehicle.name).toUpperCase()}* — ${vehicle.plate} (${status})`;
        });

        await sendWhatsAppMessage(
          from,
          `🚛 *POJAZDY:*

${lines.join("") || "Brak zdefiniowanych pojazdów."}`
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
      });
    }
    if (command.type === "przypisz_miesiac") {
  const { data, error } = await supabase
    .from("invoices")
    .update({ service_month: command.month })
    .or(buildInvoiceOrFilter(command.num))
    .select("invoice_number");

  if (error) {
    await sendWhatsAppMessage(from, `❌ Błąd: ${error.message}`);
  } else if (!data || data.length === 0) {
    await sendWhatsAppMessage(from, `📭 Nie znaleziono faktury: ${command.num}`);
  } else {
    await sendWhatsAppMessage(
      from,
      `✅ Przypisano fakturę ${data[0].invoice_number} do miesiąca rozliczenia: ${command.month}.`
    );
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

    if (command.type === "pojazd_dodaj") {
      const { error } = await supabase
        .from("vehicles")
        .upsert(
          {
            name: command.name,
            plate: command.plate,
            active: true,
          },
          {
            onConflict: "plate",
          }
        );

      if (error) {
        await sendWhatsAppMessage(
          from,
          `❌ Błąd dodawania pojazdu: ${error.message}`
        );
      } else {
        await sendWhatsAppMessage(
          from,
          `✅ Dodano pojazd: *${command.name.toUpperCase()} (${command.plate})*.`
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
      });
    }

    if (command.type === "przypisz_fakture") {
      const isShared = ["firma", "wspolne", "wspólne"].includes(
        normalizeVehicleKey(command.vehicle)
      );

      const vehicle = isShared
        ? null
        : await findVehicle(command.vehicle);

      if (!isShared && !vehicle) {
        await sendWhatsAppMessage(
          from,
          "❌ Nie znaleziono pojazdu. Wpisz *pojazdy*, aby zobaczyć dostępne auta."
        );

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
        });
      }

      const { data, error } = await supabase
        .from("invoices")
        .update({
          vehicle_id: vehicle?.id ?? null,
          allocation_type: isShared ? "shared" : "vehicle",
          updated_at: new Date().toISOString(),
        })
        .or(buildInvoiceOrFilter(command.num))
        .select("invoice_number, num");

      if (error) {
        await sendWhatsAppMessage(
          from,
          `❌ Błąd przypisywania faktury: ${error.message}`
        );
      } else if (!data || data.length === 0) {
        await sendWhatsAppMessage(
          from,
          `📭 Nie znaleziono faktury: *${command.num}*.`
        );
      } else {
        await sendWhatsAppMessage(
          from,
          `✅ Przypisano fakturę *${data[0].invoice_number || data[0].num}*.
🚛 Pojazd: *${vehicleLabel(
            vehicle,
            isShared ? "shared" : "vehicle"
          )}*`
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
      });
    }

    if (command.type === "przypisz_koszt") {
      const isShared = ["firma", "wspolne", "wspólne"].includes(
        normalizeVehicleKey(command.vehicle)
      );

      const vehicle = isShared
        ? null
        : await findVehicle(command.vehicle);

      if (!isShared && !vehicle) {
        await sendWhatsAppMessage(
          from,
          "❌ Nie znaleziono pojazdu. Wpisz *pojazdy*, aby zobaczyć dostępne auta."
        );

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
        });
      }

      const { data, error } = await supabase
        .from("expenses")
        .update({
          vehicle_id: vehicle?.id ?? null,
          allocation_type: isShared ? "shared" : "vehicle",
        })
        .eq("id", command.id)
        .select("id, category, amount");

      if (error) {
        await sendWhatsAppMessage(
          from,
          `❌ Błąd przypisywania kosztu: ${error.message}`
        );
      } else if (!data || data.length === 0) {
        await sendWhatsAppMessage(
          from,
          `📭 Nie znaleziono kosztu o ID *${command.id}*.`
        );
      } else {
        await sendWhatsAppMessage(
          from,
          `✅ Przypisano koszt *${data[0].category.toUpperCase()}* (${Number(
            data[0].amount
          ).toFixed(2)} PLN).
🚛 Pojazd: *${vehicleLabel(
            vehicle,
            isShared ? "shared" : "vehicle"
          )}*`
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
      });
    }


    if (command.type === "error") {
      await sendWhatsAppMessage(from, command.message);
      return new Response(JSON.stringify({ ok: true, handled: false, reason: command.message }), { status: 200 });
    }

    if (command.type === "pobierz") {
      let loadingText: string;
      let fetchParams: { from?: string; to?: string; daysBack?: number };

      if (command.mode === "today") {
        const todayStr = getTodayIsoInPoland();
        loadingText = `⏳ Łączę z KSeF. Pobieram faktury z dzisiejszego dnia (*${todayStr}*)...`;
        fetchParams = { from: todayStr, to: todayStr };
      } else if (command.mode === "range") {
        loadingText = `⏳ Łączę z KSeF. Pobieram faktury za zakres ${command.from} - ${command.to}...`;
        fetchParams = { from: command.from, to: command.to };
      } else {
        loadingText = `⏳ Łączę z KSeF. Pobieram faktury z ostatnich ${command.daysBack} dni...`;
        fetchParams = { daysBack: command.daysBack };
      }

      await sendWhatsAppMessage(from, loadingText);

      try {
        const rawInvoices = await fetchInvoicesFromBroker(fetchParams);

        const invoices = rawInvoices.filter((inv: any) =>
          inv &&
          inv.ksef_number &&
          inv.invoice_number &&
          inv.gross_amount != null
        );

        if (invoices.length === 0) {
          const emptyMsg = command.mode === "today"
            ? "✅ Brak nowych faktur w KSeF z dzisiejszego dnia."
            : "✅ Nie znaleziono kompletnych faktur w KSeF dla tego zakresu.";
          await sendWhatsAppMessage(from, emptyMsg);
          return new Response(JSON.stringify({ ok: true, handled: true, type: "pobierz", count: 0 }), { status: 200 });
        }
        const rules = await loadRules();

const { data: activeVehicles, error: vehiclesError } = await supabase
  .from("vehicles")
  .select("id, name, plate")
  .eq("active", true);

if (vehiclesError) {
  throw new Error(`Błąd pobierania pojazdów: ${vehiclesError.message}`);
}

const vehicleByKey = new Map<string, any>();

for (const vehicle of activeVehicles ?? []) {
  vehicleByKey.set(
    String(vehicle.name).trim().toLowerCase().replace(/[\s-]/g, ""),
    vehicle
  );
  vehicleByKey.set(
    String(vehicle.plate).trim().toLowerCase().replace(/[\s-]/g, ""),
    vehicle
  );
}

const xmlDatesMap = await getNewInvoicesXmlDates(invoices);

const { data: existingInvoicesWA } = await supabase
  .from("invoices")
  .select("ksef_number, paid, vehicle_id, allocation_type, order_number, exchange_rate, order_file_url, order_file_name")
  .in("ksef_number", invoices.map((i: any) => i.ksef_number).filter(Boolean));
const existingMapWA = new Map((existingInvoicesWA || []).map((e: any) => [e.ksef_number, e]));

const payloadToInsert = await Promise.all(
  invoices.map(async (inv: any) => {
    const nip = normalizeNip(inv.seller_nip);
    const vehicleRule = rules.get("vehicle_by_nip")?.get(nip);
    const vehicleKey = String(vehicleRule?.vehicle ?? "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]/g, "");

    const vehicle = vehicleByKey.get(vehicleKey) ?? null;

    const existing = existingMapWA.get(inv.ksef_number);
    const xmlInfo = xmlDatesMap[inv.ksef_number];
    const saleDate = (typeof xmlInfo === "object" && xmlInfo !== null)
      ? xmlInfo.saleDate
      : (typeof xmlInfo === "string" ? xmlInfo : (inv.sale_date || null));
    const ksefDueDate = (typeof xmlInfo === "object" && xmlInfo !== null)
      ? xmlInfo.dueDate
      : null;

    const rawOrderFromXml = (typeof xmlInfo === "object" && xmlInfo !== null) ? xmlInfo.orderNumber : null;
    const parsedOrderFromInv = parseOrderNumberFromText(String(inv.order_number || inv.notes || inv.uwagi || inv.description || inv.comments || ""));
    const ksefOrderNumber = (rawOrderFromXml ? (parseOrderNumberFromText(String(rawOrderFromXml)) || cleanOrderNumber(String(rawOrderFromXml))) : null) ||
                            parsedOrderFromInv ||
                            cleanOrderNumber(String(inv.order_number || "")) ||
                            existing?.order_number ||
                            null;

    const effectiveDate = saleDate || inv.issue_date || null;
    const serviceMonth = effectiveDate ? effectiveDate.slice(0, 7) : null;

    const invWithDueDate = {
      ...inv,
      due_date: ksefDueDate || inv.due_date || null,
    };

    const ksefExchangeRate = await resolveInvoiceExchangeRate(inv, xmlInfo);

    return {
      ksef_number: inv.ksef_number || null,
      num: inv.invoice_number || inv.ksef_number || null,
      invoice_number: inv.invoice_number || null,
      order_number: ksefOrderNumber || null,
      issue_date: inv.issue_date || null,
      service_month: serviceMonth,
      due_date: inferDueDate(invWithDueDate, rules),
      payment_days: inferPaymentDays(invWithDueDate, rules),
      gross_amount: inv.gross_amount ?? null,
      net_amount: inv.net_amount ?? null,
      currency: inv.currency || "PLN",
      exchange_rate: ksefExchangeRate ?? existing?.exchange_rate ?? null,
      seller_name: inv.seller_name || null,
      seller_nip: inv.seller_nip || null,
      buyer_nip: inv.buyer_nip || null,
      source: "ksef",
      ksef_status: "accepted",
      paid: existing?.paid ?? false,
      vehicle_id: existing?.vehicle_id ?? vehicle?.id ?? null,
      allocation_type: existing?.allocation_type ?? (vehicle ? "vehicle" : "unassigned"),
      order_file_url: existing?.order_file_url ?? null,
      order_file_name: existing?.order_file_name ?? null,
      updated_at: new Date().toISOString(),
    };
  })
);

        let { error } = await supabase
          .from("invoices")
          .upsert(payloadToInsert, { onConflict: "ksef_number", ignoreDuplicates: true });

        if (error && (error.message?.includes("exchange_rate") || (error as any).code === "42703")) {
          console.warn("[KSeF Sync WhatsApp] Kolumna exchange_rate nie istnieje w bazie - ponawiam zapis bez kolumny.");
          const safePayload = payloadToInsert.map(({ exchange_rate, ...rest }: any) => rest);
          const retry = await supabase
            .from("invoices")
            .upsert(safePayload, { onConflict: "ksef_number", ignoreDuplicates: true });
          error = retry.error;
        }

        if (error) throw new Error(error.message);

        // Uzupełnienie brakującego numeru zlecenia i kursu walut dla istniejących faktur
        const enrichmentPromisesWA = payloadToInsert.map(async (item: any) => {
          if (!item.ksef_number) return;
          const updates: Record<string, any> = {};
          if (item.order_number) updates.order_number = item.order_number;
          if (item.exchange_rate) updates.exchange_rate = item.exchange_rate;
          if (item.service_month) updates.service_month = item.service_month;
          if (item.due_date) updates.due_date = item.due_date;
          if (item.payment_days != null) updates.payment_days = item.payment_days;
          if (Object.keys(updates).length > 0) {
            let { error: updErr } = await supabase
              .from("invoices")
              .update(updates)
              .eq("ksef_number", item.ksef_number);
            if (updErr && (updErr.message?.includes("exchange_rate") || (updErr as any).code === "42703")) {
              delete updates.exchange_rate;
              if (Object.keys(updates).length > 0) {
                await supabase.from("invoices").update(updates).eq("ksef_number", item.ksef_number);
              }
            }
          }
        });
        await Promise.allSettled(enrichmentPromisesWA);

        await sendWhatsAppMessage(
          from,
          `✅ Pobrano i zapisano ${invoices.length} faktur z KSeF. Użyj "lista", "ostatnia", "pokaz NUM" albo kolejnego zakresu "pobierz YYYY-MM-DD YYYY-MM-DD".`
        );

        return new Response(JSON.stringify({ ok: true, handled: true, type: "pobierz", count: invoices.length }), {
          status: 200,
        });
      } catch (err) {
        await sendWhatsAppMessage(
          from,
          `❌ Wystąpił problem z pobieraniem: ${err instanceof Error ? err.message : "Nieznany błąd"}`
        );
        return new Response(JSON.stringify({ ok: false, handled: true, type: "pobierz_error" }), { status: 200 });
      }
    }
    if (command.type === "usun_wyjazd") {
  const { data, error } = await supabase
    .from("driver_trips") // Upewnij się, że tak nazywa się Twoja tabela z wyjazdami
    .delete()
    .eq("id", command.id)
    .select("id, description, days_count");

  if (error) {
    await sendWhatsAppMessage(from, `❌ Błąd usuwania: ${error.message}`);
  } else if (!data || data.length === 0) {
    await sendWhatsAppMessage(from, `ℹ️ Nie znaleziono wyjazdu o ID *#${command.id}*.`);
  } else {
    const desc = data[0]?.description ? ` (${data[0].description})` : "";
    const days = data[0]?.days_count ? ` [${data[0].days_count} dni]` : "";
    await sendWhatsAppMessage(from, `🗑 *Usunięto wyjazd #${command.id}*${desc}${days}! Wynik finansowy został skorygowany.`);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

        // ==========================================
    // LOGIKA: USUNIĘCIE WYJAZDU (usun_wyjazd ID)
    // =========================================


    if (command.type === "dodaj") {
      const { error } = await supabase.from("invoices").insert({
        num: command.num,
        invoice_number: command.num,
        issue_date: command.issue_date,
        payment_days: command.payment_days,
        due_date: command.due_date,
        ksef_status: "draft",
        source: "manual",
        paid: false,
      });

      if (error) {
        await sendWhatsAppMessage(from, `Błąd dodawania faktury: ${error.message}`);
      } else {
        await sendWhatsAppMessage(from, `Dodano fakturę ${command.num} z terminem płatności ${command.due_date}`);
      }

      return new Response(JSON.stringify({ ok: true, handled: true, type: "dodaj" }), { status: 200 });
    }
        // ==========================================
    // LOGIKA: DODAWANIE KOSZTU
    // ==========================================
    if (command.type === "koszt") {
      const { error } = await supabase
        .from("expenses")
        .insert({
           category: command.category,
           amount: command.amount,
           expense_month: command.month
        });

      if (error) {
        await sendWhatsAppMessage(from, `❌ Błąd dodawania kosztu: ${error.message}`);
      } else {
        await sendWhatsAppMessage(from, `✅ Dodano koszt: *${command.category}* na kwotę *${command.amount} PLN* (Miesiąc: ${command.month})`);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
        // ==========================================
    // LOGIKA: WYŚWIETLANIE LISTY KOSZTÓW
    // ==========================================
    if (command.type === "koszty_lista") {
      const { data, error } = await supabase
        .from("expenses")
        .select("id, category, amount, created_at")
        .eq("expense_month", command.month)
        .order("created_at", { ascending: true });

      if (error) {
        await sendWhatsAppMessage(from, `❌ Błąd: ${error.message}`);
      } else if (!data || data.length === 0) {
        await sendWhatsAppMessage(from, `📭 Nie wprowadzono jeszcze żadnych kosztów w miesiącu: *${command.month}*`);
      } else {
        const lines = data.map(item => {
          return `*ID: ${item.id}* | ${item.category.toUpperCase()} | *${item.amount} PLN*`;
        });
        await sendWhatsAppMessage(from, `*📄 Wprowadzone koszty (${command.month}):*\n\n${lines.join("\n")}\n\n💡 _Aby usunąć wydatek, wpisz np. *usun_koszt ${data[0].id}*_`);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // ==========================================
    // LOGIKA: USUWANIE KOSZTU
    // ==========================================
    if (command.type === "usun_koszt") {
      // Sprawdzamy najpierw czy taki koszt istnieje (żeby podać w powiadomieniu kwotę, jaką usunęliśmy)
      const { data: findData } = await supabase.from("expenses").select("*").eq("id", command.id).single();
      
      if (!findData) {
         await sendWhatsAppMessage(from, `📭 Nie znaleziono kosztu o ID *${command.id}*. Sprawdź numer wpisując komendę np. _koszty lipiec_`);
         return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const { error } = await supabase.from("expenses").delete().eq("id", command.id);

      if (error) {
         await sendWhatsAppMessage(from, `❌ Błąd usuwania: ${error.message}`);
      } else {
         await sendWhatsAppMessage(from, `✅ Pomyślnie usunięto koszt: *${findData.category.toUpperCase()}* na kwotę *${findData.amount} PLN*.`);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
        // ==========================================
    // LOGIKA: DEFINIOWANIE STAWKI KIEROWCY
    // ==========================================
    if (command.type === "kierowca_ustaw") {
      const { error } = await supabase
        .from("drivers")
        .upsert({
          name: command.name,
          base_salary: command.baseSalary,
          daily_rate: command.dailyRate,
          active: true
        }, { onConflict: "name" });

      if (error) {
        await sendWhatsAppMessage(from, `❌ Błąd: ${error.message}`);
      } else {
        await sendWhatsAppMessage(from, `✅ Zapisano kierowcę *${command.name}*:\n💵 Podstawa: *${command.baseSalary} PLN*\n📅 Dniówka: *${command.dailyRate} PLN/dzień*`);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (command.type === "cofnij_e100") {
      const { data, error } = await supabase
        .from("expenses")
        .delete()
        .eq("expense_month", command.month)
        .ilike("description", "E100%")
        .select("id, category, amount");

      const { error: e100DelError } = await supabase
        .from("e100_transactions")
        .delete()
        .eq("expense_month", command.month);

      if (e100DelError) {
        console.error("Błąd usuwania e100_transactions:", e100DelError.message);
      }

      if (error) {
        await sendWhatsAppMessage(from, `❌ Błąd usuwania: ${error.message}`);
      } else if (!data || data.length === 0) {
        await sendWhatsAppMessage(from, `ℹ️ Nie znaleziono żadnych wpisów z E100 w miesiącu *${command.month}*.`);
      } else {
        const totalDeleted = data.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        await sendWhatsAppMessage(from, `🗑 *Pomyślnie cofnięto import E100 (${command.month})!*
Usunięto *${data.length}* pozycje na łączną kwotę *${totalDeleted.toFixed(2)} PLN*.`);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (command.type === "e100_lista") {
      let query = supabase
        .from("e100_transactions")
        .select("*")
        .eq("expense_month", command.month)
        .order("id", { ascending: true });

      let vehicleFilterName = "";
      if (command.vehicle) {
        const v = await findVehicle(command.vehicle);
        if (v) {
          const plateClean = String(v.plate ?? "").replace(/[\s-]/g, "");
          const plateWithSpaces = String(v.plate ?? "").trim();
          const vehicleName = String(v.name ?? "").trim();
          query = query.or(
            `vehicle_id.eq.${v.id},truck_plate.ilike.%${plateWithSpaces}%,truck_plate.ilike.%${plateClean}%,truck_plate.ilike.%${vehicleName}%`
          );
          vehicleFilterName = ` (${v.name.toUpperCase()} / ${v.plate})`;
        } else {
          const cleanSearch = String(command.vehicle).trim();
          query = query.ilike("truck_plate", `%${cleanSearch}%`);
          vehicleFilterName = ` (${command.vehicle})`;
        }
      }

      const { data, error } = await query;

      if (error) {
        await sendWhatsAppMessage(
          from,
          `❌ Błąd pobierania transakcji E100: ${error.message}\n\n💡 _Upewnij się, że tabela e100_transactions została utworzona w Supabase._`
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (!data || data.length === 0) {
        await sendWhatsAppMessage(
          from,
          `📭 Nie znaleziono transakcji E100 dla miesiąca *${command.month}*${vehicleFilterName}.\n\n💡 _Transakcje zapisują się automatycznie przy imporcie raportu .xlsx._`
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const totalNetPln = data.reduce((sum: number, item: any) => sum + Number(item.net_amount_pln || 0), 0);
      const totalFuelLiters = data.reduce((sum: number, item: any) => sum + (Number(item.qty) || 0), 0);

      const periods = Array.from(new Set((data || []).map((t: any) => String(t.report_period || "").trim()).filter(Boolean)));
      const periodInfo = periods.length > 0 ? `📅 Okres E100: *${periods.join(", ")}*\n` : "";

      const lines = data.slice(0, 30).map((t: any) => {
        const qtyStr = Number(t.qty) > 0 ? ` | ${Number(t.qty).toFixed(1)}L` : "";
        const netStr = t.net_amount_pln ? ` (~${Number(t.net_amount_pln).toFixed(2)} zł)` : "";
        return `• *${t.transaction_date}* | ${t.service} (${t.country}) | *${t.gross_amount} ${t.currency}*${qtyStr}${netStr}`;
      });

      const truncatedNote = data.length > 30
        ? `\n\nℹ️ _Pokazano pierwsze 30 z ${data.length} transakcji._`
        : "";

      const litersInfo = totalFuelLiters > 0 ? `⛽ Paliwo: *${totalFuelLiters.toFixed(1)} L*\n` : "";

      const msg = `📋 *Transakcje E100 (${command.month})*${vehicleFilterName}:
${periodInfo}${litersInfo}💰 Łącznie: *${totalNetPln.toFixed(2)} PLN netto*
🔢 Pozycji: *${data.length}*

${lines.join("\n")}${truncatedNote}`;

      await sendWhatsAppMessage(from, msg);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }



    // ==========================================
    // LOGIKA: WYJAZD W TRASĘ
    // ==========================================
    if (command.type === "wyjazd") {
      // Sprawdź czy kierowca nie ma już otwartej trasy
      const { data: activeTrip } = await supabase
        .from("driver_trips")
        .select("id, start_date")
        .ilike("driver_name", command.name)
        .is("end_date", null)
        .maybeSingle();

      if (activeTrip) {
        await sendWhatsAppMessage(from, `⚠️ Kierowca *${command.name}* ma już aktywną trasę od ${activeTrip.start_date}! Najpierw wpisz: *zjazd ${command.name}*.`);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const { error } = await supabase.from("driver_trips").insert({
        driver_name: command.name,
        start_date: command.date,
        description: command.description || null
      });

      if (error) {
        await sendWhatsAppMessage(from, `❌ Błąd: ${error.message}`);
      } else {
        const desc = command.description ? ` (${command.description})` : "";
        await sendWhatsAppMessage(from, `🚛 Zarejestrowano wyjazd:\n👤 Kierowca: *${command.name}*\n📅 Data: *${command.date}*${desc}\n\n_Po powrocie wpisz: zjazd ${command.name}_`);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // ==========================================
    // LOGIKA: ZJAZD Z TRASY
    // ==========================================
    if (command.type === "zjazd") {
      const { data: trip } = await supabase
        .from("driver_trips")
        .select("*")
        .ilike("driver_name", command.name)
        .is("end_date", null)
        .order("start_date", { ascending: false })
        .maybeSingle();

      if (!trip) {
        await sendWhatsAppMessage(from, `⚠️ Kierowca *${command.name}* nie ma otwartej trasy. Użyj: *trasa ${command.name} [start] [koniec] [opis]*.`);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const startMs = new Date(trip.start_date).getTime();
      const endMs = new Date(command.date).getTime();
      const daysCount = Math.max(1, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1);

      // Pobierz stawkę dzienną
      const { data: driver } = await supabase
        .from("drivers")
        .select("daily_rate")
        .ilike("name", command.name)
        .maybeSingle();

      const rate = driver ? Number(driver.daily_rate) : 0;
      const totalRate = daysCount * rate;

      await supabase
        .from("driver_trips")
        .update({
          end_date: command.date,
          days_count: daysCount
        })
        .eq("id", trip.id);

      await sendWhatsAppMessage(from, `🏁 Zakończono trasę:\n👤 Kierowca: *${command.name}*\n📅 Okres: *${trip.start_date}* ➔ *${command.date}*\n⏱ Liczba dni: *${daysCount}*\n💰 Kwota za trasę: *${totalRate.toFixed(2)} PLN* (${daysCount} x ${rate} zł)`);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // ==========================================
    // LOGIKA: TRASA WPISANA WSTECZNIE
    // ==========================================
    if (command.type === "trasa_reczna") {
      const startMs = new Date(command.startDate).getTime();
      const endMs = new Date(command.endDate).getTime();
      const daysCount = Math.max(1, Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1);

      const { error } = await supabase.from("driver_trips").insert({
        driver_name: command.name,
        start_date: command.startDate,
        end_date: command.endDate,
        days_count: daysCount,
        description: command.description || null
      });

      if (error) {
        await sendWhatsAppMessage(from, `❌ Błąd: ${error.message}`);
      } else {
        await sendWhatsAppMessage(from, `✅ Dodano trasę archiwalną:\n👤 Kierowca: *${command.name}*\n📅 *${command.startDate}* ➔ *${command.endDate}* (*${daysCount} dni*)`);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    // ==========================================
    // LOGIKA: WYLICZENIE MIESIĘCZNEGO WYNAGRODZENIA
    // ==========================================
    if (command.type === "wyplata") {
      const [year, monthNum] = command.month.split("-").map(Number);
      const startOfMonth = `${command.month}-01`;
      const endOfMonthObj = new Date(year, monthNum, 0);
      const endOfMonth = endOfMonthObj.toISOString().split("T")[0];

      // 1. Pobierz kierowcę i stawki
      const { data: driver } = await supabase
        .from("drivers")
        .select("*")
        .ilike("name", command.name)
        .maybeSingle();

      if (!driver) {
        await sendWhatsAppMessage(from, `❌ Nie znaleziono kierowcy *${command.name}*. Dodaj go wpisując np.:\n*kierowca ${command.name} 4000 450*`);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      // 2. Pobierz wszystkie trasy, które choć częściowo zahaczyły o ten miesiąc
      const { data: trips, error: tripsErr } = await supabase
        .from("driver_trips")
        .select("*")
        .ilike("driver_name", command.name)
        .lte("start_date", endOfMonth)
        .or(`end_date.gte.${startOfMonth},end_date.is.null`);

      if (tripsErr) {
        await sendWhatsAppMessage(from, `❌ Błąd pobierania tras: ${tripsErr.message}`);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      let totalDaysInMonth = 0;
      let tripsSummary = "";

      (trips || []).forEach(t => {
        const tripStart = t.start_date;
        const tripEnd = t.end_date || endOfMonth; // Jeśli trasa trwa, liczymy do końca badanego miesiąca

        // Określamy część wspólną trasy z badanym miesiącem
        const effectiveStart = tripStart < startOfMonth ? startOfMonth : tripStart;
        const effectiveEnd = tripEnd > endOfMonth ? endOfMonth : tripEnd;

        const sMs = new Date(effectiveStart).getTime();
        const eMs = new Date(effectiveEnd).getTime();
        const daysInThisMonth = Math.max(1, Math.round((eMs - sMs) / (1000 * 60 * 60 * 24)) + 1);

        totalDaysInMonth += daysInThisMonth;
        const note = t.description ? ` (${t.description})` : "";
        tripsSummary += `• ${tripStart} ➔ ${t.end_date || "w trasie"} : *${daysInThisMonth} dni* w tym m-cu${note}\n`;
      });

      const baseSalary = Number(driver.base_salary) || 0;
      const dailyRate = Number(driver.daily_rate) || 0;
      const totalDailyPay = totalDaysInMonth * dailyRate;
      const totalPayout = baseSalary + totalDailyPay;

      const message = `👨‍✈️ *ROZLICZENIE: ${command.name.toUpperCase()} (${command.month})*

💼 *Podstawa:* ${baseSalary.toFixed(2)} PLN
📅 *Dni w trasie:* ${totalDaysInMonth} dni x ${dailyRate} PLN = *${totalDailyPay.toFixed(2)} PLN*

🛣 *Zrealizowane trasy:*
${tripsSummary || "Brak zarejestrowanych tras w tym miesiącu.\n"}
━━━━━━━━━━━━━━━
💰 *DO WYPŁATY:* *${totalPayout.toFixed(2)} PLN*

💡 _Aby zapisać to jako koszt firmy do podsumowania zysku, wpisz:_
*koszt kierowca ${totalPayout.toFixed(0)} ${command.month} Wypłata ${command.name}*`;

      await sendWhatsAppMessage(from, message);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (command.type === "podsumowanie") {
  const targetMonth = command.month; // np. "2026-09"
  const [year, month] = targetMonth.split("-").map(Number);
  const startOfMonth = `${targetMonth}-01`;
  const endOfMonth = new Date(year, month, 0).toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("invoices")
    .select("gross_amount, net_amount, currency, paid, issue_date, service_month")
    .or(
      `service_month.eq.${targetMonth},` +
      `and(service_month.is.null,issue_date.gte.${startOfMonth},issue_date.lte.${endOfMonth})`
    );
  if (error) {
    await sendWhatsAppMessage(from, `❌ Błąd: ${error.message}`);
  } else if (!data || data.length === 0) {
    await sendWhatsAppMessage(from, `📊 Brak pobranych faktur za miesiąc *${command.month}*.`);
  } else {
    // POPRAWKA: kurs NBP liczony wg daty wystawienia każdej faktury (nie "na dziś"),
    // więc wynik za dany miesiąc nie zmienia się w zależności od tego, kiedy sprawdzasz.
    const ratesMap = await buildRatesMapForDates(data.map((item) => item.issue_date));

    let totalGross = 0;
    let totalNet = 0;
    let paidGross = 0;
    let unpaidGross = 0;
    let usedForeign = false;

    data.forEach(item => {
      let gross = Number(item.gross_amount) || 0;
      let net = Number(item.net_amount) || 0;
      const cur = (item.currency || "PLN").toUpperCase();
      const rate = rateFor(ratesMap, item.issue_date, cur);

      if (cur !== "PLN") {
        gross = gross * rate;
        net = net * rate;
        usedForeign = true;
      }

      totalGross += gross;
      totalNet += net;

      if (item.paid) paidGross += gross;
      else unpaidGross += gross;
    });

    const extraInfo = usedForeign
      ? `\n\nℹ️ _Faktury w obcych walutach przeliczono po kursie NBP z dnia wystawienia każdej faktury._`
      : "";

    await sendWhatsAppMessage(from, `*📊 Podsumowanie miesiąca: ${command.month}*

🧾 Liczba faktur: *${data.length}*
💰 Razem netto: *${totalNet.toFixed(2)} PLN*
💰 Razem brutto: *${totalGross.toFixed(2)} PLN*

✅ Opłacone (brutto): *${paidGross.toFixed(2)} PLN*
⏳ Pozostało do zapłaty (brutto): *${unpaidGross.toFixed(2)} PLN*${extraInfo}`);
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
if (command.type === "wynik_pojazdu") {
  const vehicle = await findVehicle(command.vehicle);

  if (!vehicle) {
    await sendWhatsAppMessage(
      from,
      `❌ Nie znaleziono pojazdu: *${command.vehicle}*.

Wpisz *pojazdy*, aby zobaczyć dostępne auta.`
    );

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  const targetMonth = command.month; // np. "2026-09"
const [year, month] = targetMonth.split("-").map(Number);
const startOfMonth = `${targetMonth}-01`;
const endOfMonth = new Date(year, month, 0).toISOString().split("T")[0]; // ✅ ostatni dzień miesiąca
const { data: invoices, error: invoicesError } = await supabase
  .from("invoices")
  .select("net_amount, currency, issue_date, service_month")
  .eq("vehicle_id", vehicle.id)
  .eq("allocation_type", "vehicle")
  .or(
    `service_month.eq.${targetMonth},` +
    `and(service_month.is.null,issue_date.gte.${startOfMonth},issue_date.lte.${endOfMonth})`
  );

  if (invoicesError) {
    await sendWhatsAppMessage(
      from,
      `❌ Błąd pobierania faktur pojazdu: ${invoicesError.message}`
    );

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const { data: expenses, error: expensesError } = await supabase
    .from("expenses")
    .select("category, amount")
    .eq("vehicle_id", vehicle.id)
    .eq("allocation_type", "vehicle")
    .eq("expense_month", command.month);

  if (expensesError) {
    await sendWhatsAppMessage(
      from,
      `❌ Błąd pobierania kosztów pojazdu: ${expensesError.message}`
    );

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // POPRAWKA: kurs NBP wg daty wystawienia faktury, nie "na dziś".
  const ratesMap = await buildRatesMapForDates((invoices || []).map((inv) => inv.issue_date));

  let revenue = 0;
  let usedForeignCurrency = false;

  for (const invoice of invoices || []) {
    const currency = String(invoice.currency || "PLN").toUpperCase();
    const rate = rateFor(ratesMap, invoice.issue_date, currency);

    revenue += Number(invoice.net_amount || 0) * rate;

    if (currency !== "PLN") {
      usedForeignCurrency = true;
    }
  }

  let expensesTotal = 0;
  const expensesByCategory: Record<string, number> = {};

  for (const expense of expenses || []) {
    const amount = Number(expense.amount || 0);
    const category = String(expense.category || "inne").toUpperCase();

    expensesTotal += amount;
    expensesByCategory[category] =
      (expensesByCategory[category] || 0) + amount;
  }

  const profit = revenue - expensesTotal;
  const profitEmoji = profit >= 0 ? "🤑" : "🥵";

  const expensesList = Object.entries(expensesByCategory)
    .map(
      ([category, amount]) =>
        `🔸 *${category}:* -${amount.toFixed(2)} PLN`
    )
    .join("");

  const currencyNote = usedForeignCurrency
    ? `

ℹ️ _Faktury w obcych walutach przeliczono po kursie NBP z dnia wystawienia faktury._`
    : "";

  await sendWhatsAppMessage(
    from,
    `🚛 *WYNIK POJAZDU: ${String(vehicle.name).toUpperCase()} (${vehicle.plate})*
📅 Miesiąc: *${command.month}*

📈 *PRZYCHODY NETTO:* ${revenue.toFixed(2)} PLN
🧾 Liczba faktur: *${(invoices || []).length}*

📉 *KOSZTY RAZEM:* -${expensesTotal.toFixed(2)} PLN
${expensesList || "Brak kosztów przypisanych do tego pojazdu."}

━━━━━━━━━━━━━━━
${profitEmoji} *WYNIK NETTO:* *${profit.toFixed(2)} PLN*${currencyNote}`
  );

  return new Response(
    JSON.stringify({ ok: true, handled: true, type: "wynik_pojazdu" }),
    { status: 200 }
  );
}

if (command.type === "podsumowanie_pojazdu") {
  const vehicle = await findVehicle(command.vehicle);

  if (!vehicle) {
    await sendWhatsAppMessage(
      from,
      `❌ Nie znaleziono pojazdu: *${command.vehicle}*.

Wpisz *pojazdy*, aby zobaczyć dostępne auta.`
    );

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  const targetMonth = command.month; // np. "2026-09"
const [year, month] = targetMonth.split("-").map(Number);
const startOfMonth = `${targetMonth}-01`;
const endOfMonth = new Date(year, month, 0).toISOString().split("T")[0]; // ✅ ostatni dzień miesiąca

const { data: invoices, error } = await supabase
  .from("invoices")
  .select("invoice_number, net_amount, gross_amount, currency, paid, issue_date, service_month")
  .eq("vehicle_id", vehicle.id)
  .eq("allocation_type", "vehicle")
  .or(
    `service_month.eq.${targetMonth},` +
    `and(service_month.is.null,issue_date.gte.${startOfMonth},issue_date.lte.${endOfMonth})`
  );

  if (error) {
    await sendWhatsAppMessage(
      from,
      `❌ Błąd pobierania faktur pojazdu: ${error.message}`
    );

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // POPRAWKA: kurs NBP wg daty wystawienia faktury, nie "na dziś".
  const ratesMap = await buildRatesMapForDates((invoices || []).map((inv) => inv.issue_date));

  let netTotal = 0;
  let grossTotal = 0;
  let paidGrossTotal = 0;
  let unpaidGrossTotal = 0;
  let usedForeignCurrency = false;

  for (const invoice of invoices || []) {
    const currency = String(invoice.currency || "PLN").toUpperCase();
    const rate = rateFor(ratesMap, invoice.issue_date, currency);

    const net = Number(invoice.net_amount || 0) * rate;
    const gross = Number(invoice.gross_amount || 0) * rate;

    netTotal += net;
    grossTotal += gross;

    if (invoice.paid) {
      paidGrossTotal += gross;
    } else {
      unpaidGrossTotal += gross;
    }

    if (currency !== "PLN") {
      usedForeignCurrency = true;
    }
  }

  const currencyNote = usedForeignCurrency
    ? `

ℹ️ _Faktury w obcych walutach przeliczono po kursie NBP z dnia wystawienia faktury._`
    : "";

  await sendWhatsAppMessage(
    from,
    `🚛 *PODSUMOWANIE: ${String(vehicle.name).toUpperCase()} (${vehicle.plate})*
📅 Miesiąc: *${command.month}*

🧾 Liczba faktur: *${(invoices || []).length}*
💰 Razem netto: *${netTotal.toFixed(2)} PLN*
💰 Razem brutto: *${grossTotal.toFixed(2)} PLN*

✅ Opłacone brutto: *${paidGrossTotal.toFixed(2)} PLN*
⏳ Pozostało do zapłaty brutto: *${unpaidGrossTotal.toFixed(2)} PLN*${currencyNote}`
  );

  return new Response(
    JSON.stringify({
      ok: true,
      handled: true,
      type: "podsumowanie_pojazdu"
    }),
    { status: 200 }
  );
}
// ==========================================
// LOGIKA: PORÓWNANIE POJAZDÓW
// Komenda: porownanie [miesiąc]
// np. porownanie wrzesien
// ==========================================
if (command.type === "nieprzypisane") {
  const { count: invoicesCount } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .is("vehicle_id", null)
    .or("allocation_type.is.null,allocation_type.eq.unassigned");

  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("invoice_number, ksef_number, issue_date, seller_name, gross_amount, currency")
    .is("vehicle_id", null)
    .or("allocation_type.is.null,allocation_type.eq.unassigned")
    .order("issue_date", { ascending: false })
    .limit(15);

  const { count: expensesCount } = await supabase
    .from("expenses")
    .select("*", { count: "exact", head: true })
    .is("vehicle_id", null)
    .or("allocation_type.is.null,allocation_type.eq.unassigned");

  if (error) {
    await sendWhatsAppMessage(from, `❌ Błąd pobierania listy: ${error.message}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (!invoices || invoices.length === 0) {
    await sendWhatsAppMessage(
      from,
      `✅ Wszystkie faktury są przypisane do pojazdu lub oznaczone jako wspólne.\n\n${
        expensesCount && expensesCount > 0
          ? `ℹ️ Masz jednak *${expensesCount}* nieprzypisanych kosztów. Sprawdź je przez *koszty [miesiąc]* i przypisz *przypisz_koszt ID POJAZD*.`
          : ""
      }`
    );
    return new Response(JSON.stringify({ ok: true, handled: true, type: "nieprzypisane" }), { status: 200 });
  }

  const lines = invoices.map((item, index) => {
    const gross = item.gross_amount !== null ? `${item.gross_amount} ${item.currency || "PLN"}` : "brak kwoty";
    return `*${index + 1}. FV: ${item.invoice_number || item.ksef_number || "Brak"}*\n🏢 ${item.seller_name || "brak"}\n💰 ${gross}\n📅 ${item.issue_date || "brak daty"}`;
  });

  const footer =
    invoicesCount && invoicesCount > invoices.length
      ? `\n\nℹ️ _Pokazano ${invoices.length} z ${invoicesCount} nieprzypisanych faktur (najnowsze). Doprecyzuj przez lista/szukaj, żeby znaleźć starsze._`
      : "";

  const expensesNote =
    expensesCount && expensesCount > 0
      ? `\n\n⚠️ *Masz też ${expensesCount} nieprzypisanych kosztów.* Sprawdź *koszty [miesiąc]* i przypisz *przypisz_koszt ID POJAZD*.`
      : "";

  await sendWhatsAppMessage(
    from,
    `*🚫 NIEPRZYPISANE FAKTURY (${invoicesCount ?? invoices.length}):*\n\n${lines.join("\n\n")}${footer}${expensesNote}\n\n💡 _Aby przypisać, wpisz:_ *przypisz NUMER_FV POJAZD*`
  );

  return new Response(JSON.stringify({ ok: true, handled: true, type: "nieprzypisane" }), { status: 200 });
}

if (command.type === "wyjazdy") {
  const { data: trips, error } = await supabase
    .from("driver_trips")
    .select("id, start_date, end_date, days_count, description")
    .ilike("driver_name", command.name)
    .order("start_date", { ascending: false })
    .limit(20);

  if (error) {
    await sendWhatsAppMessage(from, `❌ Błąd pobierania wyjazdów: ${error.message}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (!trips || trips.length === 0) {
    await sendWhatsAppMessage(from, `📭 Brak zarejestrowanych wyjazdów dla kierowcy *${command.name}*.`);
    return new Response(JSON.stringify({ ok: true, handled: true, type: "wyjazdy" }), { status: 200 });
  }

  const lines = trips.map((t) => {
    const status = t.end_date ? `➔ ${t.end_date}` : "🟢 w trasie (bez zjazdu)";
    const desc = t.description ? ` (${t.description})` : "";
    const days = t.days_count ? ` | ${t.days_count} dni` : "";
    return `*ID: ${t.id}* | ${t.start_date} ${status}${days}${desc}`;
  });

  await sendWhatsAppMessage(
    from,
    `*🛣 WYJAZDY: ${command.name.toUpperCase()}*\n\n${lines.join("\n")}\n\n💡 _Aby usunąć wyjazd, wpisz np.:_ *usun_wyjazd ${trips[0].id}*`
  );

  return new Response(JSON.stringify({ ok: true, handled: true, type: "wyjazdy" }), { status: 200 });
}

if (command.type === "porownanie") {
  const targetMonth = command.month; // np. "2026-09"
const [year, month] = targetMonth.split("-").map(Number);
const startOfMonth = `${targetMonth}-01`;
const endOfMonth = new Date(year, month, 0).toISOString().split("T")[0]; // ✅ ostatni dzień miesiąca

  const { data: vehicles, error: vehiclesError } = await supabase
    .from("vehicles")
    .select("id, name, plate")
    .eq("active", true)
    .order("name", { ascending: true });

  if (vehiclesError) {
    await sendWhatsAppMessage(
      from,
      `❌ Błąd pobierania pojazdów: ${vehiclesError.message}`
    );

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (!vehicles || vehicles.length === 0) {
    await sendWhatsAppMessage(
      from,
      "📭 Brak aktywnych pojazdów do porównania."
    );

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const vehicleIds = vehicles.map(vehicle => vehicle.id);

  const { data: invoices, error: invoicesError } = await supabase
    .from("invoices")
    .select("vehicle_id, net_amount, currency, issue_date, service_month")
    .in("vehicle_id", vehicleIds)
    .eq("allocation_type", "vehicle")
    .or(
      `service_month.eq.${targetMonth},` +
      `and(service_month.is.null,issue_date.gte.${startOfMonth},issue_date.lte.${endOfMonth})`
    );

  if (invoicesError) {
    await sendWhatsAppMessage(
      from,
      `❌ Błąd pobierania faktur: ${invoicesError.message}`
    );
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const { data: expenses, error: expensesError } = await supabase
    .from("expenses")
    .select("vehicle_id, amount")
    .in("vehicle_id", vehicleIds)
    .eq("allocation_type", "vehicle")
    .eq("expense_month", command.month);

  if (expensesError) {
    await sendWhatsAppMessage(
      from,
      `❌ Błąd pobierania kosztów: ${expensesError.message}`
    );

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // POPRAWKA: kurs NBP wg daty wystawienia faktury, nie "na dziś".
  const ratesMap = await buildRatesMapForDates((invoices || []).map((inv) => inv.issue_date));

  const revenueByVehicle: Record<number, number> = {};
  const invoiceCountByVehicle: Record<number, number> = {};
  const expensesByVehicle: Record<number, number> = {};

  for (const vehicle of vehicles) {
    revenueByVehicle[vehicle.id] = 0;
    invoiceCountByVehicle[vehicle.id] = 0;
    expensesByVehicle[vehicle.id] = 0;
  }

  for (const invoice of invoices || []) {
    if (!invoice.vehicle_id) continue;

    const currency = String(invoice.currency || "PLN").toUpperCase();
    const rate = rateFor(ratesMap, invoice.issue_date, currency);
    const vehicleId = Number(invoice.vehicle_id);

    revenueByVehicle[vehicleId] =
      (revenueByVehicle[vehicleId] || 0) +
      Number(invoice.net_amount || 0) * rate;

    invoiceCountByVehicle[vehicleId] =
      (invoiceCountByVehicle[vehicleId] || 0) + 1;
  }

  for (const expense of expenses || []) {
    if (!expense.vehicle_id) continue;

    const vehicleId = Number(expense.vehicle_id);

    expensesByVehicle[vehicleId] =
      (expensesByVehicle[vehicleId] || 0) +
      Number(expense.amount || 0);
  }

  const comparison = vehicles
    .map(vehicle => {
      const revenue = revenueByVehicle[vehicle.id] || 0;
      const costs = expensesByVehicle[vehicle.id] || 0;
      const profit = revenue - costs;
      const invoicesCount = invoiceCountByVehicle[vehicle.id] || 0;

      return {
        name: String(vehicle.name).toUpperCase(),
        plate: vehicle.plate,
        revenue,
        costs,
        profit,
        invoicesCount
      };
    })
    .sort((a, b) => b.profit - a.profit);

  const lines = comparison
    .map((item, index) => {
      const emoji = item.profit >= 0 ? "🟢" : "🔴";

      return `${index + 1}. ${emoji} *${item.name} (${item.plate})*
🧾 Faktury: ${item.invoicesCount}
📈 Przychód netto: ${item.revenue.toFixed(2)} PLN
📉 Koszty: -${item.costs.toFixed(2)} PLN
💰 Wynik netto: *${item.profit.toFixed(2)} PLN*`;
    })
    .join("");

  const companyRevenue = comparison.reduce(
    (sum, item) => sum + item.revenue,
    0
  );

  const companyCosts = comparison.reduce(
    (sum, item) => sum + item.costs,
    0
  );

  const companyProfit = companyRevenue - companyCosts;

  await sendWhatsAppMessage(
    from,
    `🚛 *PORÓWNANIE POJAZDÓW*
📅 Miesiąc: *${command.month}*

${lines}

━━━━━━━━━━━━━━━
🏢 *SUMA POJAZDÓW*
📈 Przychody netto: ${companyRevenue.toFixed(2)} PLN
📉 Koszty: -${companyCosts.toFixed(2)} PLN
💰 Wynik netto: *${companyProfit.toFixed(2)} PLN*

ℹ️ _Porównanie obejmuje tylko faktury i koszty przypisane bezpośrednio do pojazdów. Dokumenty wspólne dla firmy nie są doliczane._`
  );

  return new Response(
    JSON.stringify({
      ok: true,
      handled: true,
      type: "porownanie"
    }),
    { status: 200 }
  );
}
    // ==========================================
    // LOGIKA: WYLICZANIE DOCHODU (WYNIK)
    // ==========================================
    if (command.type === "wynik") {
      const targetMonth = command.month; // np. "2026-09"
const [year, month] = targetMonth.split("-").map(Number);
const startOfMonth = `${targetMonth}-01`;
const endOfMonth = new Date(year, month, 0).toISOString().split("T")[0];

const { data: invoices, error: invError } = await supabase
  .from("invoices")
  .select("net_amount, currency, issue_date, service_month")
  .or(
    `service_month.eq.${targetMonth},` +
    `and(service_month.is.null,issue_date.gte.${startOfMonth},issue_date.lte.${endOfMonth})`
  );
  if (invError) {
    await sendWhatsAppMessage(from, `❌ Błąd pobierania faktur: ${invError.message}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // POPRAWKA: kurs NBP wg daty wystawienia każdej faktury, nie "na dziś".
  const ratesMap = await buildRatesMapForDates((invoices || []).map((inv) => inv.issue_date));

  let totalRevenue = 0;
  let usedForeign = false;

  (invoices || []).forEach(inv => {
    const net = Number(inv.net_amount) || 0;
    const cur = (inv.currency || "PLN").toUpperCase();
    const rate = rateFor(ratesMap, inv.issue_date, cur);

    if (cur !== "PLN") usedForeign = true;

    totalRevenue += (net * rate);
  });

  const { data: expenses, error: expError } = await supabase
    .from("expenses")
    .select("category, amount")
    .eq("expense_month", command.month);

  if (expError) {
    await sendWhatsAppMessage(from, `❌ Błąd pobierania wydatków: ${expError.message}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  let totalExpenses = 0;
  let categories: Record<string, number> = {};

  (expenses || []).forEach(exp => {
    const amt = Number(exp.amount) || 0;
    totalExpenses += amt;
    const cat = (exp.category || "inne").toUpperCase();
    categories[cat] = (categories[cat] || 0) + amt;
  });

  const profit = totalRevenue - totalExpenses;
  const emoji = profit >= 0 ? "🤑" : "🥵";

  let expensesList = "";
  for (const [cat, amt] of Object.entries(categories)) {
    expensesList += `🔸 *${cat}:* -${amt.toFixed(2)} PLN\n`;
  }
  if (!expensesList) expensesList = "Brak wprowadzonych kosztów.\n";

  const extraInfo = usedForeign
    ? `\n\nℹ️ _Zyski z faktur w obcych walutach przeliczono po kursie NBP z dnia wystawienia każdej faktury._`
    : "";

  const message = `📊 *WYNIK FINANSOWY: ${command.month}*

📈 *PRZYCHODY (Z faktur):* ${totalRevenue.toFixed(2)} PLN

📉 *KOSZTY RAZEM:* -${totalExpenses.toFixed(2)} PLN
${expensesList}
${emoji} *CZYSTY DOCHÓD:* *${profit.toFixed(2)} PLN*${extraInfo}`;

  await sendWhatsAppMessage(from, message);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}



    if (command.type === "status") {
      const { error, data } = await supabase
        .from("invoices")
        .update({ paid: command.paid, updated_at: new Date().toISOString() })
        .or(buildInvoiceOrFilter(command.num))
        .select();

      if (error) {
        await sendWhatsAppMessage(from, `Błąd zmiany statusu: ${error.message}`);
      } else if (!data || data.length === 0) {
        await sendWhatsAppMessage(from, `Nie znaleziono faktury ${command.num}`);
      } else {
        await sendWhatsAppMessage(
          from,
          `Zmieniono status faktury ${command.num} na ${command.paid ? "opłacona" : "nieopłacona"}`
        );
      }

      return new Response(JSON.stringify({ ok: true, handled: true, type: "status" }), { status: 200 });
    }
    if (command.type === "szukaj") {
      const safeQuery = command.query.replace(/,/g, ""); // Usuwamy przecinki, żeby nie popsuć zapytania
      
      const { data, error } = await supabase
        .from("invoices")
        .select("invoice_number, ksef_number, issue_date, due_date, seller_name, seller_nip, gross_amount, net_amount, currency, paid")
        .or(`seller_name.ilike.%${safeQuery}%,seller_nip.ilike.%${safeQuery}%`)
        .order("issue_date", { ascending: false })
        .limit(10);

      if (error) {
        await sendWhatsAppMessage(from, `❌ Błąd wyszukiwania: ${error.message}`);
      } else if (!data || data.length === 0) {
        await sendWhatsAppMessage(from, `📭 Nie znaleziono faktur dla hasła: *${command.query}*`);
      } else {
          const lines = data.map((item, index) => {
          const isPaid = item.paid ? "✅ Opłacona" : "⏳ Nieopłacona";
          const paymentDays = item.payment_days ? ` (${item.payment_days} dni)` : "";
          
          const gross = item.gross_amount !== null ? item.gross_amount : "?";
          const net = item.net_amount !== null ? item.net_amount : "?";
          
          return `*${index + 1}. FV: ${item.invoice_number || "Brak"}*
🏢 Od: ${item.seller_name || item.seller_nip || "brak"}
💰 Kwota: ${net} netto / ${gross} brutto ${item.currency || "PLN"}
📅 Wystawiono: ${item.issue_date || "brak"}
➡️ Termin: ${item.due_date || "brak"}${paymentDays}
Status: ${isPaid}`;
        });

        await sendWhatsAppMessage(from, `*🔍 Wyniki wyszukiwania dla "${command.query}":*\n\n${lines.join("\n\n")}`);
      }
      return new Response(JSON.stringify({ ok: true, handled: true, type: "szukaj" }), { status: 200 });
    }
    if (command.type === "pilne") {
      // Wyliczamy datę za 3 dni od teraz
      const now = new Date();
      now.setDate(now.getDate() + 3);
      const targetIso = now.toISOString().split("T")[0]; 

      const { data, error } = await supabase
        .from("invoices")
        .select("invoice_number, seller_name, due_date, gross_amount, currency")
        .eq("paid", false)
        .not("due_date", "is", null)
        .lte("due_date", targetIso) // Mniejsze lub równe dacie za 3 dni
        .order("due_date", { ascending: true })
        .limit(10);

      if (error) {
        await sendWhatsAppMessage(from, `❌ Błąd: ${error.message}`);
      } else if (!data || data.length === 0) {
        await sendWhatsAppMessage(from, "😎 Wszystko pod kontrolą! Brak przeterminowanych i pilnych faktur (w ciągu najbliższych 3 dni).");
      } else {
        const lines = data.map((item, index) => {
          const amount = item.gross_amount !== null ? `${item.gross_amount} ${item.currency || "PLN"}` : "Brak";
          return `🚨 *${item.invoice_number || "Brak"}*
🏢 ${item.seller_name || "brak"}
💰 ${amount} | ➡️ Termin: *${item.due_date}*`;
        });
        await sendWhatsAppMessage(from, `*🔥 PILNE FAKTURY (Termin minął lub mija za <3 dni):*\n\n${lines.join("\n\n")}`);
      }
      return new Response(JSON.stringify({ ok: true, handled: true, type: "pilne" }), { status: 200 });
    }
        if (command.type === "termin") {
      // 1. Pobieramy fakturę z bazy, aby poznać jej datę wystawienia
      const { data: invData, error: invError } = await supabase
        .from("invoices")
        .select("*")
        .or(buildInvoiceOrFilter(command.num))
        .limit(1);

      if (invError) {
        await sendWhatsAppMessage(from, `❌ Błąd pobierania faktury: ${invError.message}`);
        return new Response(JSON.stringify({ ok: true, handled: true, type: "termin_error" }), { status: 200 });
      }

      if (!invData || invData.length === 0) {
        await sendWhatsAppMessage(from, `📭 Nie znaleziono faktury: ${command.num}`);
        return new Response(JSON.stringify({ ok: true, handled: true, type: "termin_not_found" }), { status: 200 });
      }

      const invoice = invData[0];
      let finalDueDate = command.due_date;
      let daysInfo = "";
      let paymentDays = invoice.payment_days; // Domyślnie zachowujemy obecne dni z bazy

      // 2. Jeśli użytkownik wpisał np. "30" zamiast daty
      if (command.days !== undefined) {
        if (!invoice.issue_date) {
           await sendWhatsAppMessage(from, `❌ Faktura *${command.num}* nie ma zapisanej daty wystawienia. Podaj konkretną datę, np. *termin ${command.num} 2026-08-30*`);
           return new Response(JSON.stringify({ ok: true, handled: true, type: "termin_no_issue_date" }), { status: 200 });
        }
        
        // Obliczamy nową datę na podstawie issue_date
        const issueDateObj = new Date(invoice.issue_date);
        issueDateObj.setDate(issueDateObj.getDate() + command.days);
        finalDueDate = issueDateObj.toISOString().split("T")[0];
        
        daysInfo = ` (${command.days} dni od wystawienia)`;
        paymentDays = command.days; // Aktualizujemy informację o dniach w bazie
      }

      // 3. Nadpisujemy bazę wyliczoną datą
      const { error: updateError } = await supabase
        .from("invoices")
        .update({ 
           due_date: finalDueDate, 
           payment_days: paymentDays,
           updated_at: new Date().toISOString() 
        })
        .eq("id", invoice.id);

      if (updateError) {
        await sendWhatsAppMessage(from, `❌ Błąd zmiany terminu: ${updateError.message}`);
      } else {
        await sendWhatsAppMessage(from, `✅ Zmieniono termin płatności faktury *${invoice.invoice_number || invoice.num}* na *${finalDueDate}*${daysInfo}.`);
      }

      return new Response(JSON.stringify({ ok: true, handled: true, type: "termin" }), { status: 200 });
    }

            if (command.type === "lista") {
      let query = supabase
        .from("invoices")
        .select("invoice_number, ksef_number, issue_date, due_date, payment_days, seller_name, seller_nip, gross_amount, net_amount, currency, paid")
        .eq("source", "ksef")
        .not("ksef_number", "is", null)
        .order("issue_date", { ascending: false });

      // Filtrowanie po zakresie dat
      if (command.from && command.to) {
        query = query.gte("issue_date", command.from).lte("issue_date", command.to);
      } 
      // Filtrowanie po konkretnym miesiącu
      else if (command.month) {
        const startOfMonth = `${command.month}-01`;
        const [year, m] = command.month.split("-").map(Number);
        const endObj = new Date(year, m, 0);
        const endOfMonth = endObj.toISOString().split("T")[0];
        
        // WPROWADZONA ZMIANA:
        query = query.or(`service_month.eq.${command.month},and(service_month.is.null,issue_date.gte.${startOfMonth},issue_date.lte.${endOfMonth})`);
      }

      query = query.limit(15);

      const { data, error } = await query;

      if (error) {
        await sendWhatsAppMessage(from, `❌ Błąd pobierania listy: ${error.message}`);
      } else if (!data || data.length === 0) {
        if (command.from && command.to) {
           await sendWhatsAppMessage(from, `📭 Brak faktur z KSeF dla zakresu od ${command.from} do ${command.to}.`);
        } else if (command.month) {
           await sendWhatsAppMessage(from, `📭 Brak faktur z KSeF z miesiąca: *${command.month}*.`);
        } else {
           await sendWhatsAppMessage(from, "📭 Brak faktur z KSeF.");
        }
      } else {
        const lines = data.map((item, index) => {
          const isPaid = item.paid ? "✅ Opłacona" : "⏳ Nieopłacona";
          const paymentDays = item.payment_days ? ` (${item.payment_days} dni)` : "";
          
          const gross = item.gross_amount !== null ? item.gross_amount : "?";
          const net = item.net_amount !== null ? item.net_amount : "?";
          
          return `*${index + 1}. FV: ${item.invoice_number || "Brak"}*
🏢 Od: ${item.seller_name || item.seller_nip || "brak"}
💰 Kwota: ${net} netto / ${gross} brutto ${item.currency || "PLN"}
📅 Wystawiono: ${item.issue_date || "brak"}
➡️ Termin: ${item.due_date || "brak"}${paymentDays}
Status: ${isPaid}`;
        });

        let header = `*📄 Ostatnie faktury z KSeF:*`;
        if (command.from && command.to) {
          header = `*📄 Faktury z KSeF (${command.from} do ${command.to}):*`;
        } else if (command.month) {
          header = `*📄 Faktury z KSeF (Miesiąc: ${command.month}):*`;
        }

        await sendWhatsAppMessage(from, `${header}\n\n${lines.join("\n\n")}`);
      }

      return new Response(JSON.stringify({ ok: true, handled: true, type: "lista" }), { status: 200 });
    }

    if (command.type === "ostatnia") {
      const { data, error } = await supabase
        .from("invoices")
        .select("invoice_number, ksef_number, issue_date, due_date, payment_days, seller_name, seller_nip, gross_amount, net_amount, currency, paid")
        .eq("source", "ksef")
        .not("ksef_number", "is", null)
        .order("issue_date", { ascending: false })
        .limit(1);

      if (error) {
        await sendWhatsAppMessage(from, `Błąd pobierania ostatniej faktury: ${error.message}`);
      } else if (!data || data.length === 0) {
        await sendWhatsAppMessage(from, "Brak faktur z KSeF.");
      } else {
        const item = data[0];
        await sendWhatsAppMessage(
          from,
          `Ostatnia faktura z KSeF:
FV: ${item.invoice_number || "brak"}
KSeF: ${item.ksef_number || "brak"}
NIP: ${item.seller_nip || "brak"}
Sprzedawca: ${item.seller_name || "brak"}
Data: ${item.issue_date || "brak"}
Termin: ${item.due_date || "brak"}${item.payment_days ? ` (${item.payment_days} dni)` : ""}
Kwota: ${item.gross_amount ?? "brak"} ${item.currency || "PLN"}
Status: ${item.paid ? "opłacona" : "nieopłacona"}`
        );
      }

      return new Response(JSON.stringify({ ok: true, handled: true, type: "ostatnia" }), { status: 200 });
    }

    if (command.type === "pokaz") {
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .or(buildInvoiceOrFilter(command.num))
        .limit(1);

      if (error) {
        await sendWhatsAppMessage(from, `Błąd pobierania faktury: ${error.message}`);
      } else if (!data || data.length === 0) {
        await sendWhatsAppMessage(from, `Nie znaleziono faktury ${command.num}`);
      } else {
        const item = data[0];
        const orderInfo = item.order_number ? `\nZlecenie: ${item.order_number}` : "";
        await sendWhatsAppMessage(
          from,
          `Faktura: ${item.invoice_number || item.num || "brak"}
KSeF: ${item.ksef_number || "brak"}${orderInfo}
NIP sprzedawcy: ${item.seller_nip || "brak"}
Sprzedawca: ${item.seller_name || "brak"}
Data wystawienia: ${item.issue_date || "brak"}
Termin: ${item.due_date || "brak"}${item.payment_days ? ` (${item.payment_days} dni)` : ""}
Kwota: ${item.gross_amount ?? "brak"} ${item.currency || "PLN"}
Status: ${item.paid ? "opłacona" : "nieopłacona"}`
        );
      }

      return new Response(JSON.stringify({ ok: true, handled: true, type: "pokaz" }), { status: 200 });
    }
        if (command.type === "nieoplacone") {
      const { data, error } = await supabase
        .from("invoices")
        .select("invoice_number, ksef_number, issue_date, due_date, payment_days, seller_name, seller_nip, gross_amount, net_amount, currency")
        // ZMIANA 1: Szukamy faktur z `false` ORAZ takich, które są całkowicie puste (null)
        .or("paid.eq.false,paid.is.null") 
        // ZMIANA 2: nulle wyrzucamy na koniec (nullsFirst: false), 
        // żeby najpierw pokazywało te faktury, którym naprawdę mija termin
        .order("due_date", { ascending: true, nullsFirst: false }) 
        .limit(10);

      if (error) {
        await sendWhatsAppMessage(from, `❌ Błąd pobierania listy: ${error.message}`);
      } else if (!data || data.length === 0) {
        await sendWhatsAppMessage(from, "🎉 Hurra! Nie masz żadnych nieopłaconych faktur.");
      } else {
        const lines = data.map((item, index) => {
          const paymentDays = item.payment_days ? ` (${item.payment_days} dni)` : "";
          const gross = item.gross_amount !== null ? item.gross_amount : "?";
          const net = item.net_amount !== null ? item.net_amount : "?";
          
          return `*${index + 1}. FV: ${item.invoice_number || "Brak"}*
🏢 Od: ${item.seller_name || item.seller_nip || "brak"}
💰 Kwota: ${net} netto / ${gross} brutto ${item.currency || "PLN"}
➡️ Termin: ${item.due_date || "brak"}${paymentDays}
🧾 KSeF: ${item.ksef_number}`;
        });

        await sendWhatsAppMessage(from, `*⏳ Najpilniejsze nieopłacone faktury:*\n\n${lines.join("\n\n")}`);
      }

      return new Response(JSON.stringify({ ok: true, handled: true, type: "nieoplacone" }), { status: 200 });
    }


    if (command.type === "usun") {
      const { data, error } = await supabase
        .from("invoices")
        .delete()
        .or(buildInvoiceOrFilter(command.num))
        .select();

      if (error) {
        await sendWhatsAppMessage(from, `Błąd usuwania faktury: ${error.message}`);
      } else if (!data || data.length === 0) {
        await sendWhatsAppMessage(from, `Nie znaleziono faktury ${command.num}`);
      } else {
        await sendWhatsAppMessage(from, `Usunięto fakturę ${command.num}`);
      }

      return new Response(JSON.stringify({ ok: true, handled: true, type: "usun" }), { status: 200 });
    }

    return new Response(JSON.stringify({ ok: true, received: true }), { status: 200 });
  } catch (error) {
    console.error("FUNCTION ERROR:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500 },
    );
  }
});