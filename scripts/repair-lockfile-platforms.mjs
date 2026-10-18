import { readFileSync, writeFileSync } from "node:fs";

const lockPath = "package-lock.json";
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const packages = lock.packages;

function existingKey(parent, dep) {
  const nested = `${parent}/node_modules/${dep}`;
  const hoisted = `node_modules/${dep}`;
  if (packages[nested]) return nested;
  if (packages[hoisted]) return hoisted;
  return null;
}

function destination(parent, dep) {
  const hoisted = `node_modules/${dep}`;
  if (!packages[hoisted]) return hoisted;
  return `${parent}/node_modules/${dep}`;
}

function satisfies(version, range) {
  if (!range.startsWith("~")) return version === range;
  const [major, minor] = range.slice(1).split(".");
  const [vMajor, vMinor] = version.split(".");
  return major === vMajor && minor === vMinor;
}

async function resolveVersion(name, range) {
  if (!range.startsWith("~") && !range.startsWith("^")) return range;
  const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}`);
  if (!response.ok) throw new Error(`registry ${name}: ${response.status}`);
  const packument = await response.json();
  const versions = Object.keys(packument.versions).filter((version) => satisfies(version, range));
  if (versions.length === 0) throw new Error(`no version of ${name} satisfies ${range}`);
  return versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
}

async function metadata(name, version) {
  const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}/${version}`);
  if (!response.ok) throw new Error(`registry ${name}@${version}: ${response.status}`);
  const pkg = await response.json();
  const entry = { version, optional: true };
  if (pkg.cpu) entry.cpu = pkg.cpu;
  if (pkg.license) entry.license = pkg.license;
  if (pkg.os) entry.os = pkg.os;
  if (pkg.libc) entry.libc = pkg.libc;
  if (pkg.engines) entry.engines = pkg.engines;
  return entry;
}

const missing = [];
for (const [parent, pkg] of Object.entries(packages)) {
  for (const [dep, range] of Object.entries(pkg.optionalDependencies ?? {})) {
    if (!existingKey(parent, dep)) missing.push({ parent, dep, range, dev: pkg.dev === true });
  }
}

for (const item of missing) {
  const version = await resolveVersion(item.dep, item.range);
  const key = destination(item.parent, item.dep);
  if (packages[key]) continue;
  const entry = await metadata(item.dep, version);
  if (item.dev) entry.dev = true;
  packages[key] = entry;
  console.log(`added ${key}@${version}`);
}

writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
