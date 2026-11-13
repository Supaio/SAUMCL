import { invoke } from "@tauri-apps/api/core";
import { ModpackMetaInfo } from "@/models/instance/misc";
import {
  CampusDraft,
  MaintainerIdentity,
  MaintenanceStatus,
} from "@/models/maintenance";
import { COMMUNITY_CHANGED_EVENT } from "@/services/community";

export const CAMPUS_PREVIEW_CHANGED_EVENT = "saumcl-campus-preview-changed";

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

  static async activateKey(key: string): Promise<MaintainerIdentity> {
    const identity = await invoke<MaintainerIdentity>(
      "activate_maintenance_key",
      { key }
    );
    this.notifyAuthorizationChanged();
    return identity;
  }

  static async importKey(path: string): Promise<MaintainerIdentity> {
    const identity = await invoke<MaintainerIdentity>(
      "import_maintenance_key",
      { path }
    );
    this.notifyAuthorizationChanged();
    return identity;
  }

  static async deactivate(): Promise<void> {
    await invoke("deactivate_maintenance_mode");
    this.notifyAuthorizationChanged();
  }

  static notifyAuthorizationChanged(): void {
    window.dispatchEvent(new Event(CAMPUS_PREVIEW_CHANGED_EVENT));
    window.dispatchEvent(new Event(COMMUNITY_CHANGED_EVENT));
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

  static async applyPreview(draft: CampusDraft): Promise<void> {
    await invoke("apply_campus_preview", { draft });
    window.dispatchEvent(new Event(CAMPUS_PREVIEW_CHANGED_EVENT));
  }

  static retrievePreview(): Promise<CampusDraft | null> {
    return invoke("retrieve_campus_preview");
  }
}
