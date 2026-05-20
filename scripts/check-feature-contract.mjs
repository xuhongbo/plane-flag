#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
}

function readPlaneFeatureSource() {
  const image = option("--backend-image") || process.env.PLANE_BACKEND_IMAGE;
  if (image) {
    return {
      label: `image:${image}:/code/plane/payment/flags/flag.py`,
      content: execFileSync("docker", ["run", "--rm", "--entrypoint", "cat", image, "/code/plane/payment/flags/flag.py"], {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      }),
    };
  }

  const file = option("--feature-flag-file") || process.env.PLANE_FEATURE_FLAG_FILE;
  if (!file) throw new Error("Set --backend-image <image> or --feature-flag-file <flag.py>.");
  const resolved = resolve(file);
  return { label: resolved, content: readFileSync(resolved, "utf8") };
}

function extractPlaneFlags(source) {
  const match = source.match(/class FeatureFlag\(Enum\):([\s\S]*?)(?:\nclass\s+\w+\(Enum\):|$)/);
  if (!match) throw new Error("Cannot locate class FeatureFlag(Enum).");

  const flags = [];
  const pattern = /^\s{4}([A-Z][A-Z0-9_]*)\s*=\s*["']([^"']+)["']/gm;
  for (const item of match[1].matchAll(pattern)) flags.push(item[2] || item[1]);
  return [...new Set(flags)].sort();
}

function extractTsFeatureValues(source) {
  const markerIndex = source.indexOf("featureValues");
  if (markerIndex === -1) throw new Error("Cannot locate featureValues in TypeScript source.");

  const objectStart = source.indexOf("{", markerIndex);
  if (objectStart === -1) throw new Error("Cannot locate featureValues object.");

  let depth = 0;
  let objectEnd = -1;
  for (let index = objectStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        objectEnd = index;
        break;
      }
    }
  }
  if (objectEnd === -1) throw new Error("Cannot locate featureValues object end.");

  const body = source.slice(objectStart + 1, objectEnd);
  const flags = [];
  const pattern = /^\s{4}([A-Z][A-Z0-9_]*)\s*:/gm;
  for (const item of body.matchAll(pattern)) flags.push(item[1]);
  return [...new Set(flags)].sort();
}

function readPrimeMonitorFlags() {
  const file = option("--prime-monitor-feature-file") || process.env.PRIME_MONITOR_FEATURE_FILE || "contract/prime-monitor-feature-values.json";
  if (!existsSync(file)) throw new Error(`Prime Monitor feature contract file not found: ${file}`);

  const resolved = resolve(file);
  const content = readFileSync(resolved, "utf8");
  if (extname(resolved) === ".ts") return { label: resolved, flags: extractTsFeatureValues(content) };

  const parsed = JSON.parse(content);
  if (Array.isArray(parsed)) return { label: resolved, flags: [...new Set(parsed.map(String))].sort() };
  if (parsed && typeof parsed === "object") {
    const values = parsed.values && typeof parsed.values === "object" ? parsed.values : parsed;
    return { label: resolved, flags: Object.keys(values).sort() };
  }
  throw new Error(`Unsupported Prime Monitor feature contract shape: ${resolved}`);
}

function writeOutputs(outDir, data) {
  mkdirSync(outDir, { recursive: true });
  for (const [name, value] of Object.entries(data)) {
    writeFileSync(resolve(outDir, name), JSON.stringify(value, null, 2) + "\n");
  }
}

function main() {
  const outDir = option("--out-dir") || process.env.OUT_DIR || "out";
  const planeSource = readPlaneFeatureSource();
  const planeFlags = extractPlaneFlags(planeSource.content);
  const primeMonitor = readPrimeMonitorFlags();
  const primeMonitorSet = new Set(primeMonitor.flags);
  const planeSet = new Set(planeFlags);
  const missing = planeFlags.filter((flag) => !primeMonitorSet.has(flag));
  const extra = primeMonitor.flags.filter((flag) => !planeSet.has(flag));

  writeOutputs(outDir, {
    "plane-feature-flags.json": planeFlags,
    "prime-monitor-feature-flags.json": primeMonitor.flags,
    "missing-feature-flags.json": missing,
    "extra-prime-monitor-feature-flags.json": extra,
    "suggested-feature-values.json": Object.fromEntries(missing.map((flag) => [flag, true])),
  });

  console.log(`Plane feature source: ${planeSource.label}`);
  console.log(`Prime Monitor contract: ${primeMonitor.label}`);
  console.log(`Plane FeatureFlag count: ${planeFlags.length}`);
  console.log(`Prime Monitor feature count: ${primeMonitor.flags.length}`);

  if (extra.length > 0) {
    console.log("\nExtra Prime Monitor flags not present in target Plane backend:");
    for (const flag of extra) console.log(`  + ${flag}`);
  }

  if (missing.length > 0) {
    console.error("\nMissing Prime Monitor flags for target Plane backend:");
    for (const flag of missing) console.error(`  - ${flag}`);
    console.error(`\nArtifacts written to ${outDir}. Sync missing flags into the self-hosted prime-monitor before upgrading Plane.`);
    process.exitCode = 1;
    return;
  }

  console.log("\nPrime Monitor contract covers the target Plane backend FeatureFlag enum.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
