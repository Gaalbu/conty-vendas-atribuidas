// Leitura do webhook de pedido: só o essencial de uma loja.

export type OrderInput = {
  id: string;
  total_cents: number;
  status: string;
  coupon: string | null;
  utm_content: string | null;
};

const DECIMAL = /^(\d+)(?:\.(\d{1,2}))?$/;

// "150.00" vira 15000. Mais de duas casas, negativo ou texto: null.
export function centsFromDecimal(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const match = DECIMAL.exec(text);
  if (!match) return null;
  const reais = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  return reais * 100 + cents;
}

function totalCents(payload: Record<string, unknown>): number | null {
  if (payload.total_cents !== undefined) {
    const cents = payload.total_cents;
    return typeof cents === "number" && Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
  }
  return centsFromDecimal(payload.total_price ?? payload.amount);
}

function couponCode(payload: Record<string, unknown>): string | null {
  let code: unknown = payload.coupon;
  if (code === undefined && Array.isArray(payload.discount_codes)) {
    const first: unknown = payload.discount_codes[0];
    if (first && typeof first === "object") code = (first as { code?: unknown }).code;
  }
  return typeof code === "string" && code.trim() ? code.trim().toUpperCase() : null;
}

function utmContent(payload: Record<string, unknown>): string | null {
  if (typeof payload.utm_content === "string" && payload.utm_content.trim()) return payload.utm_content.trim();
  if (typeof payload.landing_site !== "string") return null;
  try {
    const url = new URL(payload.landing_site, "https://loja.invalid");
    return url.searchParams.get("utm_content")?.trim() || null;
  } catch {
    return null;
  }
}

export function parseOrder(payload: Record<string, unknown>): OrderInput | { error: string } {
  const id = typeof payload.id === "string" || typeof payload.id === "number" ? String(payload.id).trim() : "";
  if (!id) return { error: "id do pedido é obrigatório" };
  const total = totalCents(payload);
  if (total === null) return { error: "total inválido: use total_cents inteiro ou valor com até duas casas" };
  const status = typeof payload.status === "string" && payload.status.trim() ? payload.status.trim() : "paid";
  return { id, total_cents: total, status, coupon: couponCode(payload), utm_content: utmContent(payload) };
}
