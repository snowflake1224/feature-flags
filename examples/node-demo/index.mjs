// Minimal Node.js example. Run the backend + seed first, then:
//   node examples/node-demo/index.mjs
import { FlagshipClient } from "@flagship/sdk";

const client = new FlagshipClient({
  sdkKey: process.env.SDK_KEY || "sdk-production-demo00000000",
  baseUrl: process.env.API_URL || "http://localhost:4000",
  mode: "streaming",
});

await client.start();

const users = [
  { key: "user-1", country: "US", email: "a@example.com" },
  { key: "user-beta-1", country: "DE", email: "b@flagship.dev" },
  { key: "user-42", country: "FR" },
];

for (const u of users) {
  const checkout = client.boolVariation("new-checkout", u, false);
  const pricing = client.stringVariation("pricing-experiment", u, "control");
  console.log(`${u.key.padEnd(12)} new-checkout=${checkout}  pricing=${pricing}`);
  // record an experiment exposure + a random conversion
  await client.track("pricing_viewed", u, { flagKey: "pricing-experiment" });
  if (Math.random() < 0.12) await client.track("subscribed", u, { flagKey: "pricing-experiment", value: 19 });
}

console.log("\nStreaming for changes — flip the kill switch in the dashboard to see updates.");
client.onChange(() => console.log("[dataset updated] new-checkout =", client.boolVariation("new-checkout", users[0], false)));

// keep alive for a bit to observe streaming updates
setTimeout(() => client.close(), 60_000);
