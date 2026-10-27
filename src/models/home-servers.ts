import type { GameServerInfo, InstanceSummary } from "@/models/instance/misc";

export type ServerInstance = Pick<InstanceSummary, "id" | "name" | "version">;

export interface InstanceServers {
  instance: ServerInstance;
  servers: GameServerInfo[];
}

export interface HomeServer {
  id: string;
  name: string;
  address: string;
  iconSrc: string;
  campus: boolean;
  instances: ServerInstance[];
}

export interface CampusObservation {
  key: string;
  firstOfflineAt: number | null;
  lastOnlineAt: number | null;
}
