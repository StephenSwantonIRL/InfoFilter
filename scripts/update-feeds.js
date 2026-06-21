const { connectDatabase } = require("../src/config/database");
const User = require("../src/models/User");
const { refreshAllFeedsForUser } = require("../src/services/feedService");

async function main() {
  await connectDatabase();
  const users = await User.find();
  for (const user of users) {
    await refreshAllFeedsForUser(user._id);
  }
  // eslint-disable-next-line no-console
  console.log("Feed refresh complete.");
  process.exit(0);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
