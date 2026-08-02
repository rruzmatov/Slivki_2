import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

const sourceRoot = path.resolve(__dirname, "../../../src/rpg");

test("Application and Domain do not depend on GameState or Infrastructure", async () => {
  const files = await sourceFiles();
  const violations: string[] = [];
  for (const file of files.filter((candidate) => isWithin(candidate, "application") || isWithin(candidate, "domain"))) {
    const source = await fs.readFile(file, "utf8");
    if (/\bGameState\b/.test(source)) violations.push(`${relative(file)} imports or references GameState`);
    for (const dependency of importsOf(file, source)) {
      if (isWithin(file, "domain") && dependency.includes("/infrastructure/")) {
        violations.push(`${relative(file)} imports Infrastructure`);
      }
      if (isWithin(file, "domain") && dependency.includes("/application/")) {
        violations.push(`${relative(file)} imports Application`);
      }
      if (isWithin(file, "application") && dependency.includes("/infrastructure/")) {
        violations.push(`${relative(file)} imports Infrastructure`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("Telegram layer does not depend on Repository ports or adapters", async () => {
  const violations: string[] = [];
  for (const file of (await sourceFiles()).filter((candidate) => isWithin(candidate, "bot"))) {
    const source = await fs.readFile(file, "utf8");
    for (const dependency of importsOf(file, source)) {
      if (dependency.includes("/ports/") || dependency.includes("/repositories/") || dependency.includes("/infrastructure/")) {
        violations.push(`${relative(file)} imports ${relative(dependency)}`);
      }
    }
    if (/\b[A-Za-z]+Repository\b/.test(source)) violations.push(`${relative(file)} references a Repository`);
  }
  assert.deepEqual(violations, []);
});

test("EventBus and application services are composed only by the Composition Root", async () => {
  const violations: string[] = [];
  for (const file of (await sourceFiles()).filter((candidate) => !isWithin(candidate, "tests"))) {
    const source = await fs.readFile(file, "utf8");
    for (const dependency of newExpressions(source)) {
      if (dependency === "EventBus" && relative(file) !== "bootstrap/composition-root.ts") {
        violations.push(`${relative(file)} creates EventBus`);
      }
      if (dependency.endsWith("Service") && !isWithin(file, "bootstrap") && !source.includes(`class ${dependency}`)) {
        violations.push(`${relative(file)} creates ${dependency}`);
      }
      if (["OwnershipPermissionRegistry", "VehicleCapabilityRegistry", "VehicleEnergyTypeRegistry"].includes(dependency) &&
        relative(file) !== "bootstrap/composition-root.ts") {
        violations.push(`${relative(file)} creates ${dependency}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("Transport foundation has no hard category branches or forbidden bounded-context dependencies", async () => {
  const transportFiles = (await sourceFiles()).filter((candidate) =>
    !isWithin(candidate, "tests") &&
    (path.basename(candidate).startsWith("transport-") || path.basename(candidate) === "transport.ts")
  );
  const violations: string[] = [];
  const categoryLiterals = [
    "bicycle", "motorcycle", "car", "truck", "bus", "train", "airplane", "helicopter", "ship", "yacht", "boat"
  ];
  const forbiddenImports = ["telegram", "marketplace", "achievement-service", "economy-repository"];

  for (const file of transportFiles) {
    const source = await fs.readFile(file, "utf8");
    for (const dependency of importsOf(file, source)) {
      if (forbiddenImports.some((forbidden) => dependency.toLocaleLowerCase().includes(forbidden))) {
        violations.push(`${relative(file)} imports forbidden dependency ${relative(dependency)}`);
      }
    }
    for (const category of categoryLiterals) {
      const hardCheck = new RegExp(`(?:===|!==|case\\s+)[\\s]*["']${category}["']`);
      if (hardCheck.test(source)) violations.push(`${relative(file)} hard-codes category ${category}`);
    }
    if (/\b(?:ride|drive|fly|sail|cargo|delivery)\b\s*(?:===|!==)/.test(source)) {
      violations.push(`${relative(file)} hard-codes a capability decision`);
    }
    if (/\bfile_id\b/.test(source)) violations.push(`${relative(file)} stores Telegram file_id`);
  }
  assert.deepEqual(violations, []);
});

test("Transport foundation keeps ownership permissions and owner data outside vehicle contracts", async () => {
  const domainFiles = [
    path.join(sourceRoot, "domain", "transport.ts"),
    path.join(sourceRoot, "domain", "transport-registry.ts")
  ];
  const violations: string[] = [];
  for (const file of domainFiles) {
    const source = await fs.readFile(file, "utf8");
    if (/\bOwnershipPermission\b/.test(source)) violations.push(`${relative(file)} stores ownership permissions`);
    if (/\b(?:owner|tenant|lease)\s*[?:]/i.test(source)) violations.push(`${relative(file)} stores ownership state`);
  }
  assert.deepEqual(violations, []);
});

test("Transport Phase 1 DTO contracts live outside Domain", async () => {
  const domainSource = await fs.readFile(path.join(sourceRoot, "domain", "transport.ts"), "utf8");
  const applicationSource = await fs.readFile(
    path.join(sourceRoot, "application", "contracts", "transport-foundation.ts"),
    "utf8"
  );
  for (const name of ["TransportApiEnvelope", "VehicleCapabilityDto", "VehicleEnergyDto", "VehicleFoundationDto"]) {
    assert.equal(domainSource.includes(name), false, `${name} remains in Domain`);
    assert.equal(applicationSource.includes(name), true, `${name} is missing from Application contracts`);
  }
});

test("Transport Phase 2 is a pure category-neutral Domain", async () => {
  const phaseTwoFiles = [
    "transport-condition.ts",
    "transport-domain-validation.ts",
    "transport-eligibility.ts",
    "transport-maintenance.ts",
    "transport-mileage.ts",
    "transport-pricing.ts",
    "transport-repair.ts",
    "transport-state-machine.ts",
    "transport-usage.ts",
    "transport-vehicle.ts"
  ].map((name) => path.join(sourceRoot, "domain", name));
  const violations: string[] = [];
  const forbiddenTerms = [
    "GameState", "Repository", "Scheduler", "UnitOfWork", "CompositionRoot", "EventBus",
    "Telegram", "Telegraf", "PostgreSQL", "JsonGameDatabase"
  ];
  const concreteCategories = [
    "bicycle", "motorcycle", "car", "truck", "bus", "train", "airplane", "helicopter", "ship", "yacht", "boat"
  ];

  for (const file of phaseTwoFiles) {
    const source = await fs.readFile(file, "utf8");
    for (const dependency of importsOf(file, source)) {
      if (dependency.includes("/application/") || dependency.includes("/infrastructure/") || dependency.includes("/bot/")) {
        violations.push(`${relative(file)} imports ${relative(dependency)}`);
      }
    }
    for (const term of forbiddenTerms) {
      if (new RegExp(`\\b${term}\\b`).test(source)) violations.push(`${relative(file)} references ${term}`);
    }
    for (const category of concreteCategories) {
      if (new RegExp(`["']${category}["']`).test(source)) violations.push(`${relative(file)} hard-codes ${category}`);
    }
    if (/bike_giant_escape_3|\bnew\s+(?:Error|DomainError)\s*\(/.test(source)) {
      violations.push(`${relative(file)} contains model-specific code or a manual error`);
    }
    if (/\b(?:interface|type|class)\s+[A-Za-z0-9_]*(?:Dto|ApiEnvelope)\b/.test(source)) {
      violations.push(`${relative(file)} declares a DTO or API envelope`);
    }
    if (/\bDate\.now\s*\(/.test(source)) violations.push(`${relative(file)} reads the system clock`);
  }

  const vehicleSource = await fs.readFile(path.join(sourceRoot, "domain", "transport-vehicle.ts"), "utf8");
  const stateBody = interfaceBody(vehicleSource, "VehicleState");
  if (/\b(?:owner|tenant|permission)\s*[?:]/i.test(stateBody)) {
    violations.push("domain/transport-vehicle.ts stores ownership or permission data in VehicleState");
  }
  assert.deepEqual(violations, []);
});

test("Every Repository port exposes Promise-based methods", async () => {
  const violations: string[] = [];
  for (const file of (await sourceFiles()).filter((candidate) => isWithin(candidate, "application") || isWithin(candidate, "domain"))) {
    const source = await fs.readFile(file, "utf8");
    for (const contract of repositoryContracts(source)) {
      for (const member of splitInterfaceMembers(contract.body)) {
        const signature = member.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*\([\s\S]*\)\s*:\s*([\s\S]+)$/);
        if (signature && !signature[2].trim().startsWith("Promise<")) {
          violations.push(`${relative(file)}:${contract.name}.${signature[1]} is not async`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("Application orchestrators do not bypass Inventory, Ownership or Shop services", async () => {
  const files = [
    path.join(sourceRoot, "application", "game-services-v2.ts"),
    path.join(sourceRoot, "application", "admin-service-v2.ts"),
    path.join(sourceRoot, "bootstrap", "composition-root.ts")
  ];
  const violations: string[] = [];
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    for (const match of source.matchAll(/\b(?:context|scope)\.(inventory|ownership|shop)\.[A-Za-z][A-Za-z0-9_]*/g)) {
      violations.push(`${relative(file)} calls ${match[0]} directly`);
    }
  }
  assert.deepEqual(violations, []);
});

test("RPG production modules have no circular relative imports", async () => {
  const files = (await sourceFiles()).filter((candidate) => !isWithin(candidate, "tests"));
  const fileSet = new Set(files.map(normalize));
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    graph.set(normalize(file), importsOf(file, source)
      .map((candidate) => resolveModule(candidate, fileSet))
      .filter((value): value is string => Boolean(value)));
  }
  const cycle = findCycle(graph);
  if (cycle) assert.fail(`Circular dependency: ${cycle.map(relative).join(" -> ")}`);
});

async function sourceFiles(directory = sourceRoot): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".ts") ? [fullPath] : [];
  }));
  return nested.flat().sort();
}

function importsOf(file: string, source: string): string[] {
  const imports: string[] = [];
  const declaration = /^(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["'];/gm;
  for (const match of source.matchAll(declaration)) {
    const specifier = match[1];
    if (specifier.startsWith(".")) imports.push(normalize(path.resolve(path.dirname(file), specifier)));
  }
  return imports;
}

function resolveModule(candidate: string, files: ReadonlySet<string>): string | undefined {
  const candidates = candidate.endsWith(".ts") ? [candidate] : [`${candidate}.ts`, path.join(candidate, "index.ts")];
  return candidates.find((value) => files.has(normalize(value)));
}

function newExpressions(source: string): string[] {
  return [...source.matchAll(/\bnew\s+([A-Z][A-Za-z0-9_]*)\s*\(/g)].map((match) => match[1]);
}

function repositoryContracts(source: string): Array<{ name: string; body: string }> {
  const contracts: Array<{ name: string; body: string }> = [];
  const declaration = /export\s+interface\s+([A-Za-z][A-Za-z0-9_]*Repository)(?:<[^>{}]+>)?\s*\{/g;
  for (const match of source.matchAll(declaration)) {
    const bodyStart = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let cursor = bodyStart;
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === "{") depth += 1;
      if (source[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    contracts.push({ name: match[1], body: source.slice(bodyStart, cursor - 1) });
  }
  return contracts;
}

function interfaceBody(source: string, name: string): string {
  const declaration = new RegExp(`export\\s+interface\\s+${name}\\s*\\{`).exec(source);
  if (!declaration || declaration.index === undefined) return "";
  const bodyStart = declaration.index + declaration[0].length;
  let depth = 1;
  let cursor = bodyStart;
  while (cursor < source.length && depth > 0) {
    if (source[cursor] === "{") depth += 1;
    if (source[cursor] === "}") depth -= 1;
    cursor += 1;
  }
  return source.slice(bodyStart, cursor - 1);
}

function splitInterfaceMembers(body: string): string[] {
  const members: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "{" || character === "(" || character === "[") depth += 1;
    if (character === "}" || character === ")" || character === "]") depth -= 1;
    if (character === ";" && depth === 0) {
      members.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  return members.filter(Boolean);
}

function findCycle(graph: ReadonlyMap<string, readonly string[]>): string[] | undefined {
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];
  const walk = (node: string): string[] | undefined => {
    if (active.has(node)) return [...stack.slice(stack.indexOf(node)), node];
    if (visited.has(node)) return undefined;
    visited.add(node);
    active.add(node);
    stack.push(node);
    for (const dependency of graph.get(node) ?? []) {
      const cycle = walk(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    active.delete(node);
    return undefined;
  };
  for (const node of graph.keys()) {
    const cycle = walk(node);
    if (cycle) return cycle;
  }
  return undefined;
}

const normalize = (value: string): string => path.normalize(value);
const relative = (value: string): string => path.relative(sourceRoot, value);
const isWithin = (file: string, directory: string): boolean => {
  const relativePath = path.relative(path.join(sourceRoot, directory), file);
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
};
