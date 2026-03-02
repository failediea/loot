import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

// Lazy-init: process.env may not have .env.local loaded yet when
// server.ts imports this module (before Next's app.prepare()).
let _jwtSecret: Uint8Array | null = null;
function getJwtSecret(): Uint8Array {
  if (!_jwtSecret) {
    _jwtSecret = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret");
  }
  return _jwtSecret;
}
const COOKIE_NAME = "ls-auth";

export interface JWTPayload {
  sub: string; // user ID
  addr: string; // controller address
  isOwner: boolean;
}

export async function createToken(payload: JWTPayload): Promise<string> {
  return new SignJWT(payload as any)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

export async function getAuthUser(): Promise<JWTPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export function getAuthCookieName(): string {
  return COOKIE_NAME;
}
