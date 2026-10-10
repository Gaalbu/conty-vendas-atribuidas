import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase, seedCreators } from "../src/db.ts";
import { centsFromDecimal } from "../src/parse.ts";

type App = ReturnType<typeof createApp>;
type Order = {
  total_cents: number;
  net_cents: number;
  attribution: { creator_id: string | null; rule: string; coupon_creator_id: string | null; utm_creator_id: string | null };
  refunds: Array<{ id: string; state: string; reason: string | null }>;
};

function post(app: App, path: string, payload: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("vendas atribuídas ao criador", () => {
  let app: App;

  beforeEach(() => {
    const db = openDatabase();
    seedCreators(db);
    app = createApp(db, () => new Date("2026-06-01T12:00:00.000Z"));
  });

  it("pedido repetido da Ana com cupom e utm concordando responde 200 e não soma de novo", async () => {
    const order = { id: "ord_1001", total_price: "150.00", coupon: "ANA10", utm_content: "crt_ana", status: "paid" };
    const first = await post(app, "/webhooks/orders", order);
    expect(first.status).toBe(201);
    const second = await post(app, "/webhooks/orders", order);
    expect(second.status).toBe(200);

    const body = (await second.json()) as Order;
    expect(body.total_cents).toBe(15000);
    expect(body.net_cents).toBe(15000);
    expect(body.attribution).toEqual({
      creator_id: "crt_ana",
      rule: "cupom e utm concordam",
      coupon_creator_id: "crt_ana",
      utm_creator_id: "crt_ana",
    });
  });

  it("cupom ANA10 com utm crt_bruno atribui à Ana e guarda os dois ids", async () => {
    const res = await post(app, "/webhooks/orders", {
      id: "ord_1002",
      total_cents: 9000,
      discount_codes: [{ code: "ana10" }],
      landing_site: "/produtos/serum?utm_source=ig&utm_content=crt_bruno",
    });
    const body = (await res.json()) as Order;
    expect(body.attribution).toEqual({
      creator_id: "crt_ana",
      rule: "cupom vence utm quando apontam para criadores diferentes",
      coupon_creator_id: "crt_ana",
      utm_creator_id: "crt_bruno",
    });
  });

  it("estorno não passa do total: 4000 aplica, o mesmo id não duplica, 7000 fica rejeitado e visível", async () => {
    await post(app, "/webhooks/orders", { id: "ord_1003", total_cents: 10000, coupon: "BRUNO10" });

    const refund = { id: "rf_1", order_id: "ord_1003", amount_cents: 4000 };
    expect((await post(app, "/webhooks/refunds", refund)).status).toBe(201);
    const again = await post(app, "/webhooks/refunds", refund);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ state: "applied" });

    const tooBig = await post(app, "/webhooks/refunds", { id: "rf_2", order_id: "ord_1003", amount_cents: 7000 });
    expect(tooBig.status).toBe(409);
    expect(await tooBig.json()).toMatchObject({ state: "rejected", reason: "estorno passaria do valor da venda" });

    const order = (await (await app.request("/orders/ord_1003")).json()) as Order;
    expect(order.net_cents).toBe(6000);
    expect(order.refunds.filter((r) => r.state === "applied")).toHaveLength(1);
    expect(order.refunds.map((r) => r.state)).toEqual(["applied", "rejected"]);
    expect(order.attribution.creator_id).toBe("crt_bruno");
  });

  it("estorno antes do pedido fica pendente com 202 e aplica quando o pedido chega", async () => {
    const early = await post(app, "/webhooks/refunds", {
      id: "rf_3",
      order_id: "ord_1004",
      amount_cents: 2500,
      received_at: "2026-06-01T10:00:00.000Z",
    });
    expect(early.status).toBe(202);
    expect(await early.json()).toMatchObject({ state: "pending", reason: "pedido ainda não chegou" });

    const res = await post(app, "/webhooks/orders", {
      id: "ord_1004",
      amount: 80,
      landing_site: "https://loja.exemplo/?utm_content=crt_bruno",
    });
    const order = (await res.json()) as Order;
    expect(order.net_cents).toBe(5500);
    expect(order.refunds).toEqual([expect.objectContaining({ id: "rf_3", state: "applied" })]);
    expect(order.attribution).toMatchObject({ creator_id: "crt_bruno", rule: "utm" });
  });

  it("pendentes que somados passariam do total: o primeiro recebido aplica e o seguinte é rejeitado", async () => {
    await post(app, "/webhooks/refunds", { id: "rf_b", order_id: "ord_1005", amount_cents: 600, received_at: "2026-06-01T10:05:00.000Z" });
    await post(app, "/webhooks/refunds", { id: "rf_a", order_id: "ord_1005", amount_cents: 700, received_at: "2026-06-01T10:00:00.000Z" });
    const order = (await (await post(app, "/webhooks/orders", { id: "ord_1005", total_cents: 1000 })).json()) as Order;
    expect(order.refunds.map((r) => [r.id, r.state])).toEqual([
      ["rf_a", "applied"],
      ["rf_b", "rejected"],
    ]);
    expect(order.net_cents).toBe(300);
  });

  it("sem cupom nem utm de criador conhecido o pedido fica sem criador", async () => {
    const res = await post(app, "/webhooks/orders", { id: "ord_1006", total_cents: 500, coupon: "BLACKFRIDAY", utm_content: "crt_fantasma" });
    expect(((await res.json()) as Order).attribution).toEqual({
      creator_id: null,
      rule: "sem cupom nem utm de criador",
      coupon_creator_id: null,
      utm_creator_id: null,
    });
  });

  it("total com mais de duas casas é recusado e 150.00 vira 15000 centavos", async () => {
    expect(centsFromDecimal("150.00")).toBe(15000);
    expect(centsFromDecimal("19.9")).toBe(1990);
    expect(centsFromDecimal("1.999")).toBeNull();
    expect((await post(app, "/webhooks/orders", { id: "ord_x", total_price: "1.999" })).status).toBe(400);
  });
});
