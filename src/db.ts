import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS creators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creators(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  status TEXT NOT NULL,
  coupon TEXT,
  utm_content TEXT,
  creator_id TEXT,
  rule TEXT NOT NULL,
  coupon_creator_id TEXT,
  utm_creator_id TEXT,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  state TEXT NOT NULL CHECK (state IN ('pending', 'applied', 'rejected')),
  reason TEXT,
  received_at TEXT NOT NULL,
  resolved_at TEXT
);
`;

export function openDatabase(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

// Criadores e cupons do demo e dos testes.
export function seedCreators(db: DatabaseSync): void {
  db.exec(`
    INSERT OR IGNORE INTO creators (id, name) VALUES ('crt_ana', 'Ana'), ('crt_bruno', 'Bruno');
    INSERT OR IGNORE INTO coupons (code, creator_id) VALUES ('ANA10', 'crt_ana'), ('BRUNO10', 'crt_bruno');
  `);
}
