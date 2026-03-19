import { $ } from "bun";
import { join } from "path";

import("./vscode-extension/build")
await $`vsce publish`.cwd(join(import.meta.dir,"vscode-extension"))