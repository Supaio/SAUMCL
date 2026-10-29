use serde::Serialize;
use sjmcl_types::storage::load_json_async;
use std::collections::HashMap;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_http::reqwest;
use tokio::io::AsyncWriteExt;

use crate::instance::commands::create_instance_with_options;
use crate::instance::helpers::campus_plan::{
  CampusReceipt, MAX_PACK_BYTES, PENDING_FILE, READY_FILE, clean_incomplete, client_key,
  copy_player_preferences, hash_archive, matches_client, read_receipt, validate_archive,
};
use crate::instance::helpers::client_json::McClientInfo;
use crate::instance::helpers::loader::common::execute_processors;
use crate::instance::helpers::loader::forge::InstallProfile;
use crate::instance::helpers::misc::{refresh_and_update_instances, refresh_instance};
use crate::instance::helpers::modpack::import::ModpackMetaInfo;
use crate::instance::models::misc::{Instance, ModLoaderStatus};
use crate::launcher_config::helpers::java::refresh_and_update_javas;
use crate::launcher_config::models::LauncherConfig;
use crate::maintenance::storage::CampusDraft;
use crate::resource::commands::fetch_game_version_specific;
use crate::resource::models::ModLoaderResourceInfo;
use crate::tasks::events::GEventStatus;
use crate::tasks::monitor::TaskMonitor;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CampusInstallStatus {
  pub request_id: String,
  pub phase: String,
  pub current: u64,
  pub total: Option<u64>,
  pub error_code: Option<String>,
}

#[derive(Default)]
pub struct CampusInstallState {
  active: AtomicBool,
  cancelled: AtomicBool,
  status: Mutex<CampusInstallStatus>,
  groups: Mutex<Vec<String>>,
}

fn status(app: &AppHandle, phase: &str, current: u64, total: Option<u64>) {
  let state = app.state::<CampusInstallState>();
  let mut value = state.status.lock().unwrap();
  value.phase = phase.into();
  value.current = current;
  value.total = total;
}

fn check_cancelled(app: &AppHandle) -> Result<(), String> {
  if app
    .state::<CampusInstallState>()
    .cancelled
    .load(Ordering::SeqCst)
  {
    Err("CANCELLED".into())
  } else {
    Ok(())
  }
}

fn instance_matches(profile: &CampusDraft, instance: &Instance) -> bool {
  instance.mod_loader.status == ModLoaderStatus::Installed
    && instance
      .version_path
      .join(format!("{}.json", instance.name))
      .is_file()
    && instance
      .version_path
      .join(format!("{}.jar", instance.name))
      .is_file()
    && matches_client(
      profile,
      &instance.version,
      &instance.mod_loader.loader_type.to_string(),
      &instance.mod_loader.version,
      instance.modpack_version.as_deref(),
    )
}

async fn wait_group(app: &AppHandle, group_name: String) -> Result<(), String> {
  app
    .state::<CampusInstallState>()
    .groups
    .lock()
    .unwrap()
    .push(group_name.clone());
  loop {
    check_cancelled(app)?;
    let group = app
      .state::<Pin<Box<TaskMonitor>>>()
      .state_list()
      .into_iter()
      .find(|group| group.task_group == group_name)
      .ok_or("DOWNLOAD_CANCELLED")?;
    let current = group
      .task_descs
      .iter()
      .map(|task| task.current.max(0) as u64)
      .sum();
    let total = group
      .task_descs
      .iter()
      .map(|task| task.total.max(0) as u64)
      .sum::<u64>();
    status(
      app,
      if group.status == GEventStatus::Stopped {
        "paused"
      } else {
        "installing"
      },
      current,
      (total > 0).then_some(total),
    );
    match group.status {
      GEventStatus::Completed => return Ok(()),
      GEventStatus::Failed => return Err("DEPENDENCY_DOWNLOAD_FAILED".into()),
      GEventStatus::Cancelled => return Err("DOWNLOAD_CANCELLED".into()),
      _ => tokio::time::sleep(Duration::from_millis(300)).await,
    }
  }
}

