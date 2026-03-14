-- DB Player 订阅系统 - 数据库表结构
-- PostgreSQL

-- 用户表
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255),
  name VARCHAR(255),
  avatar_url VARCHAR(512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 第三方身份（GitHub / Google / Microsoft）
CREATE TABLE user_identities (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  provider VARCHAR(32) NOT NULL,
  provider_user_id VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_user_id)
);

CREATE INDEX idx_user_identities_lookup ON user_identities(provider, provider_user_id);

-- 订阅表
CREATE TABLE subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  plan VARCHAR(32) NOT NULL DEFAULT 'pro',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);

-- 订单表
CREATE TABLE payment_orders (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  subscription_id BIGINT,
  order_no VARCHAR(64) UNIQUE NOT NULL,
  payment_method VARCHAR(32),
  payment_trade_no VARCHAR(64),
  amount INT NOT NULL,
  plan VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_orders_order_no ON payment_orders(order_no);
CREATE INDEX idx_payment_orders_user_id ON payment_orders(user_id);
