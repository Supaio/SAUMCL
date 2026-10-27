import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import {
  CAMPUS_OFFLINE_END_MS,
  buildHomeServers,
  campusClientIdentity,
  campusInstanceCandidates,
  campusInstanceKey,
  campusRoundEnded,
  observeCampus,
  parseCampusProfile,
  selectCampusInstance,
} from "../../src/utils/home-servers.ts";

const profile = JSON.parse(
  fs.readFileSync(new URL("../../public/campus-server.json", import.meta.url))
);
const campus = { ...profile, serverAddress: "campus.example.invalid:25566" };
const start = Date.UTC(2026, 9, 24);
const instance = (id) => ({ id, name: id, version: "1.21.8" });
const server = (ip) => ({ ip, name: "服务器", iconSrc: "" });
const installed = (id, fields = {}) => ({
  ...instance(id),
  modLoader: { loaderType: "Unknown", status: "Installed", version: "" },
  ...fields,
});

test("managed client identity follows pack content while address-only changes reuse it", () => {
  const configured = {
    ...campus,
    modpackVersion: "20.1",
    modpackUrl: "https://example.invalid/client.mrpack",
    modpackSha256: "a".repeat(64),
  };
  const identity = campusClientIdentity(configured);
  assert.equal(
    campusClientIdentity({
      ...configured,
      serverAddress: "other.example.invalid:25566",
      announcement: "New address",
      modpackUrl: "https://mirror.example.invalid/client.mrpack",
    }),
    identity
  );
  assert.notEqual(
    campusClientIdentity({ ...configured, modpackVersion: "20.2" }),
    identity
  );
  assert.notEqual(
    campusClientIdentity({ ...configured, currentRound: 21 }),
    identity
  );
  assert.notEqual(
    campusClientIdentity({ ...configured, modpackSha256: "b".repeat(64) }),
    identity
  );
});

test("old shared configuration accepts missing checksum while malformed hashes are rejected", () => {
  const legacy = { ...campus };
  delete legacy.modpackSha256;
  assert.equal(parseCampusProfile(legacy).modpackSha256, "");
  assert.equal(
    parseCampusProfile({ ...campus, modpackSha256: "incomplete" }),
    null
  );
  assert.equal(
    parseCampusProfile({ ...campus, modpackSha256: "a".repeat(64) })
      .modpackSha256,
    "a".repeat(64)
  );
});

test("campus launch can use an installed instance without a saved multiplayer entry", () => {
  const target = installed("campus-client");
  const profile = { ...campus, minecraftVersion: "1.21.8" };
  assert.deepEqual(buildHomeServers(profile, [])[0].instances, []);
  const candidates = campusInstanceCandidates(profile, [target]);
  assert.equal(selectCampusInstance(candidates)?.id, target.id);
});

test("campus candidates reject mismatched game, loader and pack versions", () => {
  const profile = {
    ...campus,
    minecraftVersion: "1.21.8",
    loader: "fabric",
    loaderVersion: "0.16.14",
    modpackVersion: "20.1",
  };
  const client = installed("campus", {
    modLoader: {
      loaderType: "Fabric",
      status: "Installed",
      version: "0.16.14",
    },
    modpackVersion: "20.1",
  });
  const wrongClients = [
    { ...client, id: "game", version: "1.21.7" },
    installed("vanilla", { modpackVersion: "20.1" }),
    {
      ...client,
      id: "loader",
      modLoader: { ...client.modLoader, version: "0.16.13" },
    },
    { ...client, id: "pack", modpackVersion: "19.1" },
    { ...client, id: "unknown-pack", modpackVersion: undefined },
  ];
  assert.deepEqual(
    campusInstanceCandidates(profile, [...wrongClients, client]),
    [client]
  );
  assert.deepEqual(campusInstanceCandidates(profile, wrongClients), []);
});

test("legacy Forge and Cleanroom clients can be selected for a Forge campus server", () => {
  const profile = { ...campus, minecraftVersion: "1.7.10", loader: "forge" };
  const clients = ["LegacyForge", "Cleanroom", "Forge"].map((loaderType) =>
    installed(loaderType, {
      version: "1.7.10",
      modLoader: { loaderType, status: "Installed" },
    })
  );
  assert.deepEqual(campusInstanceCandidates(profile, clients), clients);
});

test("campus selection remembers an explicit choice and does not guess among multiple clients", () => {
  const clients = [installed("first"), installed("second")];
  assert.equal(selectCampusInstance(clients), undefined);
  assert.equal(selectCampusInstance(clients, "second", "first")?.id, "second");
  assert.equal(selectCampusInstance(clients, "removed", "first")?.id, "first");
  assert.equal(
    selectCampusInstance(clients, "removed", "unrelated"),
    undefined
  );
  assert.equal(selectCampusInstance([clients[1]], "removed")?.id, "second");
  assert.equal(selectCampusInstance([], "removed"), undefined);
});

