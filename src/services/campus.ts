import { invoke } from "@tauri-apps/api/core";
import { CampusDraft } from "@/models/maintenance";

export interface CampusInstallStatus {
  requestId: string;
  phase: string;
  current: number;
  total: number | null;
  errorCode: string | null;
}

export class CampusService {
  static prepare(
    profile: CampusDraft,
    requestId: string,
    preferredInstanceId?: string
  ): Promise<string> {
    return invoke("prepare_campus_client", {
      profile,
      requestId,
      preferredInstanceId: preferredInstanceId ?? null,
    });
  }

  static status(): Promise<CampusInstallStatus> {
    return invoke("retrieve_campus_install");
  }

  static cancel(requestId: string): Promise<void> {
    return invoke("cancel_campus_install", { requestId });
  }
}
