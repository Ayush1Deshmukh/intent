import { createHash } from "node:crypto";
import { canonicalJson, fixed, dateOnly } from "./canonical";

export const GENESIS = "0".repeat(64);

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** the 19 business fields, formatted for hashing. nothing else may enter. */
export function businessFields(r: Record<string, unknown>) {
  return {
    loanId: (r.loanId as string) ?? null,
    borrowerId: (r.borrowerId as string) ?? null,
    loanType: (r.loanType as string) ?? null,
    originationDate: dateOnly(r.originationDate as string),
    maturityDate: dateOnly(r.maturityDate as string),
    originalPrincipal: fixed(r.originalPrincipal as string, 2),
    currentBalance: fixed(r.currentBalance as string, 2),
    interestRate: fixed(r.interestRate as string, 4),
    termMonths: (r.termMonths as number) ?? null,
    paymentAmount: fixed(r.paymentAmount as string, 2),
    paymentStatus: (r.paymentStatus as string) ?? null,
    daysPastDue: (r.daysPastDue as number) ?? null,
    borrowerState: (r.borrowerState as string) ?? null,
    borrowerZip: (r.borrowerZip as string) ?? null,
    creditScore: (r.creditScore as number) ?? null,
    appraisedValue: fixed(r.appraisedValue as string, 2),
    servicerId: (r.servicerId as string) ?? null,
    lastUpdatedAt: r.lastUpdatedAt ? new Date(r.lastUpdatedAt as string).toISOString() : null,
    documentStatus: (r.documentStatus as string) ?? null,
  };
}

/** recordHash seals the business content of one loan at one version */
export function recordHash(r: Record<string, unknown>): string {
  return sha256(canonicalJson({ v: 1, id: r.id ?? null, version: r.version ?? 1, ...businessFields(r) }));
}

/** rowHash seals one raw source row exactly as it arrived */
export function rowHash(sourceFileSha: string, rowNumber: number, original: Record<string, string>): string {
  return sha256(canonicalJson({ f: sourceFileSha, n: rowNumber, r: original }));
}

export type ChainEvent = {
  seq: number;
  createdAt: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  payload: unknown;
};

/** hash(n) = sha256( hash(n-1) || canonicalJson(event) ) */
export function eventHash(prevHash: string, e: ChainEvent): string {
  return sha256(prevHash + "|" + canonicalJson(e as unknown as Record<string, unknown>));
}

/**
 * Merkle root over verified record hashes.
 *  - leaves sorted ascending as hex, so row order cannot move the root
 *  - odd node is PROMOTED unchanged, never duplicated (duplication enables a
 *    known second-preimage trick)
 */
export function merkleRoot(hashes: string[]): string {
  if (hashes.length === 0) return GENESIS;
  let level = [...hashes].sort();
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) next.push(sha256(level[i] + level[i + 1]));
      else next.push(level[i]); // promote
    }
    level = next;
  }
  return level[0];
}

/** merkle proof for one leaf — lets a consumer verify a single loan offline */
export function merkleProof(hashes: string[], target: string): { position: "L" | "R"; hash: string }[] {
  let level = [...hashes].sort();
  let idx = level.indexOf(target);
  if (idx === -1) return [];
  const proof: { position: "L" | "R"; hash: string }[] = [];
  while (level.length > 1) {
    const next: string[] = [];
    let nextIdx = 0;
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        if (i === idx) { proof.push({ position: "R", hash: level[i + 1] }); nextIdx = next.length; }
        else if (i + 1 === idx) { proof.push({ position: "L", hash: level[i] }); nextIdx = next.length; }
        next.push(sha256(level[i] + level[i + 1]));
      } else {
        if (i === idx) nextIdx = next.length;
        next.push(level[i]);
      }
    }
    level = next; idx = nextIdx;
  }
  return proof;
}

export function verifyMerkleProof(leaf: string, proof: { position: "L" | "R"; hash: string }[], root: string): boolean {
  let acc = leaf;
  for (const step of proof) acc = step.position === "L" ? sha256(step.hash + acc) : sha256(acc + step.hash);
  return acc === root;
}
