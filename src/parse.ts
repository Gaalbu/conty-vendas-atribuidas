// Leitura do webhook de pedido: só o essencial de uma loja.

export type OrderInput = {
  id: string;
  total_cents: number;
  status: string;
  coupon: string | null;
  utm_content: string | null;
};

const DECIMAL = /^(\d+)(?:\.(\d{1,2}))?$/;

// "150.00" vira 15000. Mais de duas casas, negativo, texto ou valor acima do
// inteiro seguro: null. A conta é em BigInt para não arredondar no caminho.
export function centsFromDecimal(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const match = DECIMAL.exec(text);
  if (!match) return null;
  const cents = BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
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

// Base só para resolver landing_site relativo ("/produto?utm_content=…"). O TLD
// .invalid é reservado (RFC 2606): nenhuma requisição sai daqui.
const RELATIVE_BASE = "https://loja.invalid";

// landing_site ilegível não é sinal de UTM: a venda segue para cupom ou para
// "sem cupom nem utm de criador", sem derrubar o webhook.
function utmContent(payload: Record<string, unknown>): string | null {
  if (typeof payload.utm_content === "string" && payload.utm_content.trim()) return payload.utm_content.trim();
  if (typeof payload.landing_site !== "string" || !URL.canParse(payload.landing_site, RELATIVE_BASE)) return null;
  const url = new URL(payload.landing_site, RELATIVE_BASE);
  return url.searchParams.get("utm_content")?.trim() || null;
}

export function parseOrder(payload: Record<string, unknown>): OrderInput | { error: string } {
  const id = typeof payload.id === "string" || typeof payload.id === "number" ? String(payload.id).trim() : "";
  if (!id) return { error: "id do pedido é obrigatório" };
  const total = totalCents(payload);
  if (total === null) return { error: "total inválido: use total_cents inteiro ou valor com até duas casas" };
  const status = typeof payload.status === "string" && payload.status.trim() ? payload.status.trim() : "paid";
  return { id, total_cents: total, status, coupon: couponCode(payload), utm_content: utmContent(payload) };
}
