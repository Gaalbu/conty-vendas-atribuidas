import type { DatabaseSync } from "node:sqlite";

export type RefundState = "pending" | "applied" | "rejected";
export type RefundRow = {
  id: string;
  order_id: string;
  amount_cents: number;
  state: RefundState;
  reason: string | null;
  received_at: string;
  resolved_at: string | null;
};

export const REASON_ORDER_MISSING = "pedido ainda não chegou";
export const REASON_OVER_TOTAL = "estorno passaria do valor da venda";

export function appliedCents(db: DatabaseSync, orderId: string): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM refunds WHERE order_id = ? AND state = 'applied'")
    .get(orderId) as { n: number | bigint };
  return Number(row.n);
}

// Aplica um estorno que estava pendente, ou recusa se passaria do total.
// Nada é apagado: o rejeitado fica no histórico com o motivo.
export function resolveRefund(db: DatabaseSync, refund: RefundRow, totalCents: number, at: string): RefundRow {
  const fits = appliedCents(db, refund.order_id) + refund.amount_cents <= totalCents;
  const state: RefundState = fits ? "applied" : "rejected";
  const reason = fits ? null : REASON_OVER_TOTAL;
  db.prepare("UPDATE refunds SET state = ?, reason = ?, resolved_at = ? WHERE id = ?").run(
    state,
    reason,
    at,
    refund.id,
  );
  return { ...refund, state, reason, resolved_at: at };
}

// Quando o pedido chega, os estornos que vieram antes aplicam na ordem em que
// foram recebidos.
export function settlePending(db: DatabaseSync, orderId: string, totalCents: number, at: string): void {
  const pending = db
    .prepare("SELECT * FROM refunds WHERE order_id = ? AND state = 'pending' ORDER BY received_at ASC, id ASC")
    .all(orderId) as RefundRow[];
  for (const refund of pending) resolveRefund(db, refund, totalCents, at);
}

export function refundsOf(db: DatabaseSync, orderId: string): RefundRow[] {
  return db
    .prepare("SELECT * FROM refunds WHERE order_id = ? ORDER BY received_at ASC, rowid ASC")
    .all(orderId) as RefundRow[];
}

export const CANCELLED_STATUSES = new Set(["cancelled", "canceled", "voided", "refunded"]);
export const REASON_CANCELLED = "pedido cancelado: saldo restante revertido";

// Pedido cancelado, anulado ou estornado na loja reverte o que ainda não foi
// estornado, num lançamento com id fixo: cancelar de novo não reverte duas vezes.
export function cancelRemaining(db: DatabaseSync, orderId: string, totalCents: number, at: string): void {
  const id = `cancelamento:${orderId}`;
  if (db.prepare("SELECT 1 FROM refunds WHERE id = ?").get(id)) return;
  const remaining = totalCents - appliedCents(db, orderId);
  if (remaining <= 0) return;
  db.prepare(
    `INSERT INTO refunds (id, order_id, amount_cents, state, reason, received_at, resolved_at)
     VALUES (?, ?, ?, 'applied', ?, ?, ?)`,
  ).run(id, orderId, remaining, REASON_CANCELLED, at, at);
}
