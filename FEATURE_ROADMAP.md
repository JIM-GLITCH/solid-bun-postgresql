# DB Player 功能 roadmap（竞争力提升清单）

> 完成后在行首加 `✅` 即可

## 一、高优先级 - 补齐基础能力

- ✅ **1. 查询历史 + 搜索** - 保存最近 500–1000 条查询，支持按内容/时间搜索、一键复用 *(Antares、DBCode、Database Client)*
- ✅ **2. SSH 隧道** - 连接远程 PostgreSQL 时支持 SSH 跳板，适配云库和私有网络 *(Antares、DBView)*
- ✅ **3. 导入 / 导出** - CSV/JSON/Excel导入，查询结果导出为 CSV/JSON/Excel *(Antares、Database Client)*
- ✅ **4. 假数据生成** - 按表结构生成测试数据（姓名、日期、数字等） *(Antares、Database Client)*

---

## 二、中优先级 - 增强专业度与差异化

- ✅ **5. EXPLAIN ANALYZE 可视化** - 执行计划树形展示、成本/耗时高亮 *(DBCode)*
- ✅ **6. ER 图** - 按 schema 自动生成 ER 图，可交互浏览表关系 *(DBCode、DBView)*
- ✅ **7. SQL 格式化** - 一键格式化 SQL，可配置缩进、关键字大小写等 *(Antares、DBCode)*
- ✅ **8. 连接管理增强** - 保存多个连接配置、连接分组、快速切换 *(各竞品基础能力)*
 - ✅ **9. 数据库 / Schema 备份** - 导出全库或指定 schema 的 SQL dump *(Antares、Database Client)*

---

## 三、长期投入 - 拉开差距

- **10. AI 辅助写 SQL** - 自然语言 → SQL，或 SQL 补全 / 优化建议（Copilot、Claude API 等） *(DBCode)*
- **11. SQL Notebook** - 多段 SQL + Markdown 混排，可分段执行、保存为文档 *(DBCode)*
- **12. 查询结果可视化** - 结果集转柱状图、折线图、饼图等 *(DBCode)*
- **13. 多数据库支持（可选）** - 若希望扩大受众，可考虑先支持 SQLite / MySQL *(与 Antares、Database Client 对标)*

---

## 四、PostgreSQL 专项 - 强化 PG 定位

- **14. JSONB 编辑器** - JSON/JSONB 列可视化编辑，支持树形/表单两种模式
- **15. 分区表管理** - 查看分区结构、分区裁剪预览
- **16. 扩展管理** - 查看已安装扩展、版本、简要说明
- **17. pg_stat 监控视图** - 展示慢查询、锁等待、连接数等（可选简单图表）

---

## 五、实施批次建议


| 批次  | 时间预估   | 功能项                          |
| --- | ------ | ---------------------------- |
| 第一批 | 1–2 周  | 查询历史 + 搜索 ✓、SQL 格式化、连接管理增强   |
| 第二批 | 2–4 周  | 导入/导出 CSV、SSH 隧道、EXPLAIN 可视化 |
| 第三批 | 1–2 个月 | 假数据生成、ER 图、数据库备份             |
| 第四批 | 按需求    | AI 辅助、JSONB 编辑器、多数据库支持       |


