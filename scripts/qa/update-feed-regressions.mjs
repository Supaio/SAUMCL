import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUpdateFeed } from "../release/update-feed.js";

const asset = (name, state = "uploaded", size = 1234) => ({
  name,
  state,
  size,
  browser_download_url: `https://github.com/Supaio/SAUMCL/releases/download/v19.2.0-indev/${name}`,
});

const release = (id, draft = false) => ({
  id,
  tag_name: "v19.2.0-indev",
  draft,
  prerelease: false,
  body: "Release notes",
  published_at: "2026-10-23T00:00:00Z",
  assets: [asset("SAUMCL.exe"), asset("SAUMCL")],
});

test("published feed keeps the Windows and Linux downloads and release notes", () => {
  const [feed] = buildUpdateFeed([release(1)]);
  assert.equal(feed.tag_name, "v19.2.0-indev");
  assert.equal(feed.body, "Release notes");
  assert.equal(feed.published_at, "2026-10-23T00:00:00Z");
  assert.deepEqual(
    feed.assets.map(({ name }) => name),
    ["SAUMCL.exe", "SAUMCL"]
  );
});

test("unrelated drafts stay private when preparing a release", () => {
  const publishing = release(2, true);
  publishing.body = "Publishing notes";
  const unrelated = release(3, true);
  unrelated.body = "Unpublished notes";
  const feed = buildUpdateFeed([release(1), publishing, unrelated], 2);
  assert.equal(feed.length, 2);
  assert.ok(feed.every(({ draft }) => draft === false));
  assert.ok(feed.every((entry) => !("id" in entry)));
  assert.deepEqual(
    feed.map(({ body }) => body),
    ["Release notes", "Publishing notes"]
  );
});

test("incomplete files and metadata assets are not offered as launcher downloads", () => {
  const entry = release(1);
  entry.assets = [
    asset("SAUMCL.exe", "new"),
    asset("SAUMCL", "uploaded", 0),
    asset("SHA256SUMS.txt"),
    asset("updates.json"),
  ];
  assert.deepEqual(buildUpdateFeed([entry]), []);
});

test("feed retains older published releases for pending downloads", () => {
  const previous = release(2);
  previous.tag_name = "v19.1.0-indev";
  assert.deepEqual(
    buildUpdateFeed([release(1), previous]).map(({ tag_name }) => tag_name),
    ["v19.2.0-indev", "v19.1.0-indev"]
  );
});
