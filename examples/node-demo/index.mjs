// Minimal Node.js example. Run the backend + seed first, then:
//   node examples/node-demo/index.mjs
import { FlagshipClient } from "@flagship/sdk";

const client = new FlagshipClient({
  sdkKey: process.env.SDK_KEY || "sdk-production-demo00000000",
  baseUrl: process.env.API_URL || "http://localhost:4000",
  pollingIntervalMs: 3_000,
});

await client.start();

const users = [
  { key: "user-1", email: "a@example.com" },
  { key: "user-2", email: "ada@flagship.dev" },
  { key: "user-42" },
];

for (const u of users) {
  console.log(`${u.key.padEnd(10)} new-checkout=${client.boolVariation("new-checkout", u, false)}`);
}

console.log("\nPolling every 3s. Flip new-checkout in the dashboard; it shows up on the next fetch.");
client.onChange(() =>
  console.log("[flag set changed] user-2 new-checkout =", client.boolVariation("new-checkout", users[1], false)),
);

setTimeout(() => client.close(), 60_000);
