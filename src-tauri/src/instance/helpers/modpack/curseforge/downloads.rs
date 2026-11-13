use serde::{Deserialize, Serialize};
use sjmcl_types::error::SJMCLResult;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_http::reqwest;
use url::Url;

use crate::instance::helpers::modpack::curseforge::{
  CONTENT_FOLDERS, CurseForgeImport, CurseForgeImportState, FileId, LocalFile, PROFILE_LIMIT,
  bounded_json, safe_component,
};
use crate::instance::models::misc::InstanceError;
use crate::launcher_config::models::LauncherConfig;
use crate::resource::helpers::curseforge::{
  INDEX, IndexedFile, Project, Projects, Version, Versions, metadata, pack_version,
  published_file_url,
};
use crate::tasks::PTaskParam;
use crate::tasks::commands::schedule_progressive_task_group;
use crate::tasks::download::DownloadParam;
use crate::tasks::events::GEventStatus;
use crate::tasks::monitor::TaskMonitor;
use crate::utils::fs::validate_sha1;

const MAX_VERSION_PAGES: u32 = 3;

#[derive(Deserialize, Serialize)]
struct DownloadFile {
  id: FileId,
  folder: String,
  name: String,
  sha1: String,
  size: u64,
}

impl DownloadFile {
  fn valid(&self) -> bool {
    CONTENT_FOLDERS.contains(&self.folder.as_str())
      && safe_component(&self.name)
      && self.size > 0
      && self.sha1.len() == 40
      && self.sha1.bytes().all(|byte| byte.is_ascii_hexdigit())
  }

  fn cached_path(&self, cache: &Path, receipt: &Path) -> PathBuf {
    let key = receipt
      .file_stem()
      .and_then(|stem| stem.to_str())
      .unwrap_or_default();
    cache.join(format!("{key}-{}.file", self.sha1))
  }

  fn cached_file(&self, cache: &Path, receipt: &Path, verify: bool) -> Option<LocalFile> {
    if !self.valid() {
      return None;
    }
    let path = self.cached_path(cache, receipt);
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file()
      || metadata.len() != self.size
      || (verify && validate_sha1(path.clone(), self.sha1.clone()).is_err())
    {
      return None;
    }
    Some(LocalFile {
      path: path.canonicalize().ok()?,
      relative: Path::new(&self.folder).join(&self.name),
      sha1: Some(self.sha1.clone()),
    })
  }
}

impl IndexedFile {
  fn id(&self) -> Option<FileId> {
    let id = self.curseforge.as_ref()?;
    Some((id.project.parse().ok()?, id.file.parse().ok()?))
  }

  fn into_download(self, id: FileId) -> Option<(DownloadFile, Url)> {
    if self.serveronly == Some(true) {
      return None;
    }
    let url = published_file_url(&self.url?, id.1)?;
    let file = DownloadFile {
      id,
      folder: self.path.trim_end_matches('/').to_owned(),
      name: self.name,
      sha1: self.sha1?.to_ascii_lowercase(),
      size: u64::try_from(self.size?).ok()?,
    };
    file.valid().then_some((file, url))
  }
}

fn cache_dir(app: &AppHandle) -> SJMCLResult<PathBuf> {
  Ok(
    app
      .state::<Mutex<LauncherConfig>>()
      .lock()?
      .download
      .cache
      .directory
      .clone(),
  )
}

fn receipt_path(cache: &Path, ids: &HashSet<FileId>) -> PathBuf {
  use sha2::{Digest, Sha256};

  let mut sorted: Vec<_> = ids.iter().copied().collect();
  sorted.sort_unstable();
  let mut hash = Sha256::new();
  for (project, file) in sorted {
    hash.update(project.to_le_bytes());
    hash.update(file.to_le_bytes());
  }
  cache.join(format!("curseforge-{}.json", hex::encode(hash.finalize())))
}

fn active_group(app: &AppHandle, receipt: &Path) -> Option<String> {
  let key = receipt.file_stem()?.to_str()?;
  let monitor = app.state::<Pin<Box<TaskMonitor>>>();
  monitor.state_list().into_iter().find_map(|group| {
    (matches!(group.status, GEventStatus::Started | GEventStatus::Stopped)
      && (group.task_group.starts_with("curseforge-files?")
        || group.task_group.starts_with("retry-curseforge-files?"))
      && group
        .task_group
        .split_once('&')
        .and_then(|(_, id)| id.rsplit_once('@'))
        .is_some_and(|(id, _)| id == key))
    .then_some(group.task_group)
  })
}

impl CurseForgeImport {
  pub fn read_downloads(&mut self, app: &AppHandle, verify: bool) {
    let Ok(cache) = cache_dir(app) else {
      return;
    };
    let required = self.pack.required_files();
    let receipt = receipt_path(&cache, &required);
    let Some(downloads) = bounded_json::<Vec<DownloadFile>>(&receipt, PROFILE_LIMIT) else {
      return;
    };
    let verify = verify || active_group(app, &receipt).is_none();
    for file in downloads {
      if required.contains(&file.id)
        && let Some(cached) = file.cached_file(&cache, &receipt, verify)
      {
        self.files.insert(file.id, cached);
      }
    }
  }
}

