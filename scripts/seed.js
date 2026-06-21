const { connectDatabase } = require("../src/config/database");
const { ensureDefaults } = require("../src/services/bootstrapService");

async function main() {
  await connectDatabase();
  await ensureDefaults();
  // eslint-disable-next-line no-console
  console.log("Seed complete.");
  process.exit(0);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
