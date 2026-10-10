import type { DatabaseSync } from "node:sqlite";
import { attribute } from "./attribute.ts";
import {
  appliedCents,
  REASON_ORDER_MISSING,
  refundsOf,
  resolveRefund,
  settlePending,
} from "./ledger.ts";
import type { RefundRow } from "./ledger.ts";
import { parseOrder } from "./parse.ts";

export type Outcome = { status: 200 | 201 | 202 | 400 | 404 | 409; body: unknown };

type OrderRow = {
  id: string;
  total_cents: number;
  status: string;
  coupon: string | null;
  utm_content: string | null;
  creator_id: string | null;
  rule: string;
  coupon_creator_id: string | null;
  utm_creator_id: string | null;
  received_at: string;
};

function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function instant(value: unknown, fallback: Date): string {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return fallback.toISOString();
}

function findOrder(db: DatabaseSync, id: string): OrderRow | undefined {
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | undefined;
}

function creatorByCoupon(db: DatabaseSync, code: string | null): string | null {
  if (!code) return null;
  const row = db.prepare("SELECT creator_id FROM coupons WHERE code = ?").get(code) as
    | { creator_id: string }
    | undefined;
  return row?.creator_id ?? null;
}

// UTM só conta quando é o id de um criador conhecido.
function creatorByUtm(db: DatabaseSync, utm: string | null): string | null {
  if (!utm) return null;
  const row = db.prepare("SELECT id FROM creators WHERE id = ?").get(utm) as { id: string } | undefined;
  return row?.id ?? null;
}

function present(refund: RefundRow) {
  return {
    id: refund.id,
    order_id: refund.order_id,
    amount_cents: refund.amount_cents,
    state: refund.state,
    reason: refund.reason,
    received_at: refund.received_at,
  };
}

export function readOrder(db: DatabaseSync, id: string) {
  const order = findOrder(db, id);
  if (!order) return null;
  return {
    id: order.id,
    status: order.status,
    total_cents: order.total_cents,
    net_cents: order.total_cents - appliedCents(db, order.id),
    attribution: {
      creator_id: order.creator_id,
      rule: order.rule,
      coupon_creator_id: order.coupon_creator_id,
      utm_creator_id: order.utm_creator_id,
    },
    refunds: refundsOf(db, order.id).map(present),
  };
}

export function receiveOrder(db: DatabaseSync, payload: Record<string, unknown>, now: Date): Outcome {
  const parsed = parseOrder(payload);
  if ("error" in parsed) return { status: 400, body: { error: parsed.error } };

  // Pedido repetido: mesma resposta, nada soma de novo.
  if (findOrder(db, parsed.id)) return { status: 200, body: readOrder(db, parsed.id) };

  const at = instant(payload.received_at, now);
  const attribution = attribute({
    couponCreatorId: creatorByCoupon(db, parsed.coupon),
    utmCreatorId: creatorByUtm(db, parsed.utm_content),
  });

  transaction(db, () => {
    db.prepare(
      `INSERT INTO orders (id, total_cents, status, coupon, utm_content, creator_id, rule,
         coupon_creator_id, utm_creator_id, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
    ).run(
      parsed.id,
      parsed.total_cents,
      parsed.status,
      parsed.coupon,
      parsed.utm_content,
      attribution.creator_id,
      attribution.rule,
      attribution.coupon_creator_id,
      attribution.utm_creator_id,
      at,
    );
    settlePending(db, parsed.id, parsed.total_cents, at);
  });
  return { status: 201, body: readOrder(db, parsed.id) };
}

function positiveCents(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function receiveRefund(db: DatabaseSync, payload: Record<string, unknown>, now: Date): Outcome {
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  const orderId = typeof payload.order_id === "string" ? payload.order_id.trim() : "";
  const amount = positiveCents(payload.amount_cents);
  if (!id) return { status: 400, body: { error: "id do estorno é obrigatório" } };
  if (!orderId) return { status: 400, body: { error: "order_id é obrigatório" } };
  if (amount === null) return { status: 400, body: { error: "amount_cents deve ser inteiro positivo" } };

  // O mesmo estorno não aplica duas vezes: devolve o que já foi decidido.
  const existing = db.prepare("SELECT * FROM refunds WHERE id = ?").get(id) as RefundRow | undefined;
  if (existing) return { status: 200, body: present(existing) };

  const at = instant(payload.received_at, now);
  const order = findOrder(db, orderId);

  return transaction(db, () => {
    db.prepare(
      `INSERT INTO refunds (id, order_id, amount_cents, state, reason, received_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    ).run(id, orderId, amount, order ? null : REASON_ORDER_MISSING, at);
    const row = db.prepare("SELECT * FROM refunds WHERE id = ?").get(id) as RefundRow;

    if (!order) return { status: 202 as const, body: present(row) };
    const resolved = resolveRefund(db, row, order.total_cents, at);
    return { status: resolved.state === "applied" ? (201 as const) : (409 as const), body: present(resolved) };
  });
}
