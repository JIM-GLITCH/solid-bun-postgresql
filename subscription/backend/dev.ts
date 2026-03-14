import { $ } from "bun";

await $`bun --hot src/index.ts`.cwd(import.meta.dir)