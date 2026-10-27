import type {
  CampusObservation,
  HomeServer,
  InstanceServers,
} from "@/models/home-servers";
import type { InstanceSummary } from "@/models/instance/misc";
import type { CampusDraft } from "@/models/maintenance";

export const CAMPUS_OFFLINE_END_MS = 48 * 60 * 60 * 1000;
export const normalizeServerAddress = (address: string) =>
  address.trim().toLowerCase();

export function campusInstanceKey(profile: CampusDraft): string {
  return JSON.stringify([
    normalizeServerAddress(profile.serverAddress),
    profile.currentRound,
    profile.minecraftVersion.trim(),
    profile.loader,
    profile.loaderVersion.trim(),
    profile.modpackVersion.trim(),
    profile.modpackSha256?.toLowerCase() ?? "",
    profile.modpackUrl.trim(),
  ]);
}

export function campusInstanceCandidates(
  profile: CampusDraft,
  instances: InstanceSummary[]
): InstanceSummary[] {
  const loaders: Record<CampusDraft["loader"], string[]> = {
    none: ["Unknown"],
    fabric: ["Fabric"],
    forge: ["Forge", "LegacyForge", "Cleanroom"],
    neoforge: ["NeoForge"],
    quilt: ["Quilt"],
  };
  const version = profile.minecraftVersion.trim();
  const loaderVersion = profile.loaderVersion.trim();
  const modpackVersion = profile.modpackVersion.trim();
  return instances.filter(
    (instance) =>
      (!version || instance.version === version) &&
      loaders[profile.loader].includes(instance.modLoader.loaderType) &&
      (profile.loader === "none" ||
        !loaderVersion ||
        instance.modLoader.version === loaderVersion) &&
      (!modpackVersion || instance.modpackVersion === modpackVersion)
  );
}

export function selectCampusInstance(
  candidates: InstanceSummary[],
  savedId?: string,
  selectedId?: string
): InstanceSummary | undefined {
  return (
    candidates.find(({ id }) => id === savedId) ||
    candidates.find(({ id }) => id === selectedId) ||
    (candidates.length === 1 ? candidates[0] : undefined)
  );
}

export function parseCampusProfile(value: unknown): CampusDraft | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const fields = [
    "serverName",
    "serverAddress",
    "minecraftVersion",
    "loaderVersion",
    "modpackVersion",
    "modpackUrl",
    "announcement",
  ] as const;
  if (
    input.schemaVersion !== 1 ||
    typeof input.maintenance !== "boolean" ||
    !fields.every((field) => typeof input[field] === "string") ||
    /\s|:\/\//.test(String(input.serverAddress)) ||
    !["none", "fabric", "forge", "neoforge", "quilt"].includes(
      String(input.loader)
    )
  ) {
    return null;
  }
  const roundValid = (round: unknown) =>
    round === null ||
    (Number.isInteger(round) && Number(round) > 0 && Number(round) <= 9999);
  const currentRound = input.currentRound ?? null;
  const nextRound = input.nextRound === undefined ? 20 : input.nextRound;
  const roundState = input.roundState ?? "auto";
  const offlineSince = input.offlineSince ?? null;
  const modpackSha256 = input.modpackSha256 ?? "";
  if (
    !roundValid(currentRound) ||
    !roundValid(nextRound) ||
    !["auto", "active", "ended"].includes(String(roundState)) ||
    typeof modpackSha256 !== "string" ||
    (modpackSha256 !== "" && !/^[a-f\d]{64}$/i.test(modpackSha256)) ||
    (offlineSince !== null &&
      (typeof offlineSince !== "string" ||
        !Number.isFinite(Date.parse(offlineSince))))
  ) {
    return null;
  }
  return {
    ...Object.fromEntries(fields.map((field) => [field, input[field]])),
    schemaVersion: 1,
    loader: input.loader,
    maintenance: input.maintenance,
    currentRound,
    nextRound,
    roundState,
    offlineSince,
    modpackSha256,
  } as CampusDraft;
}

export function campusClientIdentity(profile: CampusDraft): string {
  const hash = profile.modpackSha256?.toLowerCase() ?? "";
  return JSON.stringify([
    profile.currentRound,
    profile.minecraftVersion.trim(),
    profile.loader,
    profile.loaderVersion.trim(),
    profile.modpackVersion.trim(),
    hash ? "" : profile.modpackUrl.trim(),
    hash,
  ]);
}

export function buildHomeServers(
  campus: CampusDraft,
  groups: InstanceServers[]
): HomeServer[] {
  const pinned: HomeServer = {
    id: "campus",
    name: campus.serverName,
    address: campus.serverAddress.trim(),
    iconSrc: "",
    campus: true,
    instances: [],
  };
  const rows: HomeServer[] = [pinned];
  const byAddress = new Map<string, HomeServer>();
  if (pinned.address) {
    byAddress.set(normalizeServerAddress(pinned.address), pinned);
  }
  for (const { instance, servers } of groups) {
    for (const server of servers) {
      const address = server.ip.trim();
      if (!address) continue;
      const key = normalizeServerAddress(address);
      let row = byAddress.get(key);
      if (!row) {
        row = {
          id: key,
          name: server.name || address,
          address,
          iconSrc: server.iconSrc,
          campus: false,
          instances: [],
        };
        rows.push(row);
        byAddress.set(key, row);
      }
      if (!row.instances.some(({ id }) => id === instance.id)) {
        row.instances.push(instance);
      }
    }
  }
  return rows;
}

export function observeCampus(
  profile: CampusDraft,
  previous: CampusObservation | null,
  online: boolean,
  now: number
): CampusObservation {
  const key = `${normalizeServerAddress(profile.serverAddress)}|${profile.currentRound ?? ""}|${profile.nextRound ?? ""}`;
  const validTime = (value: unknown): value is number =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= now;
  const history = previous?.key === key ? previous : null;
  const lastOnlineAt = validTime(history?.lastOnlineAt)
    ? history.lastOnlineAt
    : null;
  if (online) return { key, firstOfflineAt: null, lastOnlineAt: now };
  const publishedSince = profile.offlineSince
    ? Date.parse(profile.offlineSince)
    : Number.NaN;
  const sharedSince =
    validTime(publishedSince) &&
    (lastOnlineAt === null || publishedSince > lastOnlineAt)
      ? publishedSince
      : null;
  const localSince = validTime(history?.firstOfflineAt)
    ? history.firstOfflineAt
    : now;
  return { key, firstOfflineAt: sharedSince ?? localSince, lastOnlineAt };
}

export function campusRoundEnded(
  profile: CampusDraft,
  online: boolean | undefined,
  observation: CampusObservation | null,
  now: number
): boolean {
  if (profile.roundState === "ended") return true;
  if (
    profile.roundState !== "auto" ||
    !profile.serverAddress.trim() ||
    online !== false ||
    observation?.firstOfflineAt == null
  ) {
    return false;
  }
  const key = `${normalizeServerAddress(profile.serverAddress)}|${profile.currentRound ?? ""}|${profile.nextRound ?? ""}`;
  return (
    observation.key === key &&
    now - observation.firstOfflineAt > CAMPUS_OFFLINE_END_MS
  );
}
