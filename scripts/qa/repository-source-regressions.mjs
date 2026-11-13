import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { parseCommunityFeed } from "../../src/utils/community.ts";

const bundled = JSON.parse(
  fs.readFileSync(new URL("../../public/community.json", import.meta.url))
);
const source = ts.transpileModule(
  fs.readFileSync(
    new URL("../../src/services/community.ts", import.meta.url),
    "utf8"
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }
).outputText;

const setup = (responses, cached = bundled) => {
  const requested = [];
  const context = {
    exports: {},
    require(name) {
      if (name === "@tauri-apps/api/core") return { invoke: async () => null };
      if (name === "@tauri-apps/plugin-http")
        return {
          fetch: async (url) => {
            requested.push(url);
            const body = responses.shift();
            return { ok: body !== null, json: async () => body };
          },
        };
      if (name === "@/utils/community") return { parseCommunityFeed };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    localStorage: {
      getItem: () => JSON.stringify(cached),
      setItem: () => {},
    },
    fetch: async () => ({ ok: true, json: async () => bundled }),
  };
  vm.runInNewContext(source, context);
  return { service: context.exports.CommunityService, requested };
};

test("the backup repository is tried before a cached community list", async () => {
  const { service, requested } = setup([null, bundled]);
  const result = await service.retrieveFeed();
  assert.equal(result.stale, false);
  assert.equal(result.preview, false);
  assert.equal(requested.length, 2);
  assert.equal(new URL(requested[0]).hostname, "raw.githubusercontent.com");
  assert.equal(new URL(requested[1]).hostname, "gitlab.com");
});

test("an invalid primary response cannot hide a valid backup", async () => {
  const { service, requested } = setup([{}, bundled]);
  assert.equal((await service.retrieveFeed()).stale, false);
  assert.equal(requested.length, 2);
});

test("a failed pair of repositories uses the previous reviewed cache", async () => {
  const { service, requested } = setup([null, null]);
  const result = await service.retrieveFeed();
  assert.equal(result.stale, true);
  assert.equal(requested.length, 2);
  assert.ok(parseCommunityFeed(result.feed));
});
