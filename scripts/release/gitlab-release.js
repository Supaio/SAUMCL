const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");

const PROJECT_ID = "88266251";
const PROJECT_URL = "https://gitlab.com/Supaio/saumcl";
const API = `https://gitlab.com/api/v4/projects/${PROJECT_ID}`;
const PACKAGE_BASE = `${API}/packages/generic/saumcl`;
const ROOT = path.resolve(__dirname, "../..");
const PLATFORM_FILES = ["SAUMCL.exe", "SAUMCL"];
const GITHUB_PROJECT = "Supaio/SAUMCL";

function versionLabel(version) {
  const match = version.match(/^(\d+\.\d+\.\d+)-indev(\.gl)?$/);
  if (!match) throw new Error("An Indev version is required");
  return `Indev ${match[2] ? "GL " : ""}${match[1].replace(/\.0$/, "")}`;
}

const textHash = (text) =>
  crypto.createHash("sha256").update(text).digest("hex");
const normalizeNotes = (text) => text.replace(/\r\n/g, "\n").trimEnd();

function validateManifest(manifest, version, commit) {
  if (
    !["SAUMCL.exe", "SAUMCL"].includes(manifest.name) ||
    manifest.version !== version ||
    manifest.source_commit !== commit ||
    !Number.isSafeInteger(manifest.size) ||
    manifest.size <= 0 ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
    manifest.url !== `${PACKAGE_BASE}/${version}/${manifest.name}`
  ) {
    throw new Error("The package manifest does not match the verified source");
  }
  return manifest;
}

function buildGitlabFeed(version, notes, manifests, commit, publishedAt) {
  versionLabel(version);
  if (
    manifests.length !== 2 ||
    new Set(manifests.map((file) => file.name)).size !== 2
  ) {
    throw new Error("Both Windows and Linux packages are required");
  }
  return [
    {
      tag_name: `v${version}`,
      draft: false,
      prerelease: false,
      body: normalizeNotes(notes),
      published_at: publishedAt,
      assets: manifests.map((file) => {
        validateManifest(file, version, commit);
        return {
          name: file.name,
          state: "uploaded",
          size: file.size,
          browser_download_url: file.url,
        };
      }),
    },
  ];
}

function githubMirrorAssets(release, version, notes, commit) {
  const tag = `v${version}`;
  if (
    release.tag_name !== tag ||
    release.target_commitish !== commit ||
    release.draft !== false ||
    release.prerelease !== false ||
    !release.published_at ||
    typeof release.body !== "string" ||
    normalizeNotes(release.body) !== notes
  ) {
    throw new Error(
      "The GitHub release does not match the approved source and notes"
    );
  }

  return PLATFORM_FILES.map((name) => {
    const url = `https://github.com/${GITHUB_PROJECT}/releases/download/${tag}/${name}`;
    const asset = release.assets?.find((value) => value.name === name);
    if (
      asset?.state !== "uploaded" ||
      asset.browser_download_url !== url ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      !/^sha256:[a-f0-9]{64}$/.test(asset.digest || "")
    ) {
      throw new Error(`Verified GitHub asset is missing: ${name}`);
    }
    return { name, url, size: asset.size, sha256: asset.digest.slice(7) };
  });
}

