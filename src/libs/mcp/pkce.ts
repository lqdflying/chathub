import crypto from 'node:crypto';

/**
 * Generates a cryptographically random PKCE code verifier.
 * Per RFC 7636: a high-entropy random string of length 43-128 characters
 * using unreserved characters [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
 */
export function generateCodeVerifier(length = 64): string {
  return crypto
    .randomBytes(length)
    .toString('base64url')
    .slice(0, length);
}

/**
 * Generates a PKCE code challenge from a verifier using S256 method.
 * Per RFC 7636: BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))
 */
export function generateCodeChallenge(verifier: string): string {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

/**
 * Generates a cryptographically random OAuth state parameter.
 */
export function generateState(length = 32): string {
  return crypto.randomBytes(length).toString('hex');
}
