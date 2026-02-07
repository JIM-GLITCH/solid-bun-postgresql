import { test } from "vitest";
import { connectPostgres } from "./connect-postgres";
import { SQL } from "bun";

test("tryPostgres", async () => {
    const client = await connectPostgres({
        host: "localhost",
        port: "5432",
        username: "postgres",
        password: "secret",
        database: "mydb",
    });
    const res = await client.query({ text: "select 1+1 , 2+2 ", rowMode: "array" });

    console.log(res);
});

test("tryPostgres2", async () => {
    const client = await new SQL({
        host: "localhost",
        port: "5432",
        username: "postgres",
        password: "secret",
        database: "mydb",
    });
    const res = await client.unsafe(`select 1+1 as a  , 2+2 as a `);

    console.log(res);
});
