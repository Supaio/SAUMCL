import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import keyTools from "../maintenance/keys.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

test("generated grant verifies offline without expiry, device or version bindings", () => {
  const grant = keyTools.createGrant(privateKey, "测试维护人员");
  const [header, payload, signature] = grant
    .slice("SAUMCL-MAINT-1.".length)
    .split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(claims.name, "测试维护人员");
  assert.equal(claims.role, "maintainer");
  assert.equal(claims.aud, "saumcl-maintenance");
  assert.equal(claims.iss, "saumcl-maintainer");
  for (const field of [
    "exp",
    "nbf",
    "gameVersion",
    "launcherVersion",
    "device",
  ]) {
    assert.ok(!(field in claims));
  }
  assert.equal(
    JSON.parse(Buffer.from(header, "base64url").toString()).kid,
    keyTools.keyId(publicKey)
  );
  assert.ok(
    verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url")
    )
  );
  const altered = Buffer.from(
    JSON.stringify({ ...claims, name: "改名" })
  ).toString("base64url");
  assert.ok(
    !verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${altered}`),
      publicKey,
      Buffer.from(signature, "base64url")
    )
  );
});

test("each maintainer receives a distinct grant and invalid names are refused", () => {
  const decode = (grant) =>
    JSON.parse(Buffer.from(grant.split(".")[2], "base64url").toString());
  const first = decode(keyTools.createGrant(privateKey, "维护人员"));
  const second = decode(keyTools.createGrant(privateKey, "维护人员"));
  assert.notEqual(first.sub, second.sub);
  assert.throws(() => keyTools.createGrant(privateKey, " "));
  assert.throws(() => keyTools.createGrant(privateKey, "牛".repeat(81)));
});

test("owner tool refuses to write private material or grants inside the repository", () => {
  const repository = fileURLToPath(new URL("../..", import.meta.url));
  assert.throws(() => keyTools.assertOutsideRepository(repository));
  assert.throws(() =>
    keyTools.assertOutsideRepository(
      path.join(repository, "secrets", "private.pem")
    )
  );
  assert.ok(
    keyTools.assertOutsideRepository(
      path.join(repository, "..", ".saumcl-owner-example")
    )
  );
});
