import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyGoogleIdToken } from "./verify-google-id-token";

const REAL_CLIENT_ID = "test-client-id.apps.googleusercontent.com";

function withMockedGoogleTokeninfo<T>(
  responder: (url: string) => { status: number; body: unknown },
  run: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalClientId = process.env.AUTH_GOOGLE_ID;
  process.env.AUTH_GOOGLE_ID = REAL_CLIENT_ID;

  // @ts-expect-error - test-only stand-in for the global fetch used by verifyGoogleIdToken.
  globalThis.fetch = async (input: string | URL) => {
    const { status, body } = responder(input.toString());
    return new Response(JSON.stringify(body), { status });
  };

  return run().finally(() => {
    globalThis.fetch = originalFetch;
    process.env.AUTH_GOOGLE_ID = originalClientId;
  });
}

test("verifyGoogleIdToken accepts a valid token matching our client id", async () => {
  const identity = await withMockedGoogleTokeninfo(
    () => ({
      status: 200,
      body: {
        aud: REAL_CLIENT_ID,
        iss: "https://accounts.google.com",
        email: "person@example.com",
        email_verified: "true",
        sub: "1234567890",
        name: "Test Person",
      },
    }),
    () => verifyGoogleIdToken("valid-token"),
  );

  assert.deepEqual(identity, { sub: "1234567890", email: "person@example.com", name: "Test Person" });
});

test("verifyGoogleIdToken rejects a token issued for a different audience", async () => {
  const identity = await withMockedGoogleTokeninfo(
    () => ({
      status: 200,
      body: {
        aud: "someone-elses-client-id.apps.googleusercontent.com",
        iss: "https://accounts.google.com",
        email: "person@example.com",
        email_verified: "true",
        sub: "1234567890",
      },
    }),
    () => verifyGoogleIdToken("wrong-audience-token"),
  );

  assert.equal(identity, null);
});

test("verifyGoogleIdToken rejects an unverified email", async () => {
  const identity = await withMockedGoogleTokeninfo(
    () => ({
      status: 200,
      body: {
        aud: REAL_CLIENT_ID,
        iss: "https://accounts.google.com",
        email: "person@example.com",
        email_verified: "false",
        sub: "1234567890",
      },
    }),
    () => verifyGoogleIdToken("unverified-email-token"),
  );

  assert.equal(identity, null);
});

test("verifyGoogleIdToken rejects when Google reports the token invalid", async () => {
  const identity = await withMockedGoogleTokeninfo(
    () => ({ status: 400, body: { error: "invalid_token" } }),
    () => verifyGoogleIdToken("garbage-token"),
  );

  assert.equal(identity, null);
});
