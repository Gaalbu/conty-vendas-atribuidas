import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { body, BodyError, MAX_BODY_BYTES } from "./body.ts";
import { readOrder, receiveOrder, receiveRefund } from "./sales.ts";

export function createApp(db: DatabaseSync, now: () => Date = () => new Date()) {
  const app = new Hono();

  app.use("*", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: "corpo acima de 64 KB" }, 413) }));
  app.onError((error, c) => {
    if (error instanceof BodyError) return c.json(error.payload, error.status);
    // Erro inesperado: 500 em JSON genérico, sem stack na resposta; o detalhe vai para o log.
    console.error(error);
    return c.json({ error: "erro interno" }, 500);
  });

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
