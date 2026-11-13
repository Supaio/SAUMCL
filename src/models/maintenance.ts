export interface MaintainerIdentity {
  id: string;
  name: string;
  accountUuid: string;
}

export interface MaintenanceStatus {
  configured: boolean;
  accountUuid: string | null;
  identity: MaintainerIdentity | null;
  invalidSavedKey: boolean;
}

export interface CampusDraft {
  schemaVersion: number;
  serverName: string;
  serverAddress: string;
  minecraftVersion: string;
  loader: "none" | "fabric" | "forge" | "neoforge" | "quilt";
  loaderVersion: string;
  modpackVersion: string;
  modpackUrl: string;
  modpackSha256: string;
  announcement: string;
  maintenance: boolean;
  currentRound: number | null;
  nextRound: number | null;
  roundState: "auto" | "active" | "ended";
  offlineSince: string | null;
}
