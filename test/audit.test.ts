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

  it("estorno com valor acima do inteiro seguro é 400", async () => {
    await post("/webhooks/orders", { id: "ord_s", total_cents: 10000 });
    const res = await post("/webhooks/refunds", { id: "rf_s", order_id: "ord_s", amount_cents: Number.MAX_SAFE_INTEGER + 1 });
    expect(res.status).toBe(400);
    expect(count("refunds")).toBe(0);
  });
});
