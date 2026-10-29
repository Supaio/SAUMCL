const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PROJECT_ID = "88266251";
const PROJECT_URL = "https://gitlab.com/Supaio/saumcl";
const API = `https://gitlab.com/api/v4/projects/${PROJECT_ID}`;
const PACKAGE_BASE = `${API}/packages/generic/saumcl`;
const ROOT = path.resolve(__dirname, "../..");

function versionLabel(version) {
  const match = version.match(/^(\d+\.\d+\.\d+)-indev\.gl$/);
  if (!match) throw new Error("A GitLab Indev version is required");
  return `Indev GL ${match[1].replace(/\.0$/, "")}`;
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
  const notesPath = path.join(ROOT, "docs/releases/indev-gl-19.3.0.md");
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
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    const manifest = {
      name,
      version,
      source_commit: commit,
      size: fs.statSync(filePath).size,
      sha256: hash.digest("hex"),
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
    const build = await publicJson("release-build.json");
    if (build.version !== version || build.source_commit !== commit)
      throw new Error("Published packages were built from different source");
    writeMetadata(build.files, commit);
    for (const name of ["updates.json", "release-build.json"])
      await upload(name, path.join(artifacts, name));
    const names = ["SAUMCL.exe", "SAUMCL", "SHA256SUMS.txt", "updates.json"];
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
  normalizeNotes,
  textHash,
  validateManifest,
  versionLabel,
};