// This client keeps the launcher's User-Agent and proxy settings. Its ordinary
// 10-second metadata timeout is overridden for large modpack downloads.
async fn download_pack(
  app: &AppHandle,
  profile: &CampusDraft,
  key: &str,
) -> Result<(PathBuf, String), String> {
  let cache = {
    app
      .state::<Mutex<LauncherConfig>>()
      .lock()
      .map_err(|_| "INSTALL_FAILED")?
      .download
      .cache
      .directory
      .join("campus")
  };
  tokio::fs::create_dir_all(&cache)
    .await
    .map_err(|_| "PACK_WRITE_FAILED")?;
  let destination = cache.join(format!("{key}.zip"));
  if destination.is_file() && !profile.modpack_sha256.is_empty() {
    status(app, "verifying", 0, None);
    let path = destination.clone();
    let expected = profile.modpack_sha256.clone();
    let valid = tauri::async_runtime::spawn_blocking(move || {
      hash_archive(&path).is_ok_and(|hash| hash.eq_ignore_ascii_case(&expected))
        && validate_archive(&path).is_ok()
    })
    .await
    .map_err(|_| "PACK_READ_FAILED")?;
    check_cancelled(app)?;
    if valid {
      return Ok((destination, profile.modpack_sha256.to_ascii_lowercase()));
    }
  }
  let part = cache.join(format!("{}.part", uuid::Uuid::new_v4()));
  let result = async {
    status(app, "downloading", 0, None);
    let client = app.state::<reqwest::Client>().inner().clone();
    let request = client.get(&profile.modpack_url).timeout(Duration::from_secs(24 * 60 * 60)).send();
    let mut response = tokio::time::timeout(Duration::from_secs(30), request).await
      .map_err(|_| "PACK_DOWNLOAD_FAILED")?.map_err(|_| "PACK_DOWNLOAD_FAILED")?;
    if !response.status().is_success() { return Err("PACK_DOWNLOAD_FAILED".to_string()); }
    let total = response.content_length();
    if total.is_some_and(|length| length > MAX_PACK_BYTES) { return Err("PACK_TOO_LARGE".into()); }
    let mut file = tokio::fs::OpenOptions::new().write(true).create_new(true).open(&part).await
      .map_err(|_| "PACK_WRITE_FAILED")?;
    let mut current = 0u64;
    loop {
      check_cancelled(app)?;
      let chunk = tokio::select! {
        chunk = tokio::time::timeout(Duration::from_secs(45), response.chunk()) => {
          chunk.map_err(|_| "PACK_DOWNLOAD_FAILED")?.map_err(|_| "PACK_DOWNLOAD_FAILED")?
        },
        _ = async { while check_cancelled(app).is_ok() { tokio::time::sleep(Duration::from_millis(150)).await; } } => return Err("CANCELLED".into()),
      };
      let Some(chunk) = chunk else { break };
      current += chunk.len() as u64;
      if current > MAX_PACK_BYTES { return Err("PACK_TOO_LARGE".into()); }
      file.write_all(&chunk).await.map_err(|_| "PACK_WRITE_FAILED")?;
      status(app, "downloading", current, total);
    }
    file.flush().await.map_err(|_| "PACK_WRITE_FAILED")?;
    drop(file);
    if total.is_some_and(|total| total != current) { return Err("PACK_DOWNLOAD_FAILED".into()); }
    status(app, "verifying", 0, None);
    let path = part.clone();
    let hash = tauri::async_runtime::spawn_blocking(move || {
      validate_archive(&path)?;
      hash_archive(&path)
    }).await.map_err(|_| "PACK_READ_FAILED")??;
    check_cancelled(app)?;
    if !profile.modpack_sha256.is_empty() && !hash.eq_ignore_ascii_case(&profile.modpack_sha256) {
      return Err("PACK_HASH_MISMATCH".into());
    }
    if destination.exists() { tokio::fs::remove_file(&destination).await.map_err(|_| "PACK_WRITE_FAILED")?; }
    tokio::fs::rename(&part, &destination).await.map_err(|_| "PACK_WRITE_FAILED")?;
    Ok((destination.clone(), hash))
  }.await;
  if result.is_err() {
    let _ = tokio::fs::remove_file(&part).await;
  }
  result
}

