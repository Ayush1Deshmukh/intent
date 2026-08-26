import { randomBytes } from "node:crypto";
/** short, url-safe, sortable-enough id. no external dep. */
export function createId(): string {
  return Date.now().toString(36) + randomBytes(8).toString("hex");
}
