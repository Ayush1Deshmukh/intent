import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildOpenApi } from "@/lib/openapi";
import { ALL_ACTIONS, POLICY, ROLE_LABEL } from "@/lib/policy";

/**
 * The OpenAPI document is assembled by hand in `src/lib/openapi.ts`, from the same
 * policy table and rule catalogue the application runs on. That keeps its *contents*
 * honest, but nothing stops someone adding a route file and forgetting to describe it
 * — and a spec that quietly omits an endpoint is worse than no spec, because a reader
 * reasonably assumes it is complete.
 *
 * So the filesystem is the source of truth for which endpoints exist, and this walks it.
 */

const API_ROOT = join(process.cwd(), "src/app/api/v1");

/** Every route.ts under /api/v1, as the URL path it serves and the verbs it exports. */
function routesOnDisk(dir = API_ROOT, prefix = "/api/v1"): { path: string; methods: string[] }[] {
  const out: { path: string; methods: string[] }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Next's [id] dynamic segment is {id} in an OpenAPI path
      const segment = entry.replace(/^\[(\.{3})?(.+)\]$/, "{$2}");
      out.push(...routesOnDisk(full, `${prefix}/${segment}`));
    } else if (entry === "route.ts") {
      const src = readFileSync(full, "utf8");
      const methods = ["get", "post", "put", "patch", "delete"]
        .filter((m) => new RegExp(`export const ${m.toUpperCase()}\\b`).test(src));
      out.push({ path: prefix, methods });
    }
  }
  return out;
}

const spec = buildOpenApi("") as unknown as {
  paths: Record<string, Record<string, { summary?: string; description?: string; responses?: object }>>;
};

describe("the OpenAPI spec describes the API that actually exists", () => {
  const disk = routesOnDisk();

  it("finds the route files at all (guards against this test silently passing)", () => {
    expect(disk.length).toBeGreaterThanOrEqual(15);
    for (const r of disk) expect(r.methods.length, `${r.path} exports no handler`).toBeGreaterThan(0);
  });

  it("documents every route on disk, with every verb it exports", () => {
    for (const { path, methods } of disk) {
      const documented = spec.paths[path];
      expect(documented, `${path} exists on disk but is missing from the spec`).toBeTruthy();
      for (const m of methods) {
        expect(Object.keys(documented), `${path} exports ${m.toUpperCase()} but the spec omits it`)
          .toContain(m);
      }
    }
  });

  it("documents nothing that does not exist", () => {
    const real = new Set(disk.map((r) => r.path));
    for (const path of Object.keys(spec.paths)) {
      expect(real.has(path), `the spec describes ${path}, which has no route file`).toBe(true);
    }
  });

  it("every operation says what it does and what comes back", () => {
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        const where = `${method.toUpperCase()} ${path}`;
        expect(op.summary?.length ?? 0, `${where} has no summary`).toBeGreaterThan(8);
        expect(Object.keys(op.responses ?? {}).length, `${where} documents no responses`).toBeGreaterThan(0);
      }
    }
  });

  it("every non-GET operation names the roles that may call it", () => {
    // The RBAC matrix is the product's spine, and an endpoint whose documentation does
    // not say who may call it is the one a reader will assume is open to anyone.
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        if (method === "get") continue;
        expect(/Roles:/.test(op.description ?? ""), `${method.toUpperCase()} ${path} does not name its roles`)
          .toBe(true);
      }
    }
  });
});

describe("the policy table stays coherent", () => {
  it("no action is grantable to nobody", () => {
    for (const a of ALL_ACTIONS) expect(POLICY[a].length, a).toBeGreaterThan(0);
  });

  it("every role named in the spec is a role that exists", () => {
    // roleNote() renders labels, not slugs, so this catches a hand-written description
    // that invents a role the policy table has never heard of.
    const known = new Set(Object.values(ROLE_LABEL));
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        const note = (op.description ?? "").match(/Roles: ([^.]+)\./)?.[1];
        if (!note) continue;
        for (const label of note.split(",").map((x) => x.trim())) {
          expect(known.has(label), `${method.toUpperCase()} ${path} names an unknown role "${label}"`).toBe(true);
        }
      }
    }
  });
});