async fn install_client(
  app: &AppHandle,
  profile: &CampusDraft,
  preferred_instance_id: Option<String>,
  target: &mut Option<(PathBuf, PathBuf)>,
) -> Result<String, String> {
  let key = client_key(profile);
  if !profile.modpack_url.is_empty() && profile.modpack_version.trim().is_empty() {
    return Err("PACK_VERSION_REQUIRED".into());
  }
  let instances: Vec<_> = app
    .state::<Mutex<HashMap<String, Instance>>>()
    .lock()
    .map_err(|_| "INSTALL_FAILED")?
    .values()
    .cloned()
    .collect();
  if let Some(instance) = instances.iter().find(|instance| {
    instance_matches(profile, instance)
      && read_receipt(&instance.version_path).is_some_and(|receipt| receipt.client_key == key)
  }) {
    return Ok(instance.id.clone());
  }
  // Keep explicit use of a manually imported compatible instance. A published
  // checksum requires a managed installation with a matching receipt instead.
  if profile.modpack_sha256.is_empty()
    && let Some(instance) = instances.iter().find(|instance| {
      Some(&instance.id) == preferred_instance_id.as_ref()
        && !instance.version_path.join(READY_FILE).exists()
        && !instance.version_path.join(PENDING_FILE).exists()
        && instance_matches(profile, instance)
    })
  {
    return Ok(instance.id.clone());
  }
  if profile.modpack_url.is_empty() {
    return Err("MISSING_PACK_URL".into());
  }
  if profile.modpack_version.trim().is_empty() {
    return Err("PACK_VERSION_REQUIRED".into());
  }
  let (directory, mut game_config) = {
    let config_state = app.state::<Mutex<LauncherConfig>>();
    let config = config_state.lock().map_err(|_| "INSTALL_FAILED")?;
    (
      config
        .local_game_directories
        .first()
        .cloned()
        .ok_or("NO_GAME_DIRECTORY")?,
      config.global_game_config.clone(),
    )
  };
  let (archive, archive_sha256) = download_pack(app, profile, &key).await?;
  check_cancelled(app)?;
  status(app, "preparing", 0, None);
  let metadata = ModpackMetaInfo::from_archive(
    app,
    &std::fs::File::open(&archive).map_err(|_| "PACK_READ_FAILED")?,
  )
  .await
  .map_err(|_| "PACK_FORMAT_UNSUPPORTED")?;
  let loader = metadata.mod_loader.clone().unwrap_or_default();
  if !matches_client(
    profile,
    &metadata.client_version,
    &loader.loader_type.to_string(),
    &loader.version,
    Some(&profile.modpack_version),
  ) {
    return Err("PACK_VERSION_MISMATCH".into());
  }
  let game = fetch_game_version_specific(app.clone(), metadata.client_version)
    .await
    .map_err(|_| "VERSION_FETCH_FAILED")?;
  check_cancelled(app)?;
  game_config.version_isolation = true;
  game_config.game_java.auto = true;
  game_config.performance.auto_mem_allocation = true;
  let name = format!(
    "SAUMCL-CLMC-{}-{}",
    &key[..8],
    &uuid::Uuid::new_v4().simple().to_string()[..8]
  );
  let versions = directory.dir.join("versions");
  let version_path = versions.join(&name);
  *target = Some((versions, version_path.clone()));
  let group = create_instance_with_options(
    app.clone(),
    directory.clone(),
    name.clone(),
    format!("{} · {}", profile.server_name, profile.modpack_version),
    "/images/icons/saumcl.png".into(),
    game,
    ModLoaderResourceInfo {
      loader_type: loader.loader_type,
      version: loader.version,
      branch: loader.branch,
      ..Default::default()
    },
    None,
    Some(archive.to_string_lossy().into()),
    Some(false),
    Some(false),
    Some(profile.modpack_version.clone()),
    Some(game_config),
    true,
  )
  .await
  .map_err(|_| "INSTALL_FAILED")?;
  wait_group(app, group).await?;
  check_cancelled(app)?;
  refresh_and_update_javas(app).await;
  status(app, "loader", 0, None);
  let mut instance = refresh_instance(
    app,
    version_path.clone(),
    name.clone(),
    version_path.join(format!("{name}.jar")),
    version_path.join(format!("{name}.json")),
    false,
  )
  .await
  .map_err(|_| "LOADER_INSTALL_FAILED")?
  .ok_or("LOADER_INSTALL_FAILED")?;
  let loader_prefix = format!("campus-loader?{name}@");
  let loader_groups: Vec<_> = app
    .state::<Pin<Box<TaskMonitor>>>()
    .state_list()
    .into_iter()
    .filter(|group| group.task_group.starts_with(&loader_prefix))
    .map(|group| group.task_group)
    .collect();
  for group in loader_groups {
    wait_group(app, group).await?;
  }
  check_cancelled(app)?;
  if instance.mod_loader.status != ModLoaderStatus::Installed {
    if instance.mod_loader.status != ModLoaderStatus::Downloading {
      return Err("LOADER_INSTALL_FAILED".into());
    }
    status(app, "loader", 0, None);
    instance.mod_loader.status = ModLoaderStatus::Installing;
    instance
      .save_json_cfg()
      .await
      .map_err(|_| "INSTALL_FAILED")?;
    let profile_path = version_path.join("install_profile.json");
    if profile_path.is_file() {
      let installer: InstallProfile = load_json_async(&profile_path)
        .await
        .map_err(|_| "LOADER_INSTALL_FAILED")?;
      let client: McClientInfo = load_json_async(&version_path.join(format!("{name}.json")))
        .await
        .map_err(|_| "LOADER_INSTALL_FAILED")?;
      execute_processors(app, &instance, &client, &installer)
        .await
        .map_err(|_| "LOADER_INSTALL_FAILED")?;
    }
    instance.mod_loader.status = ModLoaderStatus::Installed;
    instance
      .save_json_cfg()
      .await
      .map_err(|_| "INSTALL_FAILED")?;
  }
  check_cancelled(app)?;
  if !instance_matches(profile, &instance) {
    return Err("PACK_VERSION_MISMATCH".into());
  }
  if let Some(previous) = instances
    .iter()
    .filter(|old| old.version == instance.version)
    .filter_map(|old| read_receipt(&old.version_path).map(|receipt| (old, receipt.installed_at)))
    .max_by_key(|(_, installed_at)| *installed_at)
    .map(|(old, _)| old)
  {
    copy_player_preferences(&previous.version_path, &version_path)?;
  }
  let receipt = CampusReceipt {
    schema_version: 1,
    client_key: key,
    installed_at: SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap_or_default()
      .as_secs(),
    archive_sha256,
  };
  std::fs::write(
    version_path.join(READY_FILE),
    serde_json::to_vec_pretty(&receipt).map_err(|_| "INSTALL_FAILED")?,
  )
  .map_err(|_| "INSTALL_FAILED")?;
  std::fs::remove_file(version_path.join(PENDING_FILE)).map_err(|_| "INSTALL_FAILED")?;
  refresh_and_update_instances(app, false).await;
  Ok(format!("{}:{}", directory.name, name))
}

