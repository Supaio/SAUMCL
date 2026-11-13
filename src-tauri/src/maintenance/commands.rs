use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::async_runtime::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_http::reqwest;
use uuid::Uuid;

use crate::APP_DATA_DIR;
use crate::account::helpers::microsoft::oauth::{fetch_minecraft_profile, get_access_token};
use crate::account::helpers::misc::get_selected_player_info;
use crate::account::models::{PlayerInfo, PlayerType};
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

#[derive(Default)]
pub struct VerifiedMaintenanceAccounts(Mutex<HashMap<Uuid, [u8; 32]>>);

#[tauri::command]
pub async fn inspect_campus_modpack(
  app: AppHandle,
  path: PathBuf,
) -> Result<CampusPackInfo, String> {
  account_store(&app, false)
    .await
    .and_then(|store| store.require_authorization())
    .map_err(|_| "UNAUTHORIZED")?;
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

fn selected_microsoft_player(app: &AppHandle) -> Option<PlayerInfo> {
  get_selected_player_info(app).ok().filter(|player| {
    player.player_type == PlayerType::Microsoft
      && !player.uuid.is_nil()
      && (player
        .access_token
        .as_ref()
        .is_some_and(|token| !token.is_empty())
        || player
          .refresh_token
          .as_ref()
          .is_some_and(|token| !token.is_empty()))
  })
}

fn store(app: &AppHandle) -> Result<MaintenanceStore, MaintenanceError> {
  // Keep authorizations out of portable folders and ordinary config exports.
  let directory = APP_DATA_DIR
    .get()
    .ok_or(MaintenanceError::StorageFailed)?
    .join("maintenance");
  let keys: Vec<TrustedKey> =
    serde_json::from_str(include_str!("../../assets/maintenance/trusted-keys.json"))
      .map_err(|_| MaintenanceError::NotConfigured)?;
  let account_uuid = selected_microsoft_player(app).map(|player| player.uuid);
  Ok(MaintenanceStore::new(directory, keys, account_uuid))
}

async fn account_store(
  app: &AppHandle,
  binding: bool,
) -> Result<MaintenanceStore, MaintenanceError> {
  let store = store(app)?;
  if !binding {
    store.require_authorization()?;
  }
  let uuid = store
    .account_uuid
    .ok_or(MaintenanceError::MicrosoftAccountRequired)?;
  verify_microsoft_account(app, uuid).await?;
  Ok(store)
}

async fn verify_microsoft_account(app: &AppHandle, uuid: Uuid) -> Result<(), MaintenanceError> {
  // Confirm the Minecraft profile once per token in this process. Imported profile data alone
  // does not prove ownership, and the verification cache never stores the token itself.
  let state = app.state::<VerifiedMaintenanceAccounts>();
  let mut verified = state.0.lock().await;
  let player = selected_microsoft_player(app)
    .filter(|player| player.uuid == uuid)
    .ok_or(MaintenanceError::Unauthorized)?;
  let already_verified = player.access_token.as_ref().is_some_and(|token| {
    let digest: [u8; 32] = Sha256::digest(token.as_bytes()).into();
    verified.get(&uuid) == Some(&digest)
  });
  if already_verified
    && player
      .access_token_expires
      .is_some_and(|expiry| expiry > chrono::Utc::now())
  {
    return Ok(());
  }

  let token = get_access_token(app, &player)
    .await
    .map_err(|_| MaintenanceError::MicrosoftVerificationFailed)?;
  let profile = fetch_minecraft_profile(app, token.clone())
    .await
    .map_err(|_| MaintenanceError::MicrosoftVerificationFailed)?;
  if profile.id.parse::<Uuid>().ok() != Some(uuid) {
    return Err(MaintenanceError::MicrosoftVerificationFailed);
  }
  if !selected_microsoft_player(app).is_some_and(|player| {
    player.uuid == uuid && player.access_token.as_deref() == Some(token.as_str())
  }) {
    return Err(MaintenanceError::Unauthorized);
  }
  verified.insert(uuid, Sha256::digest(token.as_bytes()).into());
  Ok(())
}

#[tauri::command]
pub async fn retrieve_maintenance_status(
  app: AppHandle,
) -> Result<MaintenanceStatus, MaintenanceError> {
  let status = store(&app)?.status()?;
  if let Some(identity) = &status.identity {
    verify_microsoft_account(&app, identity.account_uuid).await?;
  }
  Ok(status)
}

#[tauri::command]
pub async fn activate_maintenance_key(
  app: AppHandle,
  key: String,
) -> Result<MaintainerIdentity, MaintenanceError> {
  account_store(&app, true).await?.activate(&key)
}

#[tauri::command]
pub async fn import_maintenance_key(
  app: AppHandle,
  path: PathBuf,
) -> Result<MaintainerIdentity, MaintenanceError> {
  account_store(&app, true).await?.activate_file(&path)
}

#[tauri::command]
pub fn deactivate_maintenance_mode(app: AppHandle) -> Result<(), MaintenanceError> {
  store(&app)?.deactivate()
}

#[tauri::command]
pub async fn retrieve_campus_draft(app: AppHandle) -> Result<CampusDraft, MaintenanceError> {
  account_store(&app, false).await?.load_draft()
}

#[tauri::command]
pub async fn save_campus_draft(app: AppHandle, draft: CampusDraft) -> Result<(), MaintenanceError> {
  account_store(&app, false).await?.save_draft(&draft)
}

#[tauri::command]
pub async fn export_campus_draft(
  app: AppHandle,
  draft: CampusDraft,
  path: PathBuf,
) -> Result<(), MaintenanceError> {
  account_store(&app, false)
    .await?
    .export_draft(&draft, &path)
}

#[tauri::command]
pub async fn apply_campus_preview(
  app: AppHandle,
  draft: CampusDraft,
) -> Result<(), MaintenanceError> {
  account_store(&app, false).await?.apply_preview(&draft)
}

#[tauri::command]
pub async fn retrieve_campus_preview(
  app: AppHandle,
) -> Result<Option<CampusDraft>, MaintenanceError> {
  let store = store(&app)?;
  let preview = store.load_preview()?;
  if let Some(uuid) = store.account_uuid.filter(|_| preview.is_some()) {
    verify_microsoft_account(&app, uuid).await?;
  }
  Ok(preview)
}

#[tauri::command]
pub async fn retrieve_community_draft(app: AppHandle) -> Result<CommunityDraft, MaintenanceError> {
  account_store(&app, false).await?.load_community()
}

#[tauri::command]
pub async fn save_community_draft(
  app: AppHandle,
  draft: CommunityDraft,
) -> Result<(), MaintenanceError> {
  account_store(&app, false).await?.save_community(&draft)
}

#[tauri::command]
pub async fn export_community_feed(
  app: AppHandle,
  draft: CommunityDraft,
  path: PathBuf,
) -> Result<(), MaintenanceError> {
  account_store(&app, false)
    .await?
    .export_community(&draft, &path)
}

#[tauri::command]
pub async fn apply_community_preview(
  app: AppHandle,
  draft: Option<CommunityDraft>,
) -> Result<(), MaintenanceError> {
  account_store(&app, false)
    .await?
    .preview_community(draft.as_ref())
}

#[tauri::command]
pub async fn retrieve_community_preview(
  app: AppHandle,
) -> Result<Option<CommunityFeed>, MaintenanceError> {
  let store = store(&app)?;
  let preview = store.load_community_preview()?;
  if let Some(uuid) = store.account_uuid.filter(|_| preview.is_some()) {
    verify_microsoft_account(&app, uuid).await?;
  }
  Ok(preview)
}

#[tauri::command]
pub async fn collect_reward_candidates(app: AppHandle) -> Result<CommunityDraft, MaintenanceError> {
  let store = account_store(&app, false).await?;
  store.require_authorization()?;
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
  // Recheck authorization and the active account before writing the inbox.
  let current = account_store(&app, false).await?;
  if current.account_uuid != store.account_uuid {
    return Err(MaintenanceError::Unauthorized);
  }
  current.merge_reward_candidates(articles)
}
