import { describe, expect, it } from 'vitest';

import { generateCodeChallenge, generateCodeVerifier, generateState } from '../pkce';

describe('PKCE Utilities', () => {
  describe('generateCodeVerifier', () => {
    it('should generate a verifier of the specified length', () => {
      const verifier = generateCodeVerifier(64);

      expect(verifier).toHaveLength(64);
    });

    it('should generate a verifier with default length', () => {
      const verifier = generateCodeVerifier();

      expect(verifier).toHaveLength(64);
    });

    it('should only contain valid PKCE unreserved characters', () => {
      const verifier = generateCodeVerifier(128);

      // RFC 7636 unreserved characters: [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
      expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    });

    it('should generate different verifiers each time', () => {
      const v1 = generateCodeVerifier();
      const v2 = generateCodeVerifier();

      expect(v1).not.toBe(v2);
    });
  });

  describe('generateCodeChallenge', () => {
    it('should generate a valid S256 code challenge', () => {
      const verifier = 'test-verifier-1234567890';
      const challenge = generateCodeChallenge(verifier);

      // S256 challenge should be base64url encoded
      expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
      expect(challenge.length).toBeGreaterThan(0);
    });

    it('should produce consistent results for the same verifier', () => {
      const verifier = 'consistent-verifier';
      const c1 = generateCodeChallenge(verifier);
      const c2 = generateCodeChallenge(verifier);

      expect(c1).toBe(c2);
    });

    it('should produce different results for different verifiers', () => {
      const c1 = generateCodeChallenge('verifier-one');
      const c2 = generateCodeChallenge('verifier-two');

      expect(c1).not.toBe(c2);
    });

    it('should handle empty verifier', () => {
      const challenge = generateCodeChallenge('');

      expect(challenge).toBeTruthy();
      expect(() => challenge).not.toThrow();
    });
  });

  describe('generateState', () => {
    it('should generate a state string of the specified length', () => {
      const state = generateState(32);

      // hex encoding means each byte = 2 hex chars
      expect(state).toHaveLength(64);
    });

    it('should generate a state with default length', () => {
      const state = generateState();

      expect(state).toHaveLength(64);
    });

    it('should only contain hex characters', () => {
      const state = generateState();

      expect(state).toMatch(/^[0-9a-f]+$/);
    });

    it('should generate different states each time', () => {
      const s1 = generateState();
      const s2 = generateState();

      expect(s1).not.toBe(s2);
    });
  });

  describe('PKCE flow validation', () => {
    it('should allow a verifier to be validated against its challenge', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);

      // Re-generate to verify
      const reChallenge = generateCodeChallenge(verifier);

      expect(challenge).toBe(reChallenge);
    });
  });
});