#[tauri::command]
pub async fn prepare_campus_client(
  app: AppHandle,
  profile: CampusDraft,
  preferred_instance_id: Option<String>,
  request_id: String,
) -> Result<String, String> {
  profile.validate().map_err(|_| "INVALID_CAMPUS_CONFIG")?;
  if uuid::Uuid::parse_str(&request_id).is_err() {
    return Err("INVALID_REQUEST".into());
  }
  if profile.server_address.is_empty()
    || profile.maintenance
    || matches!(
      profile.round_state,
      crate::maintenance::storage::CampusRoundState::Ended
    )
  {
    return Err("CAMPUS_UNAVAILABLE".into());
  }
  let state = app.state::<CampusInstallState>();
  if state
    .active
    .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
    .is_err()
  {
    return Err("INSTALL_BUSY".into());
  }
  state.cancelled.store(false, Ordering::SeqCst);
  state.groups.lock().unwrap().clear();
  *state.status.lock().unwrap() = CampusInstallStatus {
    request_id,
    phase: "preparing".into(),
    ..Default::default()
  };
  let mut target = None;
  let result = install_client(&app, &profile, preferred_instance_id, &mut target).await;
  if result.is_err() {
    let monitor = app.state::<Pin<Box<TaskMonitor>>>();
    let groups = state.groups.lock().unwrap().clone();
    for group in groups {
      monitor.cancel_progressive_task_group(group);
    }
    if let Some((versions, path)) = &target {
      if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
        for group in monitor.state_list().into_iter().filter(|group| {
          group
            .task_group
            .starts_with(&format!("campus-client?{name}@"))
            || group
              .task_group
              .starts_with(&format!("campus-loader?{name}@"))
        }) {
          monitor.cancel_progressive_task_group(group.task_group);
        }
      }
      tokio::time::sleep(Duration::from_millis(100)).await;
      clean_incomplete(versions, path);
    }
  }
  {
    let mut value = state.status.lock().unwrap();
    value.phase = if result.is_ok() {
      "complete"
    } else if state.cancelled.load(Ordering::SeqCst) {
      "cancelled"
    } else {
      "failed"
    }
    .into();
    value.error_code = result.as_ref().err().cloned();
  }
  state.active.store(false, Ordering::SeqCst);
  result
}