async function fileHash(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const version = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8")
  ).version;
  const title = versionLabel(version);
  const commit = process.env.CI_COMMIT_SHA;
  if (
    process.env.CI_PROJECT_ID !== PROJECT_ID ||
    process.env.CI_PROJECT_URL !== PROJECT_URL ||
    !/^[a-f0-9]{40}$/.test(commit || "") ||
    !process.env.CI_JOB_TOKEN
  ) {
    throw new Error(
      "Run this command in the authorized SAUMCL GitLab pipeline"
    );
  }
  const artifacts = path.join(ROOT, "artifacts");
  fs.mkdirSync(artifacts, { recursive: true });
  const number = version.split("-")[0];
  const notesName = `${version.endsWith(".gl") ? "indev-gl" : "indev"}-${number}.md`;
  const notesPath = path.join(ROOT, "docs/releases", notesName);
  const notes = normalizeNotes(
    process.env.SAUMCL_RELEASE_NOTES || fs.readFileSync(notesPath, "utf8")
  );
  const command = process.argv[2];

  async function request(endpoint, options = {}) {
    const response = await fetch(`${API}${endpoint}`, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(60000),
      headers: {
        "JOB-TOKEN": process.env.CI_JOB_TOKEN,
        "User-Agent": "SAUMCL-Release",
        ...options.headers,
      },
    });
    if (!response.ok)
      throw new Error(`GitLab request failed: HTTP ${response.status}`);
    return response;
  }

  async function upload(name, filePath) {
    const size = fs.statSync(filePath).size;
    const response = await fetch(`${PACKAGE_BASE}/${version}/${name}`, {
      method: "PUT",
      body: fs.createReadStream(filePath),
      duplex: "half",
      redirect: "error",
      signal: AbortSignal.timeout(300000),
      headers: {
        "JOB-TOKEN": process.env.CI_JOB_TOKEN,
        "User-Agent": "SAUMCL-Release",
        "Content-Type": "application/octet-stream",
        "Content-Length": String(size),
      },
    });
    if (!response.ok)
      throw new Error(
        `Package upload failed: ${name}, HTTP ${response.status}`
      );
    console.log(`Uploaded ${name} (${size} bytes)`);
  }

  async function publicJson(name) {
    // Public downloads follow storage redirects without forwarding CI credentials.
    const response = await fetch(`${PACKAGE_BASE}/${version}/${name}`, {
      signal: AbortSignal.timeout(60000),
      headers: { "Cache-Control": "no-cache", "User-Agent": "SAUMCL-Release" },
    });
    if (!response.ok)
      throw new Error(
        `Public package unavailable: ${name}, HTTP ${response.status}`
      );
    return response.json();
  }

  async function mirrorGithubBuild() {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_PROJECT}/releases/tags/v${version}`,
      {
        signal: AbortSignal.timeout(60000),
        redirect: "error",
        headers: { "User-Agent": "SAUMCL-Release" },
      }
    );
    if (!response.ok)
      throw new Error(`GitHub release unavailable: HTTP ${response.status}`);
    const assets = githubMirrorAssets(
      await response.json(),
      version,
      notes,
      commit
    );
    const manifests = [];
    for (const asset of assets) {
      const download = await fetch(asset.url, {
        signal: AbortSignal.timeout(300000),
      });
      if (!download.ok || !download.body) {
        throw new Error(
          `GitHub asset download failed: ${asset.name}, HTTP ${download.status}`
        );
      }
      const filePath = path.join(artifacts, asset.name);
      await pipeline(download.body, fs.createWriteStream(filePath));
      if (
        fs.statSync(filePath).size !== asset.size ||
        (await fileHash(filePath)) !== asset.sha256
      ) {
        throw new Error(`GitHub asset checksum mismatch: ${asset.name}`);
      }
      manifests.push({
        name: asset.name,
        version,
        source_commit: commit,
        size: asset.size,
        sha256: asset.sha256,
        url: `${PACKAGE_BASE}/${version}/${asset.name}`,
      });
    }
    for (const { name } of manifests)
      await upload(name, path.join(artifacts, name));
    return manifests;
  }

  function writeMetadata(manifests, sourceCommit) {
    const feed = buildGitlabFeed(
      version,
      notes,
      manifests,
      sourceCommit,
      new Date().toISOString()
    );
    fs.writeFileSync(
      path.join(artifacts, "updates.json"),
      JSON.stringify(feed, null, 2) + "\n"
    );
    fs.writeFileSync(
      path.join(artifacts, "SHA256SUMS.txt"),
      manifests.map((file) => `${file.sha256}  ${file.name}`).join("\n") + "\n"
    );
    const build = {
      version,
      source_commit: sourceCommit,
      notes_sha256: textHash(notes),
      files: manifests,
    };
    fs.writeFileSync(
      path.join(artifacts, "release-build.json"),
      JSON.stringify(build, null, 2) + "\n"
    );
    return build;
  }

  if (command === "upload") {
    const filePath = path.resolve(process.argv[3] || "");
    const name = path.basename(filePath);
    const platform = process.argv[4];
    if (
      !(
        (platform === "windows" && name === "SAUMCL.exe") ||
        (platform === "linux" && name === "SAUMCL")
      )
    ) {
      throw new Error("Unexpected platform package filename");
    }
    const manifest = {
      name,
      version,
      source_commit: commit,
      size: fs.statSync(filePath).size,
      sha256: await fileHash(filePath),
      url: `${PACKAGE_BASE}/${version}/${name}`,
    };
    validateManifest(manifest, version, commit);
    await upload(name, filePath);
    fs.writeFileSync(
      path.join(artifacts, `${platform}.json`),
      JSON.stringify(manifest, null, 2) + "\n"
    );
    return;
  }

  if (command === "prepare") {
    const manifests = ["windows", "linux"].map((platform) =>
      JSON.parse(
        fs.readFileSync(path.join(artifacts, `${platform}.json`), "utf8")
      )
    );
    writeMetadata(manifests, commit);
    for (const name of ["SHA256SUMS.txt", "updates.json", "release-build.json"])
      await upload(name, path.join(artifacts, name));
    console.log(
      "Both platform packages and update metadata are ready; release-note approval is still required."
    );
    return;
  }

  if (command === "publish") {
    if (
      process.env.RELEASE_ONLY !== "true" ||
      process.env.APPROVED_NOTES_SHA256 !== textHash(notes)
    ) {
      throw new Error(
        "Explicit approval of the exact release notes is required"
      );
    }
    const mirrorGithub = process.env.MIRROR_GITHUB_RELEASE === "true";
    const build = mirrorGithub ? null : await publicJson("release-build.json");
    if (build && (build.version !== version || build.source_commit !== commit))
      throw new Error("Published packages were built from different source");
    writeMetadata(build ? build.files : await mirrorGithubBuild(), commit);
    const metadata = ["updates.json", "release-build.json"];
    if (mirrorGithub) metadata.push("SHA256SUMS.txt");
    for (const name of metadata) await upload(name, path.join(artifacts, name));
    const names = [...PLATFORM_FILES, "SHA256SUMS.txt", "updates.json"];
    const body = {
      name: title,
      tag_name: `v${version}`,
      ref: commit,
      description: notes,
      assets: {
        links: names.map((name) => ({
          name,
          url: `${PACKAGE_BASE}/${version}/${name}`,
          direct_asset_path: `/${name}`,
          link_type: "package",
        })),
      },
    };
    const response = await request("/releases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const release = await response.json();
    if (
      release.name !== title ||
      release.tag_name !== `v${version}` ||
      normalizeNotes(release.description) !== notes ||
      release.assets?.links?.length !== 4
    ) {
      throw new Error("Release verification failed");
    }
    const feed = await publicJson("updates.json");
    if (feed[0]?.body !== notes || feed[0]?.tag_name !== `v${version}`)
      throw new Error("Published update feed verification failed");
    console.log(`Published ${title}: ${PROJECT_URL}/-/releases/v${version}`);
    return;
  }
  throw new Error(
    "Usage: gitlab-release.js upload <binary> <windows|linux> | prepare | publish"
  );
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

module.exports = {
  buildGitlabFeed,
  githubMirrorAssets,
  normalizeNotes,
  textHash,
  validateManifest,
  versionLabel,
};
