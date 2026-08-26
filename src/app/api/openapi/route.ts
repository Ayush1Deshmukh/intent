import { buildOpenApi } from "@/lib/openapi";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  return Response.json(buildOpenApi(`${url.protocol}//${url.host}`), {
    headers: { "cache-control": "no-store" },
  });
}
