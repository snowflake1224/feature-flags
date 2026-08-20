import { PrismaClient, Prisma } from "@prisma/client";
import { bucket } from "@flagship/sdk";

const prisma = new PrismaClient();

// Deterministic SDK keys so the quickstart / SDK examples always work.
const PROD_SDK_KEY = "sdk-production-demo00000000";
const DEV_SDK_KEY = "sdk-development-demo0000000";

async function main() {
  console.log("Seeding Flagship demo data...");

  // Clean slate for the demo project.
  const existing = await prisma.project.findUnique({ where: { key: "demo" } });
  if (existing) await prisma.project.delete({ where: { id: existing.id } });

  const project = await prisma.project.create({
    data: {
      key: "demo",
      name: "Demo Project",
      environments: {
        create: [
          { key: "production", name: "Production", production: true, color: "#ef4444" },
          { key: "development", name: "Development", production: false, color: "#22c55e" },
        ],
      },
    },
    include: { environments: true },
  });

  const prod = project.environments.find((e) => e.key === "production")!;
  const dev = project.environments.find((e) => e.key === "development")!;

  await prisma.sdkKey.createMany({
    data: [
      { environmentId: prod.id, key: PROD_SDK_KEY, kind: "server" },
      { environmentId: dev.id, key: DEV_SDK_KEY, kind: "server" },
    ],
  });

  // --- Segment: beta users ---
  const betaSalt = "betasalt00000000";
  for (const env of project.environments) {
    await prisma.segment.create({
      data: {
        projectId: project.id,
        environmentId: env.id,
        key: "beta-users",
        name: "Beta Users",
        description: "Internal + opted-in beta testers",
        included: ["user-beta-1", "user-beta-2", "user-beta-3"],
        excluded: [],
        rules: [
          { clauses: [{ attribute: "email", op: "endsWith", values: ["@flagship.dev"] }] },
        ] as Prisma.InputJsonValue,
        salt: betaSalt,
      },
    });
  }

  // --- Flag: new-checkout (boolean, 20% rollout in prod, targets beta) ---
  const checkoutSalt = "checkoutsalt00000";
  await prisma.flag.create({
    data: {
      projectId: project.id,
      key: "new-checkout",
      name: "New Checkout Flow",
      description: "Gradual rollout of the redesigned checkout",
      kind: "boolean",
      variations: [true, false] as Prisma.InputJsonValue,
      tags: ["release", "checkout"],
      configs: {
        create: [
          {
            environmentId: prod.id,
            on: true,
            offVariation: 1,
            fallthrough: {
              rollout: {
                variations: [
                  { variation: 0, weight: 20 },
                  { variation: 1, weight: 80 },
                ],
              },
            } as Prisma.InputJsonValue,
            targets: [] as Prisma.InputJsonValue,
            rules: [
              {
                id: "beta-on",
                description: "Beta users always get new checkout",
                clauses: [{ attribute: "", op: "segmentMatch", values: ["beta-users"] }],
                variation: 0,
              },
            ] as Prisma.InputJsonValue,
            prerequisites: [] as Prisma.InputJsonValue,
            salt: checkoutSalt,
          },
          {
            environmentId: dev.id,
            on: true,
            offVariation: 1,
            fallthrough: { variation: 0 } as Prisma.InputJsonValue,
            targets: [] as Prisma.InputJsonValue,
            rules: [] as Prisma.InputJsonValue,
            prerequisites: [] as Prisma.InputJsonValue,
            salt: checkoutSalt,
          },
        ],
      },
    },
  });

  // --- Flag: pricing-experiment (string, 50/50, drives an experiment) ---
  const pricingSalt = "pricingsalt000000";
  const pricingVariations = ["control", "variant"];
  await prisma.flag.create({
    data: {
      projectId: project.id,
      key: "pricing-experiment",
      name: "Pricing Page Experiment",
      description: "A/B test two pricing layouts",
      kind: "string",
      variations: pricingVariations as Prisma.InputJsonValue,
      tags: ["experiment", "pricing"],
      configs: {
        create: project.environments.map((env) => ({
          environmentId: env.id,
          on: true,
          offVariation: 0,
          fallthrough: {
            rollout: {
              variations: [
                { variation: 0, weight: 50 },
                { variation: 1, weight: 50 },
              ],
            },
          } as Prisma.InputJsonValue,
          targets: [] as Prisma.InputJsonValue,
          rules: [] as Prisma.InputJsonValue,
          prerequisites: [] as Prisma.InputJsonValue,
          salt: pricingSalt,
        })),
      },
    },
  });

  // --- Experiment on pricing-experiment ---
  await prisma.experiment.create({
    data: {
      projectId: project.id,
      environmentId: prod.id,
      key: "pricing-ab",
      name: "Pricing Layout A/B",
      flagKey: "pricing-experiment",
      exposureEvent: "pricing_viewed",
      goalEvent: "subscribed",
      metricKind: "binary",
    },
  });

  // --- Synthetic events: exposures + conversions with a real uplift ---
  // control converts ~10%, variant ~14% -> should show a positive uplift.
  const N = 4000;
  const events: Prisma.EventCreateManyInput[] = [];
  const now = Date.now();
  for (let i = 0; i < N; i++) {
    const contextKey = `user-${i}`;
    const point = bucket("pricing-experiment", pricingSalt, contextKey);
    const variationIndex = point < 0.5 ? 0 : 1;
    // exposure
    events.push({
      environmentId: prod.id,
      eventKey: "pricing_viewed",
      contextKey,
      flagKey: "pricing-experiment",
      variationIndex,
      ts: new Date(now - Math.random() * 7 * 864e5),
    });
    // conversion
    const convRate = variationIndex === 0 ? 0.1 : 0.14;
    if (Math.random() < convRate) {
      events.push({
        environmentId: prod.id,
        eventKey: "subscribed",
        contextKey,
        flagKey: "pricing-experiment",
        variationIndex,
        value: variationIndex === 0 ? 19 : 19,
        ts: new Date(now - Math.random() * 7 * 864e5),
      });
    }
  }
  // Insert in chunks to stay under parameter limits.
  for (let i = 0; i < events.length; i += 1000) {
    await prisma.event.createMany({ data: events.slice(i, i + 1000) });
  }

  console.log(`Seeded project "demo" with 2 flags, 1 segment, 1 experiment, ${events.length} events.`);
  console.log(`  Production SDK key:  ${PROD_SDK_KEY}`);
  console.log(`  Development SDK key: ${DEV_SDK_KEY}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
