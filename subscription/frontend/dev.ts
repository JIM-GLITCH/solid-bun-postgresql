import { $ } from "bun";

await $`bun --hot index.html`.cwd(import.meta.dir)