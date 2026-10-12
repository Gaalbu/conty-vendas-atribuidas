import { parentPort, workerData } from "node:worker_threads";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

// Uma conexão por thread no mesmo arquivo; todas largam juntas.
const { dbPath, route, body, flags } = workerData as { dbPath: string; route: string; body: unknown; flags: Int32Array };
const app = createApp(openDatabase(dbPath));
Atomics.add(flags, 1, 1);
Atomics.wait(flags, 0, 0);
const res = await app.request(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
parentPort?.postMessage(res.status);
