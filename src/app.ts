import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import type { Context } from "hono";
import { readOrder, receiveOrder, receiveRefund } from "./sales.ts";

async function body(c: Context): Promise<Record<string, unknown>> {
  const parsed: unknown = await c.req.json().catch(() => ({}));
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

export function createApp(db: DatabaseSync, now: () => Date = () => new Date()) {
  const app = new Hono();

  app.post("/webhooks/orders", async (c) => {
    const outcome = receiveOrder(db, await body(c), now());
    return c.json(outcome.body, outcome.status);
  });

  app.post("/webhooks/refunds", async (c) => {
    const outcome = receiveRefund(db, await body(c), now());
    return c.json(outcome.body, outcome.status);
  });

  app.get("/orders/:id", (c) => {
    const order = readOrder(db, c.req.param("id"));
    return order ? c.json(order) : c.json({ error: "pedido não encontrado" }, 404);
  });

  return app;
}
