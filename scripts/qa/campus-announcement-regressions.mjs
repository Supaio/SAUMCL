import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { parseCampusProfile } from "../../src/utils/home-servers.ts";

const profile = JSON.parse(
  fs.readFileSync(new URL("../../public/campus-server.json", import.meta.url))
);
const source = ts.transpileModule(
  fs.readFileSync(
    new URL("../../src/services/home-servers.ts", import.meta.url),
    "utf8"
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }
).outputText;

const setup = () => {
  const state = {
    preview: null,
    remote: async () => profile,
    cached: null,
    bundled: profile,
    requests: 0,
  };
  const events = [];
  const context = {
    exports: {},
    require(name) {
      if (name === "@tauri-apps/api/core")
        return {
          invoke: async () => {
            state.requests++;
            return state.remote();
          },
        };
      if (name === "@/services/instance") return { InstanceService: {} };
      if (name === "@/services/maintenance")
        return {
          MaintenanceService: { retrievePreview: async () => state.preview },
        };
      if (name === "@/utils/home-servers") return { parseCampusProfile };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    window: { dispatchEvent: (event) => events.push(event) },
    localStorage: {
      getItem: () => JSON.stringify(state.cached),
      setItem: () => {},
    },
    fetch: async () => ({ ok: true, json: async () => state.bundled }),
  };
  vm.runInNewContext(source, context);
  return { state, events, service: context.exports.HomeServersService };
};

test("banner and server tile share an in-flight configuration request", async () => {
  const { state, events, service } = setup();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  state.remote = () => gate;
  const banner = service.retrieveCampus();
  const tile = service.retrieveCampus();
  assert.equal(banner, tile);
  release({ ...profile, announcement: "QA notice" });
  await Promise.all([banner, tile]);
  assert.equal(state.requests, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.announcement, "QA notice");
});

test("a new maintenance preview cannot be overwritten by an older remote response", async () => {
  const { state, events, service } = setup();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  state.remote = () => gate;
  const old = service.retrieveCampus();
  await new Promise((resolve) => setImmediate(resolve));
  state.preview = { ...profile, announcement: "New preview" };
  await service.retrieveCampus(true);
  release({ ...profile, announcement: "Old public notice" });
  await old;
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.announcement, "New preview");
});

test("an explicitly cleared announcement is delivered to hide the banner", async () => {
  const { state, events, service } = setup();
  state.remote = async () => ({ ...profile, announcement: "Existing notice" });
  await service.retrieveCampus();
  state.remote = async () => ({ ...profile, announcement: "" });
  await service.retrieveCampus();
  assert.deepEqual(
    events.map((event) => event.detail.announcement),
    ["Existing notice", ""]
  );
});

test("source failures do not publish a false empty notice and later requests recover", async () => {
  const { state, events, service } = setup();
  state.remote = async () => {
    throw new Error("QA unreachable");
  };
  state.bundled = null;
  await assert.rejects(service.retrieveCampus());
  assert.equal(events.length, 0);
  state.remote = async () => ({ ...profile, announcement: "Recovered notice" });
  await service.retrieveCampus();
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.announcement, "Recovered notice");
});
