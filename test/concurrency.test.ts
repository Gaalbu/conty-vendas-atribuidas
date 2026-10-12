import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase, seedCreators } from "../src/db.ts";

describe("estornos simultâneos em conexões diferentes", () => {
  it("6 threads estornando 3000 de um pedido de 10000: 3 aplicam, 3 são rejeitados, líquido 1000", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vendas-"));
    const path = join(dir, "shared.sqlite");
    try {
      const db = openDatabase(path);
      seedCreators(db);
      const app = createApp(db);
      await app.request("/webhooks/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "ord_t", total_cents: 10000, coupon: "ANA10" }) });
      const flags = new Int32Array(new SharedArrayBuffer(8));
      const results = Array.from({ length: 6 }, (_, i) => {
        const worker = new Worker(new URL("./post-worker.ts", import.meta.url), {
          workerData: { dbPath: path, flags, route: "/webhooks/refunds", body: { id: `rf_${i}`, order_id: "ord_t", amount_cents: 3000 } },
          execArgv: ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"],
        });
        return new Promise<number>((resolve, reject) => {
          worker.once("message", resolve);
          worker.once("error", reject);
        });
      });
      while (Atomics.load(flags, 1) < 6) await new Promise((resolve) => setTimeout(resolve, 5));
      Atomics.store(flags, 0, 1);
      Atomics.notify(flags, 0);
      expect((await Promise.all(results)).sort()).toEqual([201, 201, 201, 409, 409, 409]);
      const order = (await (await app.request("/orders/ord_t")).json()) as { net_cents: number };
      expect(order.net_cents).toBe(1000);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
