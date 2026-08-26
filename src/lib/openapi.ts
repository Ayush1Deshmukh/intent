import { CANONICAL_FIELDS, FIELD_META } from "@/lib/schema/fields";
import { POLICY, ROLE_LABEL, Action, Role } from "@/lib/policy";
import { RULE_CATALOG } from "@/lib/rules/catalog";
import { AUDIT_ACTIONS } from "@/lib/audit";

/**
 * The OpenAPI document is BUILT, not written.
 *
 * The canonical loan schema comes from FIELD_META, the role notes come from
 * POLICY, and the rule enumeration comes from the same catalog the engine runs.
 * Those three cannot drift from the implementation, because there is only one
 * copy of each. Paths and their descriptions are declared once, below.
 */

const KIND_TO_SCHEMA: Record<string, object> = {
  string: { type: "string" },
  int: { type: "integer" },
  money: { type: "string", description: "decimal string, 2 places", example: "412000.00" },
  rate: { type: "string", description: "annual percent as a decimal string, 4 places", example: "5.5000" },
  date: { type: "string", format: "date" },
  timestamp: { type: "string", format: "date-time" },
  enum: { type: "string" },
  state: { type: "string", maxLength: 2 },
  zip: { type: "string" },
};

function loanSchema() {
  const properties: Record<string, object> = {};
  const required: string[] = [];
  for (const f of CANONICAL_FIELDS) {
    const meta = FIELD_META[f];
    properties[f] = {
      ...KIND_TO_SCHEMA[meta.kind],
      title: meta.label,
      nullable: !meta.required,
      ...(meta.values ? { enum: meta.values } : {}),
    };
    if (meta.required) required.push(f);
  }
  return { type: "object", properties, required };
}

const roleNote = (a: Action) =>
  `Roles: ${POLICY[a].map((r: Role) => ROLE_LABEL[r]).join(", ")}.`;

const problem = {
  description: "RFC 7807 problem document",
  content: {
    "application/problem+json": {
      schema: {
        type: "object",
        properties: {
          type: { type: "string", format: "uri" }, title: { type: "string" },
          status: { type: "integer" }, detail: { type: "string" }, instance: { type: "string" },
        },
      },
    },
  },
};

