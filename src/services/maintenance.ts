import { invoke } from "@tauri-apps/api/core";
import { ModpackMetaInfo } from "@/models/instance/misc";
import {
  CampusDraft,
  MaintainerIdentity,
  MaintenanceStatus,
} from "@/models/maintenance";

// Handle errors in the page without logging authorization input or file contents.
export class MaintenanceService {
  static inspectModpack(path: string): Promise<{
    sha256: string;
    metadata: ModpackMetaInfo;
  }> {
    return invoke("inspect_campus_modpack", { path });
  }
  static retrieveStatus(): Promise<MaintenanceStatus> {
    return invoke("retrieve_maintenance_status");
  }

  static activateKey(key: string): Promise<MaintainerIdentity> {
    return invoke("activate_maintenance_key", { key });
  }

  static importKey(path: string): Promise<MaintainerIdentity> {
    return invoke("import_maintenance_key", { path });
  }

  static deactivate(): Promise<void> {
    return invoke("deactivate_maintenance_mode");
  }

  static retrieveDraft(): Promise<CampusDraft> {
    return invoke("retrieve_campus_draft");
  }

  static saveDraft(draft: CampusDraft): Promise<void> {
    return invoke("save_campus_draft", { draft });
  }

  static exportDraft(draft: CampusDraft, path: string): Promise<void> {
    return invoke("export_campus_draft", { draft, path });
  }

  static applyPreview(draft: CampusDraft): Promise<void> {
    return invoke("apply_campus_preview", { draft });
  }

  static retrievePreview(): Promise<CampusDraft | null> {
    return invoke("retrieve_campus_preview");
  }
}
