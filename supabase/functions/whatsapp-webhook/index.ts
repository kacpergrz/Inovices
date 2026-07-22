import { createClient } from "npm:@supabase/supabase-js@2";

type CommandResult = {
  ok: boolean;
  commandType: "CHANGE_DUE_DATE" | "CHANGE_STATUS" | "UNKNOWN";
  invoiceNumber?: string;
  parsedValue?: string;
  responseText: string;
  errorText?: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("APP_SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("APP_SUPABASE_SERVICE_ROLE_KEY")!;
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN")!;
const WHATSAPP_WEBHOOK_SECRET = Deno.env.get("WHATSAPP_WEBHOOK_SECRET") || "";
const ALLOWED_WHATSAPP_SENDERS = (Deno.env.get("ALLOWED_WHATSAPP_SENDERS") || "")
  .split(",")
  .map((x) => normalizePhone(x))
  .filter(Boolean);

const supabase = createClient(SUPABASE_URL, APP_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === "GET") {
    return handleVerification(req);
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const rawBody = await req.text();

  if (WHATSAPP_WEBHOOK_SECRET) {
    const signature = req.headers.get("x-hub-signature-256");
    const valid = await verifyMetaSignature(
      rawBody,
      signature,
      WHATSAPP_WEBHOOK_SECRET,
    );

    if (!valid) {
      return jsonResponse({ error: "Invalid webhook signature" }, 401);
    }
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }

  const msg = extractIncomingMessage(payload);

  if (!msg) {
    await logCommand({
      sender_phone: "unknown",
      message_text: null,
      command_type: "IGNORED",
      parsed_invoice_number: null,
      parsed_value: null,
      success: true,
      response_text: "Webhook odebrany, ale brak wiadomości do przetworzenia.",
      error_text: null,
      raw_payload: payload,
    });

    return jsonResponse({ ok: true, message: "No message event to process." }, 200);
  }

  const senderPhone = normalizePhone(msg.from);
  const messageText = (msg.text || "").trim();

  if (!ALLOWED_WHATSAPP_SENDERS.includes(senderPhone)) {
    const responseText = "Brak uprawnień do wykonywania zmian z tego numeru.";

    await logCommand({
      sender_phone: senderPhone,
      message_text: messageText,
      command_type: "UNAUTHORIZED",
      parsed_invoice_number: null,
      parsed_value: null,
      success: false,
      response_text: responseText,
      error_text: "Sender phone not allowed",
      raw_payload: payload,
    });

    return jsonResponse({ ok: false, message: responseText }, 403);
  }

  const result = await processCommand(messageText);

  await logCommand({
    sender_phone: senderPhone,
    message_text: messageText,
    command_type: result.commandType,
    parsed_invoice_number: result.invoiceNumber ?? null,
    parsed_value: result.parsedValue ?? null,
    success: result.ok,
    response_text: result.responseText,
    error_text: result.errorText ?? null,
    raw_payload: payload,
  });

  return jsonResponse(
    {
      ok: result.ok,
      message: result.responseText,
      commandType: result.commandType,
      invoiceNumber: result.invoiceNumber ?? null,
    },
    result.ok ? 200 : 400,
  );
});

function normalizePhone(phone: string | null | undefined): string {
  return String(phone || "").replace(/[^d+]/g, "");
}

async function handleVerification(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Verification failed", { status: 403 });
}

function extractIncomingMessage(payload: any): { from: string; text: string } | null {
  const entry = payload?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const message = value?.messages?.[0];

  if (!message) return null;
  if (message.type !== "text") return null;

  return {
    from: message.from,
    text: message.text?.body || "",
  };
}

async function processCommand(input: string): Promise<CommandResult> {
  const text = input.trim().replace(/s+/g, " ");

  const changeDueMatch = text.match(/^ZMIENs+(.+?)s+TERMINs+(d{4}-d{2}-d{2})$/i);
  if (changeDueMatch) {
    const invoiceNumber = changeDueMatch[1].trim();
    const dueDate = changeDueMatch[2].trim();

    if (!isValidDate(dueDate)) {
      return {
        ok: false,
        commandType: "CHANGE_DUE_DATE",
        invoiceNumber,
        parsedValue: dueDate,
        responseText:
          "Niepoprawny format daty. Przykład: ZMIEN FV/123/07/2026 TERMIN 2026-08-20",
        errorText: "Invalid date format",
      };
    }

    const { data, error } = await supabase
      .from("invoices")
      .update({
        due_date: dueDate,
        updated_at: new Date().toISOString(),
      })
      .eq("num", invoiceNumber)
      .select("id,num,due_date")
      .limit(1);

    if (error) {
      return {
        ok: false,
        commandType: "CHANGE_DUE_DATE",
        invoiceNumber,
        parsedValue: dueDate,
        responseText: "Wystąpił błąd podczas aktualizacji terminu płatności.",
        errorText: error.message,
      };
    }

    if (!data || data.length === 0) {
      return {
        ok: false,
        commandType: "CHANGE_DUE_DATE",
        invoiceNumber,
        parsedValue: dueDate,
        responseText: "Nie znaleziono faktury o podanym numerze.",
      };
    }

    return {
      ok: true,
      commandType: "CHANGE_DUE_DATE",
      invoiceNumber,
      parsedValue: dueDate,
      responseText: `Zmieniono termin płatności faktury ${invoiceNumber} na ${dueDate}.`,
    };
  }

  const statusMatch = text.match(/^STATUSs+(.+?)s+([A-ZĄĆĘŁŃÓŚŹŻ_]+)$/i);
  if (statusMatch) {
    const invoiceNumber = statusMatch[1].trim();
    const rawStatus = statusMatch[2].trim().toUpperCase();
    const paid = normalizePaidStatus(rawStatus);

    if (paid === null) {
      return {
        ok: false,
        commandType: "CHANGE_STATUS",
        invoiceNumber,
        parsedValue: rawStatus,
        responseText:
          "Niepoprawny status. Dozwolone: OPLACONA albo NIEOPLACONA. Przykład: STATUS FV/123/07/2026 OPLACONA",
        errorText: "Invalid status value",
      };
    }

    const { data, error } = await supabase
      .from("invoices")
      .update({
        paid,
        updated_at: new Date().toISOString(),
      })
      .eq("num", invoiceNumber)
      .select("id,num,paid")
      .limit(1);

    if (error) {
      return {
        ok: false,
        commandType: "CHANGE_STATUS",
        invoiceNumber,
        parsedValue: rawStatus,
        responseText: "Wystąpił błąd podczas aktualizacji statusu.",
        errorText: error.message,
      };
    }

    if (!data || data.length === 0) {
      return {
        ok: false,
        commandType: "CHANGE_STATUS",
        invoiceNumber,
        parsedValue: rawStatus,
        responseText: "Nie znaleziono faktury o podanym numerze.",
      };
    }

    return {
      ok: true,
      commandType: "CHANGE_STATUS",
      invoiceNumber,
      parsedValue: rawStatus,
      responseText: `Zmieniono status faktury ${invoiceNumber} na ${paid ? "OPLACONA" : "NIEOPLACONA"}.`,
    };
  }

  return {
    ok: false,
    commandType: "UNKNOWN",
    responseText:
      "Niepoprawny format komendy. Przykłady: ZMIEN FV/123/07/2026 TERMIN 2026-08-20 lub STATUS FV/123/07/2026 OPLACONA",
    errorText: "Unknown command format",
  };
}

function normalizePaidStatus(status: string): boolean | null {
  const normalized = status
    .replaceAll("Ł", "L")
    .replaceAll("Ą", "A")
    .replaceAll("Ę", "E")
    .replaceAll("Ó", "O")
    .replaceAll("Ś", "S")
    .replaceAll("Ż", "Z")
    .replaceAll("Ź", "Z")
    .replaceAll("Ć", "C")
    .replaceAll("Ń", "N");

  if (normalized === "OPLACONA") return true;
  if (normalized === "NIEOPLACONA") return false;
  return null;
}

function isValidDate(dateStr: string): boolean {
  if (!/^d{4}-d{2}-d{2}$/.test(dateStr)) return false;
  const d = new Date(`${dateStr}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(dateStr);
}

async function logCommand(log: {
  sender_phone: string;
  message_text: string | null;
  command_type: string | null;
  parsed_invoice_number: string | null;
  parsed_value: string | null;
  success: boolean;
  response_text: string | null;
  error_text: string | null;
  raw_payload: any;
}) {
  const { error } = await supabase.from("whatsapp_logs").insert(log);
  if (error) {
    console.error("whatsapp_logs insert error:", error.message);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expectedHex = signatureHeader.slice(7);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );

  const actualHex = [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(actualHex, expectedHex);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}
