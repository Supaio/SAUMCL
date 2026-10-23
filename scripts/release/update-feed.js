const fs = require("node:fs");

function buildUpdateFeed(releases, publishingReleaseId) {
  return releases
    .filter((release) => !release.draft || release.id === publishingReleaseId)
    .map((release) => ({
      tag_name: release.tag_name,
      draft: false,
      prerelease: release.prerelease,
      body: release.body || "",
      published_at: release.published_at || new Date().toISOString(),
      assets: release.assets
        .filter(
          (asset) =>
            ["SAUMCL.exe", "SAUMCL"].includes(asset.name) &&
            asset.state === "uploaded" &&
            asset.size > 0
        )
        .map(({ name, state, size, browser_download_url }) => ({
          name,
          state,
          size,
          browser_download_url,
        })),
    }))
    .filter((release) => release.assets.length > 0);
}

if (require.main === module) {
  const [input, output, publishingReleaseId] = process.argv.slice(2);
  if (!input || !output) {
    throw new Error(
      "Usage: node update-feed.js releases.json updates.json [publishing-release-id]"
    );
  }
  const releases = JSON.parse(fs.readFileSync(input, "utf8"));
  const feed = buildUpdateFeed(releases, Number(publishingReleaseId));
  fs.writeFileSync(output, JSON.stringify(feed, null, 2) + "\n");
}

module.exports = { buildUpdateFeed };
