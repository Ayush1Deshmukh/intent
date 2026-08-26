/** RFC 7807 problem+json. Consistent, specific errors read as maturity. */
export class HttpProblem extends Error {
  constructor(
    public status: number,
    public type: string,
    public detail: string,
    public extra: Record<string, unknown> = {},
  ) { super(detail); }

  toResponse(instance?: string) {
    const title = this.type.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    return Response.json(
      { type: `https://verified-tape.app/problems/${this.type}`, title, status: this.status,
        detail: this.detail, instance, ...this.extra },
      { status: this.status, headers: { "content-type": "application/problem+json" } },
    );
  }
}

export function problemHandler<Ctx = unknown>(fn: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try { return await fn(req, ctx); }
    catch (err) {
      if (err instanceof HttpProblem) return err.toResponse(new URL(req.url).pathname);
      console.error("[unhandled]", err);
      return new HttpProblem(500, "internal-error",
        err instanceof Error ? err.message : "Unexpected error").toResponse(new URL(req.url).pathname);
    }
  };
}
