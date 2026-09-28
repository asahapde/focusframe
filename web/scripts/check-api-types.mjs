// Fails if src/lib/api/schema.gen.ts is out of date with contract/openapi.json.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ff-api-"));
const fresh = join(dir, "schema.gen.ts");
try {
  execFileSync(
    process.execPath,
    ["node_modules/openapi-typescript/bin/cli.js", "../contract/openapi.json", "-o", fresh],
    { stdio: "ignore" },
  );
  const normalize = (s) => s.replace(/\r\n/g, "\n");
  const committed = normalize(readFileSync("src/lib/api/schema.gen.ts", "utf8"));
  if (committed !== normalize(readFileSync(fresh, "utf8"))) {
    console.error("src/lib/api/schema.gen.ts is stale. Run `npm run gen:api`.");
    process.exit(1);
  }
  console.log("API types match contract/openapi.json");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
