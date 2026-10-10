import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase, seedCreators } from "../src/db.ts";
import { centsFromDecimal } from "../src/parse.ts";

type Db = ReturnType<typeof openDatabase>;

describe("regressões da auditoria de vendas", () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  const post = (path: string, payload: unknown) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  beforeEach(() => {
    db = openDatabase();
    seedCreators(db);
    app = createApp(db, () => new Date("2026-06-01T12:00:00.000Z"));
  });

  it("converte decimal exato até o inteiro seguro e recusa o primeiro centavo acima", () => {
    expect(centsFromDecimal("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
    expect(centsFromDecimal("90071992547409.92")).toBeNull();
    expect(centsFromDecimal("90071992547409.93")).toBeNull();
    expect(centsFromDecimal("0.07")).toBe(7);
    expect(centsFromDecimal("1234567.89")).toBe(123456789);
  });

  it("total decimal acima do inteiro seguro dá 400 sem gravar o pedido", async () => {
    const res = await post("/webhooks/orders", { id: "ord_big", total_price: "90071992547409.93" });
    expect(res.status).toBe(400);
    expect(count("orders")).toBe(0);
    expect((await app.request("/orders/ord_big")).status).toBe(404);
  });

  it("pedido repetido com o mesmo conteúdo é 200; com total, cupom ou UTM diferente é 409 sem alterar nada", async () => {
    const order = { id: "ord_r", total_cents: 10000, coupon: "ANA10", utm_content: "crt_ana" };
    expect((await post("/webhooks/orders", order)).status).toBe(201);
    expect((await post("/webhooks/orders", { ...order, total_price: undefined })).status).toBe(200);
    const before = db.prepare("SELECT * FROM orders").all();
    for (const changed of [{ total_cents: 99 }, { coupon: "BRUNO10" }, { utm_content: "crt_bruno" }]) {
      const res = await post("/webhooks/orders", { ...order, ...changed });
      expect([changed, res.status]).toEqual([changed, 409]);
    }
    expect(db.prepare("SELECT * FROM orders").all()).toEqual(before);
  });

  it("estorno repetido com outro pedido ou outro valor é 409 e o líquido não muda", async () => {
    await post("/webhooks/orders", { id: "ord_e", total_cents: 10000 });
    expect((await post("/webhooks/refunds", { id: "rf_e", order_id: "ord_e", amount_cents: 1000 })).status).toBe(201);
    expect((await post("/webhooks/refunds", { id: "rf_e", order_id: "ord_e", amount_cents: 1000 })).status).toBe(200);
    expect((await post("/webhooks/refunds", { id: "rf_e", order_id: "ord_e", amount_cents: 2000 })).status).toBe(409);
    expect((await post("/webhooks/refunds", { id: "rf_e", order_id: "ord_x", amount_cents: 1000 })).status).toBe(409);
    const order = (await (await app.request("/orders/ord_e")).json()) as { net_cents: number; refunds: unknown[] };
    expect(order.net_cents).toBe(9000);
    expect(order.refunds).toHaveLength(1);
  });

  it("estorno com valor acima do inteiro seguro é 400", async () => {
    await post("/webhooks/orders", { id: "ord_s", total_cents: 10000 });
    const res = await post("/webhooks/refunds", { id: "rf_s", order_id: "ord_s", amount_cents: Number.MAX_SAFE_INTEGER + 1 });
    expect(res.status).toBe(400);
    expect(count("refunds")).toBe(0);
  });
});
