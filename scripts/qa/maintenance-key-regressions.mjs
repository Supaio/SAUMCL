import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import keyTools from "../maintenance/keys.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const accountUuid = "01234567-89AB-4DEF-8ABC-0123456789AB";

test("the signed grant binds the account UUID without expiry, device or version bindings", () => {
  const grant = keyTools.createGrant(privateKey, "测试维护人员", accountUuid);
  const [header, payload, signature] = grant
    .slice("SAUMCL-MAINT-1.".length)
    .split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(claims.name, "测试维护人员");
  assert.equal(claims.schema, 2);
  assert.equal(
    claims.accountUuid,
    accountUuid.replaceAll("-", "").toLowerCase()
  );
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
    JSON.stringify({ ...claims, accountUuid: "1".repeat(32) })
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

test("each maintainer receives a distinct grant and invalid names or UUIDs are refused", () => {
  const decode = (grant) =>
    JSON.parse(Buffer.from(grant.split(".")[2], "base64url").toString());
  const first = decode(
    keyTools.createGrant(privateKey, "维护人员", accountUuid)
  );
  const second = decode(
    keyTools.createGrant(privateKey, "维护人员", accountUuid)
  );
  assert.notEqual(first.sub, second.sub);
  assert.throws(
    () => keyTools.createGrant(privateKey, " ", accountUuid),
    /名称/
  );
  assert.throws(
    () => keyTools.createGrant(privateKey, "牛".repeat(81), accountUuid),
    /名称/
  );
  for (const invalid of [
    "",
    "0".repeat(32),
    "Maintainer",
    "--" + accountUuid,
  ]) {
    assert.throws(
      () => keyTools.createGrant(privateKey, "维护人员", invalid),
      /UUID/
    );
  }
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