export function buildOpenApi(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Verified Tape API",
      version: "1.0.0",
      description: [
        "Loan data verification: ingest messy tapes, detect data-quality exceptions,",
        "resolve them under maker-checker, and seal the result into a hash-chained,",
        "independently verifiable record.",
        "",
        "**The AI has no write path.** Model output becomes a `Proposal`; a Data Operator",
        "accepts it, and a different Reviewer approves it. Only approval mutates a loan.",
        "",
        `**Rules:** ${RULE_CATALOG.length} across ${new Set(RULE_CATALOG.map((r) => r.category)).size} families, stored as data and evaluated deterministically.`,
        "",
        `**Audit actions:** ${AUDIT_ACTIONS.join(", ")}.`,
      ].join("\n"),
    },
    servers: [{ url: origin }],
    tags: [
      { name: "Tapes", description: "Ingest and inspect batches" },
      { name: "Exceptions", description: "Triage and propose corrections" },
      { name: "Review", description: "Maker-checker decisions" },
      { name: "Verification", description: "Sign-off and independent proof" },
      { name: "Rules", description: "The validation library" },
    ],
    components: {
      securitySchemes: { session: { type: "apiKey", in: "cookie", name: "vt_session" } },
      schemas: {
        LoanRecord: loanSchema(),
        Exception: {
          type: "object",
          properties: {
            id: { type: "string" }, loanId: { type: "string", nullable: true },
            field: { type: "string", nullable: true },
            observed: { type: "string", nullable: true }, expected: { type: "string" },
            severity: { type: "string", enum: ["BLOCKER", "CRITICAL", "WARNING", "INFO"] },
            status: { type: "string", enum: ["OPEN", "PENDING_APPROVAL", "RESOLVED", "WAIVED", "REJECTED"] },
            clusterKey: { type: "string", nullable: true },
            rule: {
              type: "object",
              properties: {
                code: { type: "string", enum: RULE_CATALOG.map((r) => r.code) },
                name: { type: "string" }, category: { type: "string" }, description: { type: "string" },
              },
            },
          },
        },
        Proposal: {
          type: "object",
          description: "A suggested correction. Creating one never changes a loan record.",
          properties: {
            id: { type: "string" }, field: { type: "string" },
            fromValue: { type: "string", nullable: true }, toValue: { type: "string", nullable: true },
            rationale: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 },
            source: { type: "string", enum: ["AI", "RULE", "HUMAN"] },
            model: { type: "string", nullable: true }, promptHash: { type: "string", nullable: true },
            status: { type: "string", enum: ["DRAFT", "ACCEPTED_BY_OPERATOR", "APPROVED", "REJECTED"] },
          },
        },
        Verification: {
          type: "object",
          properties: {
            ok: { type: "boolean" }, attested: { type: "boolean" },
            chain: {
              type: "object",
              properties: {
                ok: { type: "boolean" }, eventsChecked: { type: "integer" },
                firstBadSeq: { type: "integer", nullable: true }, reason: { type: "string", nullable: true },
              },
            },
            data: {
              type: "object",
              properties: {
                ok: { type: "boolean" }, attestedRoot: { type: "string", nullable: true },
                recomputedRoot: { type: "string", nullable: true }, recordCount: { type: "integer" },
                divergences: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      loanId: { type: "string" }, attestedHash: { type: "string" },
                      recomputedHash: { type: "string" }, reason: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    security: [{ session: [] }],
    paths: {
      "/api/v1/tapes": {
        get: { tags: ["Tapes"], summary: "List tapes", description: roleNote("tape:read"),
          responses: { 200: { description: "OK" }, 401: problem } },
        post: {
          tags: ["Tapes"], summary: "Ingest a tape and its secondary sources",
          description: [
            roleNote("tape:upload"),
            "Files land verbatim in the raw quarantine zone and a column mapping is PROPOSED.",
            "Nothing canonical is written until a person confirms that mapping.",
            "Send `Idempotency-Key` to make a retry safe.",
          ].join(" "),
          parameters: [{ name: "Idempotency-Key", in: "header", schema: { type: "string" } }],
          requestBody: {
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    LOAN_TAPE: { type: "string", format: "binary" },
                    SERVICER_UPDATE: { type: "string", format: "binary" },
                    DOCUMENT_MANIFEST: { type: "string", format: "binary" },
                    name: { type: "string" },
                  },
                  required: ["LOAN_TAPE"],
                },
              },
            },
          },
          responses: {
            202: { description: "Accepted; mapping proposed" },
            400: problem, 409: problem, 413: problem,
          },
        },
      },
      "/api/v1/tapes/{id}/exceptions": {
        get: {
          tags: ["Exceptions"], summary: "List exceptions", description: roleNote("tape:read"),
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "severity", in: "query", schema: { type: "array", items: { type: "string" } } },
            { name: "status", in: "query", schema: { type: "array", items: { type: "string" } } },
            { name: "rule", in: "query", schema: { type: "string" } },
            { name: "cursor", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 200 } },
          ],
          responses: { 200: { description: "A page of exceptions plus severity counts" }, 401: problem },
        },
      },
      "/api/v1/tapes/{id}/cluster": {
        post: {
          tags: ["Exceptions"], summary: "Group open exceptions by root cause",
          description: "Falls back to deterministic grouping when the model is unavailable, so this endpoint always answers.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Clusters" } },
        },
      },
      "/api/v1/exceptions/{id}/explain": {
        post: {
          tags: ["Exceptions"], summary: "Explain one exception in plain language",
          description: "Never proposes a value. Falls back to the rule's own description when the model is unavailable.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Explanation" }, 404: problem },
        },
      },
      "/api/v1/exceptions/{id}/proposals": {
        post: {
          tags: ["Exceptions"], summary: "Create a proposed correction",
          description: [roleNote("proposal:request"),
            "Creating a proposal does not change any loan record. It is a suggestion awaiting two humans."].join(" "),
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    mode: { type: "string", enum: ["ai", "manual"] },
                    field: { type: "string" }, toValue: { type: "string" }, rationale: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: "Proposal created", content: { "application/json": { schema: { $ref: "#/components/schemas/Proposal" } } } },
            422: problem,
          },
        },
      },
      "/api/v1/proposals/{id}/decision": {
        post: {
          tags: ["Review"], summary: "Accept, approve or reject a proposal",
          description: [
            "`accept` (Data Operator) turns a proposal into a pending change; the loan is untouched.",
            "`approve` (Reviewer) applies it — the only call in this API that mutates a loan record.",
            "The person who accepted cannot approve: that returns 403 self-approval-forbidden.",
          ].join(" "),
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object", required: ["action"],
                  properties: { action: { type: "string", enum: ["accept", "approve", "reject"] }, reason: { type: "string" } },
                },
              },
            },
          },
          responses: { 200: { description: "Decision recorded" }, 403: problem, 409: problem },
        },
      },
      "/api/v1/exceptions/{id}/waive": {
        post: {
          tags: ["Review"], summary: "Waive a warning with a reason",
          description: `${roleNote("exception:waive")} Blocking and critical exceptions cannot be waived.`,
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Waived" }, 409: problem },
        },
      },
      "/api/v1/tapes/{id}/attest": {
        post: {
          tags: ["Verification"], summary: "Sign off the tape",
          description: [roleNote("tape:attest"),
            "Refused with 409 while any blocking or critical exception is still open or pending.",
            "Seals every eligible loan into the verified ledger and stores the Merkle root."].join(" "),
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 201: { description: "Attestation" }, 409: problem },
        },
      },
      "/api/v1/verify/{tapeId}": {
        get: {
          tags: ["Verification"], summary: "Recompute the chain and the Merkle root",
          description: "**Public and unauthenticated by design**: anyone can check a tape, nobody can change it. Returns 409 when verification fails.",
          security: [],
          parameters: [{ name: "tapeId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            200: { description: "Verified", content: { "application/json": { schema: { $ref: "#/components/schemas/Verification" } } } },
            409: { description: "Verification failed", content: { "application/json": { schema: { $ref: "#/components/schemas/Verification" } } } },
          },
        },
      },
      "/api/v1/verified/{tapeId}": {
        get: {
          tags: ["Verification"], summary: "Sealed records, with a Merkle proof for one loan",
          description: "Public. With `loanId`, returns the record plus a proof a consumer can check offline against the root.",
          security: [],
          parameters: [
            { name: "tapeId", in: "path", required: true, schema: { type: "string" } },
            { name: "loanId", in: "query", schema: { type: "string" } },
          ],
          responses: { 200: { description: "Records or a single record with its proof" }, 404: problem },
        },
      },
      "/api/v1/tapes/{id}/audit": {
        get: {
          tags: ["Verification"], summary: "The hash-chained event history",
          description: roleNote("audit:read"),
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "after", in: "query", schema: { type: "integer" } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 1000 } },
          ],
          responses: { 200: { description: "Events" } },
        },
      },
      "/api/v1/tapes/{id}/export": {
        get: {
          tags: ["Verification"], summary: "Download the audit bundle",
          description: "ZIP: clean.csv, exceptions.csv, audit.jsonl, attestation.json, verified_records.json, sources.json and VERIFY.md — enough to check the tape without this system.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "application/zip" } },
        },
      },
      "/api/v1/records/{id}/lineage": {
        get: {
          tags: ["Tapes"], summary: "Full lineage for one loan",
          description: "Raw value, every coercion, the rules that inspected it, proposals, decisions and hashes.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Lineage" }, 404: problem },
        },
      },
      "/api/v1/rules": {
        get: { tags: ["Rules"], summary: "The rule library", responses: { 200: { description: "Rules" } } },
        post: {
          tags: ["Rules"], summary: "Compile a sentence into a rule",
          description: [roleNote("rule:draft"),
            "With `previewOnly`, nothing is saved and the response reports how many rows the rule would flag.",
            "Saved rules start disabled until a Reviewer approves them."].join(" "),
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    naturalLanguage: { type: "string", example: "flag loans where the credit score is under 600" },
                    tapeId: { type: "string" }, previewOnly: { type: "boolean" }, rule: { type: "object" },
                  },
                },
              },
            },
          },
          responses: { 201: { description: "Rule created" }, 422: problem },
        },
      },
    },
  };
}