fn normalized_name(name: &str) -> String {
  name
    .chars()
    .filter(|char| char.is_alphanumeric())
    .flat_map(char::to_lowercase)
    .collect()
}

fn matching_project(projects: &[Project], title: &str) -> Option<u64> {
  let title = title.trim();
  let exact = |project: &&Project| project.name.eq_ignore_ascii_case(title);
  let mut exact_matches = projects.iter().filter(exact);
  if let Some(project) = exact_matches.next() {
    return exact_matches.next().is_none().then_some(project.id);
  }
  let mut matches = projects.iter().filter(|project| {
    project
      .name
      .split_once(" - ")
      .is_some_and(|(name, _)| name.trim().eq_ignore_ascii_case(title))
  });
  matches
    .next()
    .filter(|_| matches.next().is_none())
    .map(|project| project.id)
}

fn matching_version(
  versions: &[Version],
  title: &str,
  version: &str,
  filename: &str,
) -> Option<u64> {
  let normalized_filename = normalized_name(filename.trim_end_matches(".zip"));
  let expected_name = normalized_name(&format!("{title}{version}"));
  versions
    .iter()
    .find(|item| {
      let name = normalized_name(item.name.trim_end_matches(".zip"));
      name == normalized_filename || name == expected_name
    })
    .map(|item| item.id)
}

