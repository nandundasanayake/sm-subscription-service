const TOKEN_KEY = "admin_token";

export interface AdminLoginInput {
  username: string;
  password: string;
}

export async function adminLogin(input: AdminLoginInput): Promise<string> {
  const res = await fetch("/api/v1/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    let message = "Invalid username or password";
    try {
      const data = await res.json();
      if (data && typeof data.detail === "string") message = data.detail;
    } catch (_) {}
    throw new Error(message);
  }

  const data = await res.json();
  return data.access_token as string;
}

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  if (typeof window !== "undefined") localStorage.setItem(TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  if (typeof window !== "undefined") localStorage.removeItem(TOKEN_KEY);
}

function base64UrlDecode(segment: string): string {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return atob(padded);
}

/**
 * Decodes the JWT payload client-side WITHOUT verifying its signature — this
 * is only used to drive UI/redirect decisions (fast feedback, no network
 * round-trip). The backend independently verifies the signature and admin
 * claim on every request, so a forged/expired token is never actually
 * trusted for data access, only for whether to show the login screen.
 */
export function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    if (!payload.exp) return false;
    return payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}
