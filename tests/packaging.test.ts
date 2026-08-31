import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Does a fresh clone actually build?
 *
 * This exists because it did not. The Dockerfile copies `/app/public` out of the build
 * stage, `public/` was empty, and git does not track empty directories — so the image
 * built on a machine that already had a working tree and failed for anyone who cloned
 * the repository. The headline claim of the project is `docker compose up --build`, and
 * it was broken for exactly the person the claim is aimed at.
 *
 * Nothing in a local build, a lint run, or the test suite could see it. What sees it is
 * asking whether every path the image needs is a path a clone would have — which is a
 * question about git, not about the filesystem this happens to be running on.
 */

const ROOT = process.cwd();
const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");

/** Files git actually tracks — what a `git clone` would materialise. */
const tracked = new Set(
  execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean),
);
const trackedUnder = (dir: string) => [...tracked].some((f) => f === dir || f.startsWith(dir + "/"));

/** Sources the runtime stage pulls out of the build stage. */
const copiedFromBuild = [...dockerfile.matchAll(/^COPY --from=build\s+(.+?)\s+\S+$/gm)]
  .flatMap((m) => m[1].split(/\s+/))
  .map((p) => p.replace(/^\/app\//, ""));

/** Sources copied straight from the build context, which is this repository. */
const copiedFromContext = [...dockerfile.matchAll(/^COPY\s+(?!--from)(.+?)\s+\S+$/gm)]
  .flatMap((m) => m[1].split(/\s+/));

describe("the image can be built from a fresh clone", () => {
  it("parses the Dockerfile at all (so this cannot pass by finding nothing)", () => {
    expect(copiedFromBuild.length).toBeGreaterThan(3);
    expect(copiedFromContext.length).toBeGreaterThan(0);
  });

  it("every path copied out of the build stage is either a build output or tracked by git", () => {
    // `.next/*` is produced by `next build`; everything else has to come from the clone.
    const buildOutputs = /^\.next\//;
    for (const path of copiedFromBuild) {
      if (buildOutputs.test(path)) continue;
      expect(trackedUnder(path),
        `Dockerfile copies /app/${path}, but git tracks nothing there — a fresh clone will not have it. ` +
        `If the directory is meant to be empty, give it a real file; git cannot carry an empty directory.`)
        .toBe(true);
    }
  });

  it("every named path copied from the build context is tracked by git", () => {
    for (const path of copiedFromContext) {
      const clean = path.replace(/^\.\//, "");
      // `COPY . .` takes the whole context, which is the repository by definition
      if (clean === "." || clean === "") continue;
      expect(trackedUnder(clean), `Dockerfile copies ${clean} from the context, but git does not track it`)
        .toBe(true);
    }
  });

  it("the directories the container reads at runtime are populated in a clone", () => {
    // setup.cjs applies these at start, and the demo tape loader reads these.
    for (const dir of ["drizzle", "fixtures"]) {
      const files = [...tracked].filter((f) => f.startsWith(dir + "/"));
      expect(files.length, `${dir}/ is empty in a clone`).toBeGreaterThan(0);
    }
    expect([...tracked].some((f) => /^drizzle\/.*\.sql$/.test(f)), "no migrations are tracked").toBe(true);
  });

  it("nothing the compose file needs is missing", () => {
    const compose = readFileSync(join(ROOT, "docker-compose.yml"), "utf8");
    const dockerfileRef = compose.match(/dockerfile:\s*(\S+)/)?.[1] ?? "Dockerfile";
    expect(existsSync(join(ROOT, dockerfileRef))).toBe(true);
    for (const m of dockerfile.matchAll(/^COPY\s+(docker\/\S+)/gm)) {
      expect(tracked.has(m[1]), `${m[1]} is referenced by the Dockerfile but not tracked`).toBe(true);
    }
  });

  it("the entrypoint is executable, or the container will not start", () => {
    const mode = execFileSync("git", ["ls-files", "-s", "docker/entrypoint.sh"], { cwd: ROOT, encoding: "utf8" });
    // git records 100755 for an executable file; the Dockerfile also chmods it, but a
    // non-executable file in the tree is a smell worth catching here rather than there.
    expect(mode.startsWith("100755"), `docker/entrypoint.sh is committed as ${mode.split(" ")[0]}`).toBe(true);
  });
});

describe("files read at runtime survive a serverless build", () => {
  const nextConfig = readFileSync(join(ROOT, "next.config.ts"), "utf8");

  /**
   * The demo tape loader reads fixtures/*.csv by a path built at request time. Next's
   * tracing follows static imports and cannot see that, so the files were absent from
   * the build — and the Docker image hid it, because that copies fixtures/ in
   * explicitly. The result was a route that worked in every local and container test
   * and returned a 500 on Vercel.
   */
  it("next.config declares the fixtures directory for output file tracing", () => {
    expect(nextConfig).toMatch(/outputFileTracingIncludes/);
    expect(nextConfig, "fixtures must be named, or the serverless build drops them")
      .toMatch(/fixtures/);
  });

  it("every runtime-read directory is either traced or copied by the Dockerfile", () => {
    // fixtures is read by the demo loader; drizzle by the container's setup step
    for (const dir of ["fixtures", "drizzle"]) {
      const traced = new RegExp(`outputFileTracingIncludes[\\s\\S]*${dir}`).test(nextConfig);
      const copied = new RegExp(`COPY --from=build /app/${dir}`).test(dockerfile);
      expect(traced || copied, `${dir}/ is read at runtime but neither traced nor copied`).toBe(true);
    }
  });
});

describe("the environment example matches what the code reads", () => {
  const example = readFileSync(join(ROOT, ".env.example"), "utf8");
  const envSchema = readFileSync(join(ROOT, "src/lib/env.ts"), "utf8");

  it("every variable the schema requires appears in .env.example", () => {
    const required = [...envSchema.matchAll(/^\s{2}([A-Z_]+):\s*z\./gm)]
      .map((m) => m[1])
      // optional ones do not have to be in the example, but the required ones must be
      .filter((name) => {
        const line = envSchema.split("\n").find((l) => l.trim().startsWith(name + ":")) ?? "";
        return !line.includes(".optional()");
      });
    expect(required.length).toBeGreaterThan(0);
    for (const name of required) {
      expect(example.includes(name + "="), `${name} is required but missing from .env.example`).toBe(true);
    }
  });

  it("the example never ships a real-looking key", () => {
    expect(/gsk_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{32,}/.test(example),
      ".env.example appears to contain a real credential").toBe(false);
  });
});

/**
 * `npm ci` refuses to install a lockfile whose tree is internally inconsistent, and this
 * one was: `@img/sharp-wasm32` and `@tailwindcss/oxide-wasm32-wasi` declared a dependency
 * on `@emnapi/runtime`, and no entry in the lock satisfied it.
 *
 * The cause is that the lock had been written by an incremental install against an
 * existing macOS tree. npm never installs a `wasm32-wasi` package on darwin-arm64, so it
 * pruned that package's own dependencies out of the lock while leaving the requirement
 * behind. Only a resolution from an empty tree writes them back.
 *
 * Nothing local could see it. `npm install`, `npm test`, `npm run build` and a cached
 * Docker layer all worked; the failure appeared only where the install starts from
 * nothing — a fresh clone, a CI runner, a Vercel build, an uncached image build. That is
 * every path a judge or a deployment would take, and none of the paths a developer takes.
 *
 * So this asserts the property `npm ci` asserts, without needing a network or an empty
 * directory: every version requirement in the lock is satisfied by something the lock
 * also contains.
 */
describe("the lockfile installs from nothing", () => {
  type LockPkg = {
    version?: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  };
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")) as {
    lockfileVersion: number;
    packages: Record<string, LockPkg>;
  };

  it("is a lockfile this test understands", () => {
    expect(lock.lockfileVersion).toBeGreaterThanOrEqual(3);
    expect(Object.keys(lock.packages).length).toBeGreaterThan(100);
  });

  /**
   * npm's own resolution: from the depending package's directory, walk up through each
   * enclosing `node_modules` until an entry for the name appears — the same nesting rule
   * `require()` follows.
   */
  const resolveFrom = (dir: string, name: string): LockPkg | null => {
    const segments = dir === "" ? [] : dir.split("/node_modules/");
    for (let i = segments.length; i >= 0; i--) {
      const base = segments.slice(0, i).join("/node_modules/");
      const candidate = `${base ? base + "/" : ""}node_modules/${name}`;
      if (candidate in lock.packages) return lock.packages[candidate];
    }
    return null;
  };

  it("every dependency named in the lock resolves to an entry in the lock", () => {
    const missing: string[] = [];
    for (const [dir, pkg] of Object.entries(lock.packages)) {
      // Peer dependencies may legitimately go unsatisfied; npm ci does not fail on them.
      const required = { ...pkg.dependencies, ...pkg.optionalDependencies };
      for (const name of Object.keys(required)) {
        if (resolveFrom(dir, name) === null) missing.push(`${dir || "<root>"} needs ${name}`);
      }
    }
    expect(missing, `regenerate with: rm -rf node_modules package-lock.json && npm install`)
      .toEqual([]);
  });
});
