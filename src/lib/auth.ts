import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, users } from "./db";
import { Action, can, Role, ROLE_LABEL } from "./policy";
import { HttpProblem } from "./problem";

const COOKIE = "vt_session";
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET!);

export type Session = { userId: string; email: string; name: string; role: Role };

export async function signIn(email: string, password: string): Promise<Session> {
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1);
  if (!user) throw new HttpProblem(401, "invalid-credentials", "No account with that email address.");
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new HttpProblem(401, "invalid-credentials", "That password does not match.");

  const session: Session = { userId: user.id, email: user.email, name: user.name, role: user.role as Role };
  const token = await new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt().setExpirationTime("12h")
    .sign(secret());

  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/",
    secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 12,
  });
  return session;
}

export async function signOut() {
  (await cookies()).delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { userId: String(payload.userId), email: String(payload.email),
             name: String(payload.name), role: payload.role as Role };
  } catch { return null; }
}

/** Every route handler's first line. */
export async function requireRole(action: Action): Promise<Session> {
  const session = await getSession();
  if (!session) throw new HttpProblem(401, "unauthenticated", "Sign in to continue.");
  if (!can(session.role, action)) {
    throw new HttpProblem(403, "role-not-permitted",
      `Your role (${ROLE_LABEL[session.role]}) cannot perform "${action}".`,
      { role: session.role, action });
  }
  return session;
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new HttpProblem(401, "unauthenticated", "Sign in to continue.");
  return session;
}

export const hashPassword = (p: string) => bcrypt.hash(p, 10);