test("campus instance binding is invalidated by a new address, round or client requirements", () => {
  const key = campusInstanceKey(campus);
  assert.equal(campusInstanceKey({ ...campus, serverName: "更名" }), key);
  assert.equal(
    campusInstanceKey({
      ...campus,
      serverAddress: campus.serverAddress.toUpperCase(),
    }),
    key
  );
  for (const change of [
    { serverAddress: "new.example.invalid" },
    { currentRound: 20 },
    { minecraftVersion: "1.21.8" },
    { loader: "fabric" },
    { loaderVersion: "0.16.14" },
    { modpackVersion: "20.1" },
  ]) {
    assert.notEqual(campusInstanceKey({ ...campus, ...change }), key);
  }
});

test("campus stays first with no configured address and next round is 20", () => {
  const rows = buildHomeServers(profile, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].campus, true);
  assert.equal(rows[0].address, "");
  assert.equal(profile.nextRound, 20);
  assert.ok(!campusRoundEnded(profile, false, null, start));
});

test("servers merge across instances without losing instance choices or the pinned entry", () => {
  const rows = buildHomeServers(campus, [
    {
      instance: instance("first"),
      servers: [server("other.example.invalid"), server(campus.serverAddress)],
    },
    {
      instance: instance("second"),
      servers: [server("OTHER.example.invalid"), server(campus.serverAddress)],
    },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].campus, true);
  assert.deepEqual(
    rows[0].instances.map(({ id }) => id),
    ["first", "second"]
  );
  assert.deepEqual(
    rows[1].instances.map(({ id }) => id),
    ["first", "second"]
  );
});

test("explicit default port remains distinct from a bare hostname which may use SRV", () => {
  const rows = buildHomeServers(campus, [
    {
      instance: instance("first"),
      servers: [
        server("other.example.invalid"),
        server("other.example.invalid:25565"),
      ],
    },
  ]);
  assert.equal(rows.length, 3);
});

test("short failures stay offline, more than 48 hours marks ended, recovery resets it", () => {
  let observation = observeCampus(campus, null, false, start);
  assert.ok(!campusRoundEnded(campus, false, observation, start));
  assert.ok(
    !campusRoundEnded(campus, false, observation, start + CAMPUS_OFFLINE_END_MS)
  );
  observation = observeCampus(
    campus,
    observation,
    false,
    start + CAMPUS_OFFLINE_END_MS + 1
  );
  assert.ok(
    campusRoundEnded(
      campus,
      false,
      observation,
      start + CAMPUS_OFFLINE_END_MS + 1
    )
  );
  observation = observeCampus(
    campus,
    observation,
    true,
    start + CAMPUS_OFFLINE_END_MS + 2
  );
  assert.equal(observation.firstOfflineAt, null);
  assert.ok(
    !campusRoundEnded(
      campus,
      true,
      observation,
      start + CAMPUS_OFFLINE_END_MS + 2
    )
  );
});

test("changing address or round starts a fresh observation", () => {
  const previous = observeCampus(campus, null, false, start);
  const later = start + CAMPUS_OFFLINE_END_MS + 1;
  for (const change of [
    { serverAddress: "new.example.invalid" },
    { currentRound: 20 },
    { nextRound: 21 },
  ]) {
    const next = { ...campus, ...change };
    assert.ok(!campusRoundEnded(next, false, previous, later));
    const observation = observeCampus(next, previous, false, later);
    assert.equal(observation.firstOfflineAt, later);
  }
});

test("published offline timestamp gives a new player the shared 48-hour state", () => {
  const shared = { ...campus, offlineSince: new Date(start).toISOString() };
  const later = start + CAMPUS_OFFLINE_END_MS + 1;
  let observation = observeCampus(shared, null, false, later);
  assert.ok(campusRoundEnded(shared, false, observation, later));
  observation = observeCampus(shared, observation, true, later + 1);
  observation = observeCampus(shared, observation, false, later + 2);
  assert.equal(observation.firstOfflineAt, later + 2);
  assert.ok(!campusRoundEnded(shared, false, observation, later + 2));
});

test("explicit maintainer status overrides automatic detection", () => {
  const observation = observeCampus(campus, null, false, start);
  assert.ok(
    campusRoundEnded(
      { ...campus, roundState: "ended" },
      true,
      observation,
      start
    )
  );
  assert.ok(
    !campusRoundEnded(
      { ...campus, roundState: "active" },
      false,
      observation,
      start + CAMPUS_OFFLINE_END_MS + 1
    )
  );
  assert.ok(
    !campusRoundEnded(
      campus,
      undefined,
      observation,
      start + CAMPUS_OFFLINE_END_MS + 1
    )
  );
});

test("invalid or future local clock records cannot immediately mark a round ended", () => {
  const previous = observeCampus(
    campus,
    null,
    false,
    start + CAMPUS_OFFLINE_END_MS
  );
  const observation = observeCampus(campus, previous, false, start);
  assert.equal(observation.firstOfflineAt, start);
  assert.ok(!campusRoundEnded(campus, false, observation, start));
});

test("published configuration validates round fields and excludes unknown fields", () => {
  assert.equal(parseCampusProfile(profile).nextRound, 20);
  assert.equal(parseCampusProfile({ ...profile, nextRound: "20" }), null);
  assert.equal(parseCampusProfile({ ...profile, roundState: "maybe" }), null);
  assert.equal(
    parseCampusProfile({ ...profile, offlineSince: "invalid" }),
    null
  );
  assert.ok(
    !("unrelated" in parseCampusProfile({ ...profile, unrelated: "ignored" }))
  );
});
