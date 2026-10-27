import { invoke } from "@tauri-apps/api/core";
import { PlaytimeStats } from "@/models/playtime";

export class PlaytimeService {
  static retrieveStats(): Promise<PlaytimeStats> {
    return invoke("retrieve_playtime_stats");
  }
}
