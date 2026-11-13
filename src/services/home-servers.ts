import { invoke } from "@tauri-apps/api/core";
import { InstanceServers, ServerInstance } from "@/models/home-servers";
import { GameServerInfo } from "@/models/instance/misc";
import { CampusDraft } from "@/models/maintenance";
import { InstanceService } from "@/services/instance";
import { MaintenanceService } from "@/services/maintenance";
import { parseCampusProfile } from "@/utils/home-servers";

// Maintainers publish the shared school-server profile in this repository.
export const CAMPUS_CONFIG_URLS = [
  "https://raw.githubusercontent.com/Supaio/SAUMCL/main/public/campus-server.json",
  "https://gitlab.com/Supaio/saumcl/-/raw/main/public/campus-server.json",
];
export const CAMPUS_CONFIG_URL = CAMPUS_CONFIG_URLS[0];
const CONFIG_CACHE_KEY = "saumcl.campus.profile";
export const CAMPUS_PROFILE_UPDATED_EVENT = "saumcl-campus-profile-updated";

interface CampusConfigResult {
  profile: CampusDraft;
  preview: boolean;
  stale: boolean;
}

export class HomeServersService {
  private static campusRequest: Promise<CampusConfigResult> | null = null;

  static retrieveCampus(force = false): Promise<CampusConfigResult> {
    if (!force && this.campusRequest) return this.campusRequest;
    const request = this.retrieveCampusFromSources()
      .then((result) => {
        if (this.campusRequest === request) {
          window.dispatchEvent(
            new CustomEvent(CAMPUS_PROFILE_UPDATED_EVENT, {
              detail: result.profile,
            })
          );
        }
        return result;
      })
      .finally(() => {
        if (this.campusRequest === request) this.campusRequest = null;
      });
    this.campusRequest = request;
    return request;
  }

  private static async retrieveCampusFromSources(): Promise<CampusConfigResult> {
    const preview = await MaintenanceService.retrievePreview().catch(
      () => null
    );
    if (preview) return { profile: preview, preview: true, stale: false };
    if (CAMPUS_CONFIG_URL) {
      try {
        const profile = parseCampusProfile(
          await invoke("retrieve_shared_campus_config")
        );
        if (!profile) throw new Error("INVALID_CAMPUS_CONFIG");
        try {
          localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(profile));
        } catch {
          // A readable response still works when local storage is unavailable.
        }
        return { profile, preview: false, stale: false };
      } catch {
        try {
          const profile = parseCampusProfile(
            JSON.parse(localStorage.getItem(CONFIG_CACHE_KEY) || "null")
          );
          if (profile) return { profile, preview: false, stale: true };
        } catch {
          // Fall back to the bundled profile when no usable cache is available.
        }
      }
    }
    const response = await fetch("/campus-server.json", { cache: "no-store" });
    const profile = parseCampusProfile(await response.json());
    if (!response.ok || !profile) throw new Error("INVALID_CAMPUS_CONFIG");
    return { profile, preview: false, stale: Boolean(CAMPUS_CONFIG_URL) };
  }

  static async retrieveLocal(instances: ServerInstance[]) {
    const results = await Promise.allSettled(
      instances.map(async (instance): Promise<InstanceServers> => {
        const response = await InstanceService.retrieveGameServerList(
          instance.id,
          false
        );
        if (response.status !== "success")
          throw new Error("SERVER_LIST_FAILED");
        return { instance, servers: response.data };
      })
    );
    const groups = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    return { groups, incomplete: groups.length !== instances.length };
  }

  static queryAddresses(addresses: string[]): Promise<GameServerInfo[]> {
    return invoke("query_game_server_addresses", { addresses });
  }
}
