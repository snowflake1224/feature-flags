import { PrismaClient, Prisma } from "@prisma/client";
import { bucket } from "@flagship/sdk";

const prisma = new PrismaClient();

// Deterministic SDK keys so the quickstart / SDK examples always work.
const PROD_SDK_KEY = "sdk-production-demo00000000";
const DEV_SDK_KEY = "sdk-development-demo0000000";

const CHECKOUT_SALT = "checkoutsalt00000";
const ROLLOUT_PERCENT = 20;

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

  // new-checkout: 20% sticky rollout in prod, plus one audience rule.
  const flag = await prisma.flag.create({
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
                  { variation: 0, weight: ROLLOUT_PERCENT },
                  { variation: 1, weight: 100 - ROLLOUT_PERCENT },
                ],
              },
            } as Prisma.InputJsonValue,
            targets: [] as Prisma.InputJsonValue,
            rules: [
              {
                id: "staff-email",
                description: "Staff emails always get the new checkout",
                clauses: [{ attribute: "email", op: "endsWith", values: ["@flagship.dev"] }],
                variation: 0,
              },
            ] as Prisma.InputJsonValue,
            prerequisites: [] as Prisma.InputJsonValue,
            salt: CHECKOUT_SALT,
          },
          {
            environmentId: dev.id,
            on: true,
            offVariation: 1,
            fallthrough: { variation: 0 } as Prisma.InputJsonValue,
            targets: [] as Prisma.InputJsonValue,
            rules: [] as Prisma.InputJsonValue,
            prerequisites: [] as Prisma.InputJsonValue,
            salt: CHECKOUT_SALT,
          },
        ],
      },
    },
  });

  await prisma.auditLog.create({
    data: {
      projectId: project.id,
      actor: "seed",
      action: "flag.created",
      entityType: "flag",
      entityId: flag.id,
      entityKey: flag.key,
      comment: "demo seed",
      after: { key: flag.key, kind: flag.kind, rolloutPercent: ROLLOUT_PERCENT },
    },
  });

  // Pick one example key inside and one outside the rollout using the same
  // hash the engine uses, so the demo instructions stay true after reseeding.
  const candidates = ["sam-public", "nina-public", "omar-public", "priya-public", "chen-public", "noah-public"];
  const rolloutIn = candidates.find((key) => bucket("new-checkout", CHECKOUT_SALT, key) < ROLLOUT_PERCENT / 100);
  const rolloutOut = candidates.find((key) => bucket("new-checkout", CHECKOUT_SALT, key) >= ROLLOUT_PERCENT / 100);

  console.log(`Seeded project "demo" with flag new-checkout (${ROLLOUT_PERCENT}% rollout + staff email rule).`);
  console.log(`  Production SDK key:  ${PROD_SDK_KEY}`);
  console.log(`  Development SDK key: ${DEV_SDK_KEY}`);
  console.log("  Rule match:          any email ending in @flagship.dev");
  if (rolloutIn) console.log(`  Rollout in:          ${rolloutIn}`);
  if (rolloutOut) console.log(`  Rollout out:         ${rolloutOut}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
