-- 示例 ER 图验证用：多表 + 外键关系
-- 在 PostgreSQL 中执行后，在对应 schema 右键「查看 ER 图」验证

-- 创建 schema
CREATE SCHEMA IF NOT EXISTS er_demo;

-- 1. 用户表
CREATE TABLE er_demo.users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 部门表
CREATE TABLE er_demo.departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  parent_id INTEGER REFERENCES er_demo.departments(id)
);

-- 3. 用户-部门关联（多对多中间表）
CREATE TABLE er_demo.user_departments (
  user_id INTEGER NOT NULL REFERENCES er_demo.users(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES er_demo.departments(id) ON DELETE CASCADE,
  role VARCHAR(50) DEFAULT 'member',
  PRIMARY KEY (user_id, department_id)
);

-- 4. 订单表
CREATE TABLE er_demo.orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES er_demo.users(id),
  order_no VARCHAR(32) NOT NULL UNIQUE,
  amount DECIMAL(12, 2) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. 订单明细表
CREATE TABLE er_demo.order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES er_demo.orders(id) ON DELETE CASCADE,
  product_name VARCHAR(200) NOT NULL,
  quantity INTEGER NOT NULL,
  price DECIMAL(12, 2) NOT NULL
);

-- 6. 产品表
CREATE TABLE er_demo.products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  category_id INTEGER
);

-- 7. 分类表
CREATE TABLE er_demo.categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  parent_id INTEGER REFERENCES er_demo.categories(id)
);

-- 产品关联分类
ALTER TABLE er_demo.products
  ADD CONSTRAINT fk_product_category
  FOREIGN KEY (category_id) REFERENCES er_demo.categories(id);

-- 插入测试数据
INSERT INTO er_demo.users (username, email) VALUES
  ('alice', 'alice@example.com'),
  ('bob', 'bob@example.com'),
  ('charlie', 'charlie@example.com');

INSERT INTO er_demo.departments (name, parent_id) VALUES
  ('技术部', NULL),
  ('产品部', NULL),
  ('前端组', 1),
  ('后端组', 1);

INSERT INTO er_demo.user_departments (user_id, department_id, role) VALUES
  (1, 1, 'lead'),
  (1, 3, 'member'),
  (2, 1, 'member'),
  (3, 2, 'member');

INSERT INTO er_demo.categories (name, parent_id) VALUES
  ('电子产品', NULL),
  ('图书', NULL),
  ('手机', 1),
  ('笔记本', 1);

INSERT INTO er_demo.products (name, category_id) VALUES
  ('iPhone 15', 3),
  ('MacBook Pro', 4),
  ('SQL 入门', 2);

INSERT INTO er_demo.orders (user_id, order_no, amount, status) VALUES
  (1, 'ORD001', 9999.00, 'paid'),
  (1, 'ORD002', 199.00, 'pending'),
  (2, 'ORD003', 12999.00, 'paid');

INSERT INTO er_demo.order_items (order_id, product_name, quantity, price) VALUES
  (1, 'iPhone 15', 1, 9999.00),
  (2, 'SQL 入门', 1, 199.00),
  (3, 'MacBook Pro', 1, 12999.00);
