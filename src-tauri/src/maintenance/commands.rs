use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_http::reqwest;

use crate::APP_DATA_DIR;
use crate::discover::helpers::mc_news::{MC_NEWS_ENDPOINT, fetch_mc_news_page};
use crate::maintenance::auth::{MaintainerIdentity, MaintenanceError, TrustedKey};
use crate::maintenance::community::{CommunityDraft, CommunityFeed};
use crate::maintenance::storage::{CampusDraft, MaintenanceStatus, MaintenanceStore};
use crate::utils::web::with_retry;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampusPackInfo {
  sha256: String,
  metadata: crate::instance::helpers::modpack::import::ModpackMetaInfo,
}

#[tauri::command]
pub async fn inspect_campus_modpack(
  app: AppHandle,
  path: PathBuf,
) -> Result<CampusPackInfo, String> {
  if store()
    .map_err(|_| "UNAUTHORIZED")?
    .status()
    .map_err(|_| "UNAUTHORIZED")?
    .identity
    .is_none()
  {
    return Err("UNAUTHORIZED".into());
  }
  let source = path.clone();
  let sha256 = tauri::async_runtime::spawn_blocking(move || {
    crate::instance::helpers::campus_plan::validate_archive(&source)?;
    crate::instance::helpers::campus_plan::hash_archive(&source)
  })
  .await
  .map_err(|_| "PACK_READ_FAILED")??;
  let file = std::fs::File::open(path).map_err(|_| "PACK_READ_FAILED")?;
  let metadata =
    crate::instance::helpers::modpack::import::ModpackMetaInfo::from_archive(&app, &file)
      .await
      .map_err(|_| "PACK_FORMAT_UNSUPPORTED")?;
  Ok(CampusPackInfo { sha256, metadata })
}

fn store() -> Result<MaintenanceStore, MaintenanceError> {
  // Keep authorizations out of portable folders and ordinary config exports.
  let directory = APP_DATA_DIR
    .get()
    .ok_or(MaintenanceError::StorageFailed)?
    .join("maintenance");
  let keys: Vec<TrustedKey> =
    serde_json::from_str(include_str!("../../assets/maintenance/trusted-keys.json"))
      .map_err(|_| MaintenanceError::NotConfigured)?;
  Ok(MaintenanceStore::new(directory, keys))
}

#[tauri::command]
pub fn retrieve_maintenance_status() -> Result<MaintenanceStatus, MaintenanceError> {
  store()?.status()
}

#[tauri::command]
pub fn activate_maintenance_key(key: String) -> Result<MaintainerIdentity, MaintenanceError> {
  store()?.activate(&key)
}

#[tauri::command]
pub fn import_maintenance_key(path: PathBuf) -> Result<MaintainerIdentity, MaintenanceError> {
  store()?.activate_file(&path)
}

#[tauri::command]
pub fn deactivate_maintenance_mode() -> Result<(), MaintenanceError> {
  store()?.deactivate()
}

#[tauri::command]
pub fn retrieve_campus_draft() -> Result<CampusDraft, MaintenanceError> {
  store()?.load_draft()
}

#[tauri::command]
pub fn save_campus_draft(draft: CampusDraft) -> Result<(), MaintenanceError> {
  store()?.save_draft(&draft)
}

#[tauri::command]
pub fn export_campus_draft(draft: CampusDraft, path: PathBuf) -> Result<(), MaintenanceError> {
  store()?.export_draft(&draft, &path)
}

#[tauri::command]
pub fn apply_campus_preview(draft: CampusDraft) -> Result<(), MaintenanceError> {
  store()?.apply_preview(&draft)
}

#[tauri::command]
pub fn retrieve_campus_preview() -> Result<Option<CampusDraft>, MaintenanceError> {
  store()?.load_preview()
}

#[tauri::command]
pub fn retrieve_community_draft() -> Result<CommunityDraft, MaintenanceError> {
  store()?.load_community()
}

#[tauri::command]
pub fn save_community_draft(draft: CommunityDraft) -> Result<(), MaintenanceError> {
  store()?.save_community(&draft)
}

#[tauri::command]
pub fn export_community_feed(draft: CommunityDraft, path: PathBuf) -> Result<(), MaintenanceError> {
  store()?.export_community(&draft, &path)
}

#[tauri::command]
pub fn apply_community_preview(draft: Option<CommunityDraft>) -> Result<(), MaintenanceError> {
  store()?.preview_community(draft.as_ref())
}

#[tauri::command]
pub fn retrieve_community_preview() -> Result<Option<CommunityFeed>, MaintenanceError> {
  store()?.load_community_preview()
}

#[tauri::command]
pub async fn collect_reward_candidates(app: AppHandle) -> Result<CommunityDraft, MaintenanceError> {
  store()?.require_authorization()?;
  let client = with_retry(app.state::<reqwest::Client>().inner().clone());
  let mut cursor = None;
  let mut articles = Vec::new();
  // Bound each scan to the latest 60 official articles. No third-party news sources.
  for _ in 0..5 {
    let (_, page) = fetch_mc_news_page(&client, MC_NEWS_ENDPOINT, cursor)
      .await
      .ok_or(MaintenanceError::CollectionFailed)?;
    articles.extend(
      page
        .posts
        .into_iter()
        .map(|post| (post.title, post.abstracts, post.link)),
    );
    cursor = page.next;
    if cursor.is_none() {
      break;
    }
  }
  // Verify the saved Key again after the network requests before writing the inbox.
  store()?.merge_reward_candidates(articles)
}
