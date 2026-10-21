import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const [gameDirectory, runtimeDirectory, minecraftVersion, reportPath] =
  process.argv.slice(2);
const endpoint = "http://127.0.0.1:18970/mcp";
const instanceName = "SAUMCL-Clean-Install";
const report = {
  passed: false,
  minecraftVersion,
  platform: "windows-x86_64",
  emptyGameDirectory: false,
  javaBefore: null,
  javaAfter: null,
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let sessionId;
let protocol = "2025-06-18";
let nextId = 0;
let phase = "startup";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function inside(root, relative) {
  const file = path.resolve(root, relative);
  assert(
    file.toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep),
    "Manifest path escapes the test directory"
  );
  return file;
}
async function rpc(method, params, notification = false) {
  const body = { jsonrpc: "2.0", method, params };
  if (!notification) body.id = ++nextId;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": protocol,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  sessionId = response.headers.get("Mcp-Session-Id") ?? sessionId;
  assert(response.ok, `Local MCP HTTP ${response.status}`);
  const text = await response.text();
  if (!text) return null;
  const messages = text.trimStart().startsWith("{")
    ? [JSON.parse(text)]
    : text
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:") && line.slice(5).trim())
        .map((line) => JSON.parse(line.slice(5).trim()));
  const message = messages.find((value) => value.id === body.id);
  assert(
    !message?.error && !message?.result?.isError,
    "Native launcher request failed"
  );
  return message?.result;
}
async function tool(name, args = {}) {
  const result = await rpc("tools/call", { name, arguments: args });
  return result?.structuredContent;
}
async function json(url, expectedHash) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  assert(response.ok, `Official metadata HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (expectedHash)
    assert(
      crypto.createHash("sha1").update(bytes).digest("hex") === expectedHash,
      "Official metadata checksum mismatch"
    );
  return JSON.parse(bytes.toString("utf8"));
}
async function hashFile(file) {
  const hash = crypto.createHash("sha1");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function waitFiles(entries, timeoutMs = 600000) {
  const deadline = Date.now() + timeoutMs;
  let lastOutput = 0;
  while (Date.now() < deadline) {
    let complete = 0;
    for (const entry of entries) {
      const stat = await fsp.stat(entry.file).catch(() => null);
      if (
        stat?.isFile() &&
        (entry.size === undefined || stat.size === entry.size)
      )
        complete++;
    }
    if (Date.now() - lastOutput > 15000 || complete === entries.length) {
      console.log(`${phase}: ${complete}/${entries.length} files available`);
      lastOutput = Date.now();
    }
    if (complete === entries.length) return;
    await sleep(2000);
  }
  throw new Error("Timed out waiting for native launcher downloads");
}
async function verify(entries) {
  let cursor = 0;
  let verified = 0;
  let existenceOnly = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (cursor < entries.length) {
        const entry = entries[cursor++];
        const stat = await fsp.stat(entry.file);
        assert(
          stat.isFile() &&
            (entry.size === undefined || stat.size === entry.size),
          "Installed file size mismatch"
        );
        if (entry.sha1) {
          assert(
            (await hashFile(entry.file)) === entry.sha1,
            "Installed file checksum mismatch"
          );
          verified++;
        } else existenceOnly++;
      }
    })
  );
  return { files: entries.length, sha1Verified: verified, existenceOnly };
}

try {
  assert(
    (await fsp.readdir(gameDirectory)).length === 0,
    "Game directory is not empty"
  );
  report.emptyGameDirectory = true;
  assert(!fs.existsSync(runtimeDirectory), "Test runtime already exists");
  for (let attempt = 0; ; attempt++) {
    try {
      const initialized = await rpc("initialize", {
        protocolVersion: protocol,
        capabilities: {},
        clientInfo: { name: "SAUMCL-installation-smoke", version: "1.0" },
      });
      protocol = initialized.protocolVersion;
      await rpc("notifications/initialized", {}, true);
      break;
    } catch {
      assert(attempt < 45, "Launcher MCP endpoint did not become ready");
      sessionId = undefined;
      await sleep(1000);
    }
  }
  phase = "java-before-install";
  const before = (await tool("retrieve_java_list"))?.items;
  assert(Array.isArray(before), "Java inventory response is invalid");
  report.javaBefore = {
    count: before.length,
    majorVersions: before.map((value) => value.majorVersion),
  };
  assert(
    before.length === 0,
    "The disposable runner still exposes an existing Java runtime"
  );
  console.log("Native launcher Java inventory is empty");

  phase = "create-instance";
  await tool("create_instance", {
    directory_name: "INSTALL_SMOKE",
    directory_path: gameDirectory,
    name: instanceName,
    game_version: minecraftVersion,
    mod_loader_type: "unknown",
    is_install_fabric_api: false,
    is_install_qf_api: false,
  });
  const instanceDirectory = inside(gameDirectory, "versions/" + instanceName);
  const manifest = JSON.parse(
    await fsp.readFile(
      path.join(instanceDirectory, instanceName + ".json"),
      "utf8"
    )
  );
  assert(
    manifest.javaVersion.majorVersion === 25,
    "This Windows smoke test expects Java 25"
  );
  const officialAssets = await json(
    manifest.assetIndex.url,
    manifest.assetIndex.sha1
  );
  const localAssets = JSON.parse(
    await fsp.readFile(
      inside(
        gameDirectory,
        "assets/indexes/" + manifest.assetIndex.id + ".json"
      ),
      "utf8"
    )
  );
  const assetNames = Object.keys(officialAssets.objects);
  assert(
    assetNames.length === Object.keys(localAssets.objects).length &&
      assetNames.every(
        (key) =>
          officialAssets.objects[key].hash === localAssets.objects[key]?.hash &&
          officialAssets.objects[key].size === localAssets.objects[key]?.size
      ),
    "Installed asset index differs from official metadata"
  );
  const runtimeCatalog = await json(
    "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json"
  );
  const runtimeInfo =
    runtimeCatalog["windows-x64"]["java-runtime-epsilon"][0].manifest;
  const runtime = await json(runtimeInfo.url, runtimeInfo.sha1);
  const runtimeFiles = Object.entries(runtime.files)
    .filter(([, value]) => value.type === "file")
    .map(([name, value]) => {
      const raw = value.downloads.raw;
      return {
        file: inside(runtimeDirectory, name),
        sha1: raw.sha1,
        size: raw.size,
      };
    });
  const assetFiles = [
    ...new Map(
      Object.values(officialAssets.objects).map((value) => [
        value.hash,
        {
          file: inside(
            gameDirectory,
            "assets/objects/" + value.hash.slice(0, 2) + "/" + value.hash
          ),
          sha1: value.hash,
          size: value.size,
        },
      ])
    ).values(),
  ];
  const libraries = new Map();
  for (const library of manifest.libraries) {
    let allowed = !library.rules;
    for (const rule of library.rules ?? []) {
      assert(
        !rule.features && !rule.os?.version && !rule.os?.arch,
        "Unsupported library rule needs review"
      );
      if (!rule.os?.name || rule.os.name === "windows")
        allowed = rule.action === "allow";
    }
    if (!allowed) continue;
    assert(!library.natives, "Legacy natives need separate validation");
    const artifact = library.downloads?.artifact;
    assert(artifact?.path, "Vanilla library has no artifact path");
    libraries.set(artifact.path, {
      file: inside(gameDirectory, "libraries/" + artifact.path),
      sha1: artifact.sha1 || undefined,
      size: artifact.size,
    });
  }
  const client = manifest.downloads.client;
  const clientFiles = [
    {
      file: path.join(instanceDirectory, instanceName + ".jar"),
      sha1: client.sha1,
      size: client.size,
    },
  ];
  const libraryFiles = [...libraries.values()];
  phase = "native-downloads";
  await waitFiles([
    ...clientFiles,
    ...libraryFiles,
    ...assetFiles,
    ...runtimeFiles,
  ]);
  phase = "integrity";
  report.client = await verify(clientFiles);
  report.libraries = await verify(libraryFiles);
  report.assets = await verify(assetFiles);
  report.javaRuntime = await verify(runtimeFiles);
  report.assetIndexContentVerified = true;
  phase = "java-after-install";
  const after = (await tool("retrieve_java_list"))?.items;
  assert(Array.isArray(after), "Installed Java inventory response is invalid");
  const expectedJava = path
    .join(runtimeDirectory, "bin/java.exe")
    .toLowerCase();
  const detected = after.find(
    (value) =>
      path.resolve(value.execPath).toLowerCase() === expectedJava &&
      value.majorVersion === 25
  );
  assert(
    detected,
    "Native launcher did not detect its automatically downloaded Java 25"
  );
  const execution = spawnSync(detected.execPath, ["-version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  assert(
    execution.status === 0,
    "Automatically downloaded Java does not execute"
  );
  const version = /(?:openjdk|java) version "([0-9][0-9a-zA-Z.+_-]*)"/.exec(
    execution.stderr + execution.stdout
  )?.[1];
  assert(
    version?.startsWith("25"),
    "Automatically downloaded Java reports an unexpected version"
  );
  report.javaAfter = {
    count: after.length,
    downloadedJavaDetected: true,
    majorVersion: detected.majorVersion,
    version,
    executionExitCode: execution.status,
  };
  report.automaticJavaDownload = true;
  report.manualJavaDownloadCommandUsed = false;
  const listed = (await tool("retrieve_instance_list"))?.items;
  assert(
    listed?.some(
      (value) =>
        value.name === instanceName && value.version === minecraftVersion
    ),
    "Completed instance is not listed by the native launcher"
  );
  report.nativeInstanceListed = true;
  report.passed = true;
  console.log(
    "Clean Minecraft installation and automatic Java download passed"
  );
} catch (error) {
  // Keep reports free of request headers, session identifiers and account data.
  report.failure = { phase, message: error.message, code: error.cause?.code };
  process.exitCode = 1;
} finally {
  await fsp.mkdir(path.dirname(reportPath), { recursive: true });
  await fsp.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (sessionId)
    await fetch(endpoint, {
      method: "DELETE",
      headers: {
        "Mcp-Session-Id": sessionId,
        "MCP-Protocol-Version": protocol,
      },
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
}
