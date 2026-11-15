const fs = require("node:fs");
const path = require("node:path");
const { getSchema } = require("../server");

const root = path.join(__dirname, "..");
const output = path.join(root, "dist");

async function main() {
  const schema = await getSchema();
  fs.rmSync(output, { recursive: true, force: true });
  fs.cpSync(path.join(root, "public"), output, { recursive: true });
  fs.writeFileSync(path.join(output, "schema.json"), JSON.stringify(schema));
  fs.writeFileSync(path.join(output, ".nojekyll"), "");
  console.log(`Built static site: ${schema.tables.length} tables, ${schema.relationships.length} relationships.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Static build failed:", error.message);
  process.exit(1);
});
