import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase, seedCreators } from "../src/db.ts";

const VALID = {"id": "ord_h", "total_cents": 500};

describe("entrada HTTP estrita", () => {
  let db: ReturnType<typeof openDatabase>;
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    db = openDatabase();
    seedCreators(db);
    app = createApp(db, () => new Date("2026-06-01T12:00:00.000Z"));
  });
  const raw = (body: string, contentType = "application/json") =>
    app.request("/webhooks/orders", { method: "POST", headers: { "content-type": contentType }, body });
  const count = () => (db.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }).n;

  it("JSON inválido é 400 e não grava nada", async () => {
    const res = await raw(JSON.stringify(VALID).slice(0, -2));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "JSON inválido" });
    expect(count()).toBe(0);
  });

  it("corpo que não é objeto é 400", async () => {
    expect((await raw(JSON.stringify([VALID]))).status).toBe(400);
    expect(count()).toBe(0);
  });

  it("corpo sem Content-Type JSON é 415; com charset é aceito", async () => {
    expect((await raw(JSON.stringify(VALID), "text/plain")).status).toBe(415);
    expect(count()).toBe(0);
    expect((await raw(JSON.stringify(VALID), "application/json; charset=utf-8")).status).toBe(201);
  });

  it("campo extra do webhook é aceito: a loja manda bem mais que o essencial", async () => {
    const res = await raw(JSON.stringify({ ...VALID, line_items: [{ sku: "x" }], customer: { id: 1 } }));
    expect(res.status).toBe(201);
  });

  it("corpo acima de 64 KB é 413", async () => {
    const res = await raw(JSON.stringify({ ...VALID, pad: "x".repeat(70 * 1024) }));
    expect(res.status).toBe(413);
    expect(count()).toBe(0);
  });
});
