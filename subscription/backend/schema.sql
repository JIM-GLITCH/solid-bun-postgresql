-- DB Player 订阅系统建表 SQL
-- 在 RDS PostgreSQL 中执行一次

CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  email      TEXT,
  name       TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_identities (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL,
  provider         TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  plan       TEXT NOT NULL DEFAULT 'monthly',
  status     TEXT NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_orders (
  id                 SERIAL PRIMARY KEY,
  order_no           TEXT NOT NULL UNIQUE,
  user_id            INTEGER NOT NULL,
  plan               TEXT NOT NULL,
  amount             INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',
  payment_method     TEXT,
  payment_trade_no   TEXT,
  paid_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
