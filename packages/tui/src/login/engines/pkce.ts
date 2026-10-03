/** PKCE S256 helper (OMP `registry/oauth/pkce.ts`, verbatim semantics). */

export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(96);
  crypto.getRandomValues(verifierBytes);
  const verifier = Buffer.from(verifierBytes).toString("base64url");
  const data = new TextEncoder().encode(verifier);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return { verifier, challenge: Buffer.from(hashBuffer).toString("base64url") };
}
