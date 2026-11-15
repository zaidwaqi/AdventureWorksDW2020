const fs = require("node:fs");
const path = require("node:path");
const { getSchema } = require("../server");

async function main() {
  const schema = await getSchema();
  const target = path.join(__dirname, "..", "public", "schema.json");
  fs.writeFileSync(target, `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`Wrote ${target}: ${schema.tables.length} tables, ${schema.relationships.length} relationships.`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Schema extraction failed:", error.message);
  process.exit(1);
});