#[tauri::command]
pub fn retrieve_campus_install(app: AppHandle) -> CampusInstallStatus {
  app
    .state::<CampusInstallState>()
    .status
    .lock()
    .unwrap()
    .clone()
}

#[tauri::command]
pub fn cancel_campus_install(app: AppHandle, request_id: String) {
  let state = app.state::<CampusInstallState>();
  if state.status.lock().unwrap().request_id != request_id {
    return;
  }
  state.cancelled.store(true, Ordering::SeqCst);
  let groups = state.groups.lock().unwrap().clone();
  for group in groups {
    app
      .state::<Pin<Box<TaskMonitor>>>()
      .cancel_progressive_task_group(group);
  }
}

#[tauri::command]
pub async fn retrieve_shared_campus_config(app: AppHandle) -> Result<CampusDraft, String> {
  // Use the same User-Agent and download proxy as pack / Java downloads.
  let client = app.state::<reqwest::Client>().inner().clone();
  let response = client
    .get("https://gitlab.com/Supaio/saumcl/-/raw/main/public/campus-server.json")
    .header("Cache-Control", "no-cache")
    .send()
    .await
    .map_err(|_| "CONFIG_FETCH_FAILED")?;
  if !response.status().is_success() {
    return Err("CONFIG_FETCH_FAILED".into());
  }
  let bytes = response.bytes().await.map_err(|_| "CONFIG_FETCH_FAILED")?;
  if bytes.len() > 64 * 1024 {
    return Err("INVALID_CAMPUS_CONFIG".into());
  }
  let profile: CampusDraft = serde_json::from_slice(&bytes).map_err(|_| "INVALID_CAMPUS_CONFIG")?;
  profile.validate().map_err(|_| "INVALID_CAMPUS_CONFIG")?;
  Ok(profile)
}
