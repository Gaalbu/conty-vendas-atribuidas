import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDatabase, seedCreators } from "./db.ts";

const db = openDatabase();
seedCreators(db);
const port = Number(process.env.PORT ?? 43123);

serve({ fetch: createApp(db).fetch, port }, (info) => {
  console.log(`vendas atribuídas em http://127.0.0.1:${info.port}`);
});
