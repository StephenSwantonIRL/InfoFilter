const { connectDatabase } = require("./config/database");
const env = require("./config/env");
const { createApp } = require("./app");
const { ensureDefaults, scheduleUpdater } = require("./services/bootstrapService");

async function start() {
  await connectDatabase();
  await ensureDefaults();
  scheduleUpdater();

  const app = createApp();
  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`${env.appName} listening on ${env.port}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
