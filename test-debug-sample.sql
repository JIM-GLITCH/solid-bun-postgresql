-- 存储过程调试测试样例
-- 1. 确保已安装 pldebugger: CREATE EXTENSION pldbgapi;
-- 2. 执行本文件创建测试函数
-- 3. 在侧边栏 Schema -> Functions 中右键该函数 -> 调试

-- 简单测试函数：计算斐波那契数列第 n 项
CREATE OR REPLACE FUNCTION test_fib(n integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  a integer := 0;
  b integer := 1;
  i integer := 1;
BEGIN
  IF n <= 0 THEN RETURN 0; END IF;
  IF n = 1 THEN RETURN 1; END IF;
  
  WHILE i < n LOOP
    b := a + b;   -- 可在此行设断点观察 a, b 变化
    a := b - a;
    i := i + 1;
  END LOOP;
  
  RETURN b;
END;
$$;

-- 带多个参数的测试函数
CREATE OR REPLACE FUNCTION test_greet(name text, times integer DEFAULT 1)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  result text := '';
  i integer := 0;
BEGIN
  WHILE i < times LOOP
    result := result || 'Hello, ' || name || '! ';
    i := i + 1;
  END LOOP;
  RETURN trim(result);
END;
$$;

-- 验证：调用测试
-- SELECT test_fib(5);        -- 应返回 5
-- SELECT test_greet('World', 2);  -- 应返回 'Hello, World! Hello, World!'
