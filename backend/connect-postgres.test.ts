import { test } from "vitest";
import { connectPostgres, getDbConfig } from "./connect-postgres";
import { SQL } from "bun";

test("tryPostgres", {timeout: Infinity},async () => {
    const db = await getDbConfig({
        host: "postgres",
        port: "5432",
        username: "postgres",
        password: "secret",
        database: "mydb",
        sshHost:"localhost",
        sshPort:"5022",
        sshUsername:"root",
        sshPassword:"root",
        sshEnabled:true
    });
    const client = await connectPostgres(db);
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
