import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase, seedCreators } from "../src/db.ts";

type Order = { status: string; net_cents: number; attribution_state: string; attribution: { creator_id: string | null }; refunds: Array<{ id: string; amount_cents: number; state: string; reason: string | null }> };
type Sales = { creator_id: string; gross_cents: number; refunded_cents: number; net_cents: number; orders: Array<{ id: string; net_cents: number; attribution_state: string }> };

describe("reversão da atribuição", () => {
  let app: ReturnType<typeof createApp>;
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = async <T>(res: Response | Promise<Response>) => (await (await res).json()) as T;

  beforeEach(() => {
    const db = openDatabase();
    seedCreators(db);
    app = createApp(db, () => new Date("2026-06-01T12:00:00.000Z"));
  });

  it("pedido que muda para cancelado reverte o saldo restante num lançamento rastreável e a atribuição fica revertida", async () => {
    await post("/webhooks/orders", { id: "ord_c", total_cents: 10000, coupon: "ANA10", status: "paid" });
    await post("/webhooks/refunds", { id: "rf_1", order_id: "ord_c", amount_cents: 3000 });
    const res = await post("/webhooks/orders", { id: "ord_c", total_cents: 10000, coupon: "ANA10", status: "cancelled" });
    expect(res.status).toBe(200);
    const order = await json<Order>(res);
    expect(order).toMatchObject({ status: "cancelled", net_cents: 0, attribution_state: "revertida", attribution: { creator_id: "crt_ana" } });
    expect(order.refunds.map((r) => [r.id, r.amount_cents, r.state])).toEqual([
      ["rf_1", 3000, "applied"],
      ["cancelamento:ord_c", 7000, "applied"],
    ]);
  });

  it("cancelamento repetido não reverte de novo", async () => {
    await post("/webhooks/orders", { id: "ord_c", total_cents: 10000, coupon: "ANA10", status: "paid" });
    for (const status of ["cancelled", "voided", "cancelled"]) await post("/webhooks/orders", { id: "ord_c", total_cents: 10000, coupon: "ANA10", status });
    const order = await json<Order>(app.request("/orders/ord_c"));
    expect(order.refunds).toHaveLength(1);
    expect(order.net_cents).toBe(0);
  });

  it("pedido que já chega estornado entra com a atribuição revertida", async () => {
    const order = await json<Order>(post("/webhooks/orders", { id: "ord_r", total_cents: 5000, utm_content: "crt_bruno", status: "refunded" }));
    expect(order).toMatchObject({ net_cents: 0, attribution_state: "revertida", attribution: { creator_id: "crt_bruno" } });
  });

  it("estorno parcial mantém a atribuição ativa", async () => {
    await post("/webhooks/orders", { id: "ord_p", total_cents: 10000, coupon: "ANA10" });
    await post("/webhooks/refunds", { id: "rf_p", order_id: "ord_p", amount_cents: 2500 });
    expect(await json<Order>(app.request("/orders/ord_p"))).toMatchObject({ net_cents: 7500, attribution_state: "ativa" });
  });

  it("o resumo por criador soma bruto, estornado e líquido de cada venda atribuída", async () => {
    await post("/webhooks/orders", { id: "ord_1", total_cents: 10000, coupon: "ANA10" });
    await post("/webhooks/orders", { id: "ord_2", total_cents: 4000, coupon: "ANA10", status: "cancelled" });
    await post("/webhooks/orders", { id: "ord_3", total_cents: 9000, coupon: "BRUNO10" });
    await post("/webhooks/refunds", { id: "rf_1", order_id: "ord_1", amount_cents: 1000 });
    const sales = await json<Sales>(app.request("/creators/crt_ana/sales"));
    expect(sales).toMatchObject({ creator_id: "crt_ana", gross_cents: 14000, refunded_cents: 5000, net_cents: 9000 });
    expect(sales.orders.map((o) => [o.id, o.net_cents, o.attribution_state])).toEqual([
      ["ord_1", 9000, "ativa"],
      ["ord_2", 0, "revertida"],
    ]);
    expect((await app.request("/creators/crt_fantasma/sales")).status).toBe(404);
  });

  it("rota inexistente responde 404 em JSON", async () => {
    const res = await app.request("/nao-existe");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "rota não encontrada" });
  });
});
