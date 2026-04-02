import { describe, test, expect } from "bun:test";
import { convertMysqlExplainJsonToPlanNode, isMysqlExplainJsonRoot } from "./mysql-explain-json";

describe("mysql explain json", () => {
  test("isMysqlExplainJsonRoot", () => {
    expect(isMysqlExplainJsonRoot({ query_block: { select_id: 1 } })).toBe(true);
    expect(isMysqlExplainJsonRoot({ Plan: { Node_Type: "Seq Scan" } })).toBe(false);
  });

  test("convert nested_loop + table", () => {
    const root = {
      query_block: {
        select_id: 1,
        cost_info: { query_cost: "2.50" },
        nested_loop: [
          {
            table: {
              table_name: "users",
              access_type: "ALL",
              rows_examined_per_scan: 100,
              filtered: "10.00",
            },
          },
        ],
      },
    };
    const plan = convertMysqlExplainJsonToPlanNode(root);
    expect(plan["Node Type"]).toContain("Query Block");
    expect(plan.Plans?.length).toBe(1);
    expect(plan.Plans?.[0]["Node Type"]).toContain("ALL");
    expect(plan.Plans?.[0]["Node Type"]).toContain("users");
    expect(plan.Plans?.[0]["Plan Rows"]).toBe(100);
  });
});
