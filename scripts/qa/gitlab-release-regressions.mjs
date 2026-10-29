import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGitlabFeed,
  normalizeNotes,
  textHash,
  validateManifest,
  versionLabel,
} from "../release/gitlab-release.js";

const version = "19.3.0-indev.gl";
const commit = "a".repeat(40);
const manifest = (name) => ({
  name,
  version,
  source_commit: commit,
  size: 1234,
  sha256: "b".repeat(64),
  url: `https://gitlab.com/api/v4/projects/88266251/packages/generic/saumcl/${version}/${name}`,
});

test("GitLab release names use the exact user-facing version order", () => {
  assert.equal(versionLabel(version), "Indev GL 19.3");
  assert.equal(versionLabel("19.3.1-indev.gl"), "Indev GL 19.3.1");
  assert.throws(() => versionLabel("19.3.0-indev"));
});

test("the update feed uses permanent package URLs before a release tag exists", () => {
  const [feed] = buildGitlabFeed(
    version,
    "Approved notes\r\n",
    [manifest("SAUMCL.exe"), manifest("SAUMCL")],
    commit,
    "2026-10-30T00:00:00Z"
  );
  assert.equal(feed.tag_name, `v${version}`);
  assert.equal(feed.body, "Approved notes");
  assert.equal(feed.draft, false);
  assert.equal(feed.assets.length, 2);
  assert.ok(
    feed.assets.every(
      (asset) =>
        asset.state === "uploaded" &&
        !asset.browser_download_url.includes("untagged-")
    )
  );
});

test("packages from another repository, commit, or version are rejected", () => {
  for (const mutation of [
    { url: "https://gitlab.com/other/project/file.exe" },
    { source_commit: "c".repeat(40) },
    { version: "19.2.0-indev" },
    { size: 0 },
    { sha256: "invalid" },
  ]) {
    assert.throws(() =>
      validateManifest(
        { ...manifest("SAUMCL.exe"), ...mutation },
        version,
        commit
      )
    );
  }
  assert.throws(() =>
    buildGitlabFeed(version, "Notes", [manifest("SAUMCL.exe")], commit, "now")
  );
  assert.throws(() =>
    buildGitlabFeed(
      version,
      "Notes",
      [manifest("SAUMCL.exe"), manifest("SAUMCL.exe")],
      commit,
      "now"
    )
  );
});

test("approval hashes compare normalized release notes exactly", () => {
  assert.equal(textHash(normalizeNotes("Notes\r\n")), textHash("Notes"));
  assert.notEqual(textHash("Notes"), textHash("Changed notes"));
});