fn plan_downloads(
  files: Vec<IndexedFile>,
  required: &HashSet<FileId>,
) -> SJMCLResult<Vec<(DownloadFile, Url)>> {
  let mut downloads = Vec::new();
  let mut listed = HashSet::new();
  for file in files {
    if let Some(id) = file.id()
      && required.contains(&id)
    {
      if !listed.insert(id) {
        return Err(InstanceError::CurseForgeDownloadUnavailable.into());
      }
      if let Some(file) = file.into_download(id) {
        downloads.push(file);
      }
    }
  }
  if &listed != required {
    return Err(InstanceError::CurseForgeDownloadUnavailable.into());
  }
  Ok(downloads)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeDownloadResult {
  task_group: Option<String>,
  remaining: usize,
}

pub async fn download_files(
  app: AppHandle,
  path: PathBuf,
  source_directory: Option<PathBuf>,
  published_release: Option<(u64, u64)>,
) -> SJMCLResult<CurseForgeDownloadResult> {
  let state = app.state::<CurseForgeImportState>();
  let _guard = state
    .0
    .try_lock()
    .map_err(|_| InstanceError::InstallationDuplicated)?;
  let scan_app = app.clone();
  let filename = path
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or_default()
    .to_ascii_lowercase();
  let import = tauri::async_runtime::spawn_blocking(move || {
    let mut import = CurseForgeImport::resolve(&scan_app, path, source_directory.as_deref())?;
    import.read_downloads(&scan_app, true);
    Ok::<_, sjmcl_types::error::SJMCLError>(import)
  })
  .await
  .map_err(|_| InstanceError::FileOperationError)??;

  let (found, total) = import.progress();
  if found == total {
    return Ok(CurseForgeDownloadResult {
      task_group: None,
      remaining: 0,
    });
  }
  let pack = &import.pack;
  let required = pack.required_files();
  let cache = cache_dir(&app)?;
  let receipt = receipt_path(&cache, &required);
  if let Some(task_group) = active_group(&app, &receipt) {
    return Ok(CurseForgeDownloadResult {
      task_group: Some(task_group),
      remaining: 0,
    });
  }
  let client = app.state::<reqwest::Client>();
  let (project, file_id) = if let Some(release) = published_release {
    release
  } else {
    let version = pack
      .version
      .as_deref()
      .filter(|version| !version.trim().is_empty())
      .ok_or(InstanceError::CurseForgeDownloadUnavailable)?;
    let search: Projects = metadata(
      client
        .get(format!("{INDEX}/search/popular"))
        .query(&[("term", &pack.name)]),
    )
    .await
    .map_err(|_| InstanceError::CurseForgeDownloadUnavailable)?;
    let project = matching_project(&search.packs, &pack.name)
      .ok_or(InstanceError::CurseForgeDownloadUnavailable)?;
    let mut release = None;
    for page in 1..=MAX_VERSION_PAGES {
      let list: Versions = metadata(client.get(format!("{INDEX}/{project}/versions/all/{page}")))
        .await
        .map_err(|_| InstanceError::CurseForgeDownloadUnavailable)?;
      release = matching_version(&list.versions, &pack.name, version, &filename);
      if release.is_some() || page >= list.pages {
        break;
      }
    }
    (
      project,
      release.ok_or(InstanceError::CurseForgeDownloadUnavailable)?,
    )
  };
  let version = pack_version(&client, project, file_id)
    .await
    .map_err(|_| InstanceError::CurseForgeDownloadUnavailable)?;

  let downloads = plan_downloads(version.files, &required)?;
  tokio::fs::create_dir_all(&cache).await?;
  let mut scheduled = 0;
  let mut downloaded = 0;
  let mut hashes = HashSet::new();
  let mut tasks = Vec::new();
  for (file, url) in &downloads {
    if import.files.contains_key(&file.id) {
      continue;
    }
    let cache_path = file.cached_path(&cache, &receipt);
    if fs::symlink_metadata(&cache_path).is_ok_and(|info| !info.is_file()) {
      continue;
    }
    if fs::symlink_metadata(&cache_path).is_ok_and(|info| info.len() == file.size) {
      let path = cache_path.clone();
      let sha1 = file.sha1.clone();
      if tauri::async_runtime::spawn_blocking(move || validate_sha1(path, sha1).is_ok())
        .await
        .unwrap_or(false)
      {
        downloaded += 1;
        continue;
      }
    }
    scheduled += 1;
    if hashes.insert(&file.sha1) {
      tasks.push(PTaskParam::Download(DownloadParam {
        src: url.clone(),
        dest: cache_path,
        filename: Some(file.name.clone()),
        sha1: Some(file.sha1.clone()),
      }));
    }
  }
  let cached_files: Vec<_> = downloads.iter().map(|(file, _)| file).collect();
  sjmcl_types::storage::save_json_async(&cached_files, &receipt).await?;
  let task_group = if tasks.is_empty() {
    None
  } else {
    let title = pack.name.replace(['?', '&', '@'], " ");
    let key = receipt
      .file_stem()
      .and_then(|stem| stem.to_str())
      .unwrap_or_default();
    Some(
      schedule_progressive_task_group(
        app.clone(),
        format!("curseforge-files?{title}&{key}"),
        tasks,
        true,
      )
      .await?
      .task_group,
    )
  };
  Ok(CurseForgeDownloadResult {
    task_group,
    remaining: total.saturating_sub(found + downloaded + scheduled),
  })
}

#[cfg(test)]
mod tests {
  use serde_json::json;
  use std::collections::HashSet;

  use crate::instance::helpers::modpack::curseforge::downloads::{
    IndexedFile, Project, Version, matching_project, matching_version, plan_downloads,
  };

  #[test]
  fn resolves_the_exact_pack_and_version_from_export_metadata() {
    let projects = [
      serde_json::from_value::<Project>(json!({"id": 1, "name": "All the Mods 10 - ATM10"}))
        .unwrap(),
      serde_json::from_value::<Project>(json!({"id": 2, "name": "All the Mods 11 - ATM11"}))
        .unwrap(),
    ];
    let versions = [
      serde_json::from_value::<Version>(
        json!({"id": 3, "name": "All the Mods 11-0.14.1-beta.zip"}),
      )
      .unwrap(),
      serde_json::from_value::<Version>(
        json!({"id": 4, "name": "All the Mods 11-0.14.0-beta.zip"}),
      )
      .unwrap(),
    ];
    assert_eq!(matching_project(&projects, "All the Mods 11"), Some(2));
    assert_eq!(
      matching_version(&versions, "All the Mods 11", "0.14.0-beta", "renamed.zip"),
      Some(4)
    );
    assert_eq!(
      matching_version(&versions, "All the Mods 11", "0.13.0-beta", "renamed.zip"),
      None
    );
  }

  fn indexed_file(project: u64, file: u64, folder: &str, url: Option<&str>) -> IndexedFile {
    serde_json::from_value(json!({
      "curseforge": { "project": project.to_string(), "file": file.to_string() },
      "name": "example.jar", "path": folder, "size": 9,
      "sha1": "b".repeat(40), "url": url,
    }))
    .unwrap()
  }

  #[test]
  fn uses_only_manifest_ids_and_valid_original_downloads() {
    let original = "https://edge.forgecdn.net/files/9368/438/example.jar";
    let required = HashSet::from([(1, 9368438), (2, 6), (3, 7), (4, 8), (5, 9)]);
    let files = vec![
      serde_json::from_value(json!({
        "name": "pack.zip", "path": "./", "size": -1, "url": original,
      }))
      .unwrap(),
      indexed_file(1, 9368438, "mods/", Some(original)),
      indexed_file(2, 6, "mods/", None),
      indexed_file(3, 7, "mods/", Some("https://example.org/example.jar")),
      indexed_file(
        4,
        8,
        "../mods/",
        Some("https://edge.forgecdn.net/files/0/8/example.jar"),
      ),
      indexed_file(5, 9, "mods/", Some("https://edge.forgecdn.net/other")),
      indexed_file(7, 10, "mods/", Some(original)),
    ];
    let downloads = plan_downloads(files, &required).unwrap();
    assert_eq!(downloads.len(), 1);
    assert_eq!(downloads[0].0.id, (1, 9368438));
    assert_eq!(downloads[0].1.as_str(), original);
    assert!(plan_downloads(vec![], &required).is_err());
  }
}
