use chrono::DateTime;
use serde::{Deserialize, Serialize};
use sjmcl_types::error::SJMCLResult;
use std::collections::HashMap;
use tauri::{AppHandle, Manager};
use tauri_plugin_http::reqwest;
use url::Url;

use crate::resource::helpers::misc::version_pack_sort;
use crate::resource::models::{
  OtherResourceFileInfo, OtherResourceInfo, OtherResourceSearchQuery, OtherResourceSearchRes,
  OtherResourceSource, OtherResourceVersionPack, OtherResourceVersionPackQuery, ResourceError,
};

pub const INDEX: &str = "https://api.modpacks.ch/public/curseforge";
const PAGE_SIZE: u32 = 50;
const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Deserialize)]
pub struct Projects {
  pub packs: Vec<Project>,
  pub pages: u32,
}

#[derive(Deserialize)]
pub struct Project {
  pub id: u64,
  pub name: String,
  synopsis: Option<String>,
  #[serde(default)]
  updated: i64,
  #[serde(default)]
  installs: u64,
  #[serde(default)]
  art: Vec<Artwork>,
  #[serde(default)]
  authors: Vec<Author>,
}

#[derive(Deserialize)]
struct Artwork {
  #[serde(rename = "type")]
  kind: String,
  url: String,
}

#[derive(Deserialize)]
struct Author {
  name: String,
}

#[derive(Deserialize)]
pub struct Versions {
  pub versions: Vec<Version>,
  pub pages: u32,
}

#[derive(Deserialize)]
pub struct Version {
  pub id: u64,
  pub name: String,
  #[serde(rename = "type")]
  kind: Option<String>,
  #[serde(default)]
  updated: i64,
  #[serde(default)]
  private: bool,
  #[serde(default)]
  targets: Vec<Target>,
}

#[derive(Deserialize)]
struct Target {
  #[serde(rename = "type")]
  kind: String,
  version: String,
}

#[derive(Deserialize)]
pub struct PackVersion {
  id: u64,
  parent: u64,
  #[serde(default)]
  private: bool,
  pub files: Vec<IndexedFile>,
}

#[derive(Deserialize)]
pub struct IndexedFile {
  pub name: String,
  pub path: String,
  pub sha1: Option<String>,
  pub url: Option<String>,
  pub size: Option<i64>,
  pub curseforge: Option<CurseForgeFileId>,
  pub serveronly: Option<bool>,
  #[serde(rename = "type")]
  kind: Option<String>,
}

#[derive(Deserialize)]
pub struct CurseForgeFileId {
  pub project: String,
  pub file: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackArchive {
  url: Url,
  file_name: String,
  sha1: Option<String>,
}

pub async fn metadata<T: serde::de::DeserializeOwned>(
  request: reqwest::RequestBuilder,
) -> SJMCLResult<T> {
  let mut response = request
    .send()
    .await
    .and_then(reqwest::Response::error_for_status)
    .map_err(|_| ResourceError::NetworkError)?;
  let mut bytes = Vec::new();
  while let Some(chunk) = response
    .chunk()
    .await
    .map_err(|_| ResourceError::NetworkError)?
  {
    if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
      return Err(ResourceError::ParseError.into());
    }
    bytes.extend_from_slice(&chunk);
  }
  serde_json::from_slice(&bytes).map_err(|_| ResourceError::ParseError.into())
}

pub fn is_forge_cdn(url: &Url) -> bool {
  url.scheme() == "https"
    && url.port().is_none()
    && url.username().is_empty()
    && url.password().is_none()
    && matches!(
      url.host_str(),
      Some("edge.forgecdn.net" | "mediafilez.forgecdn.net" | "media.forgecdn.net")
    )
    && url.path().starts_with("/files/")
}

pub fn published_file_url(value: &str, file_id: u64) -> Option<Url> {
  let url: Url = value.parse().ok()?;
  if !is_forge_cdn(&url) {
    return None;
  }
  let mut segments = url.path_segments()?;
  segments.next()?;
  let thousands = segments.next()?.parse::<u64>().ok()?;
  let remainder = segments.next()?.parse::<u64>().ok()?;
  let filename = segments.next()?;
  (remainder < 1000
    && thousands.checked_mul(1000)?.checked_add(remainder)? == file_id
    && !filename.is_empty()
    && segments.next().is_none())
  .then_some(url)
}

pub async fn pack_version(
  client: &reqwest::Client,
  project_id: u64,
  file_id: u64,
) -> SJMCLResult<PackVersion> {
  let result: PackVersion = metadata(client.get(format!("{INDEX}/{project_id}/{file_id}"))).await?;
  if result.id != file_id || result.parent != project_id || result.private {
    return Err(ResourceError::NoDownloadApi.into());
  }
  Ok(result)
}

pub async fn get_pack_archive(
  client: &reqwest::Client,
  project_id: u64,
  file_id: u64,
) -> SJMCLResult<PackArchive> {
  let version = pack_version(client, project_id, file_id).await?;
  for entry in version.files {
    if entry.kind.as_deref() != Some("cf-extract") || entry.serveronly == Some(true) {
      continue;
    }
    if let Some(url) = entry.url.and_then(|url| published_file_url(&url, file_id))
      && let Some(encoded_name) = url.path_segments().and_then(|mut parts| parts.next_back())
      && let Ok(name) = urlencoding::decode(encoded_name)
      && name.to_ascii_lowercase().ends_with(".zip")
    {
      return Ok(PackArchive {
        file_name: name.into_owned(),
        url,
        sha1: entry
          .sha1
          .filter(|sha1| sha1.len() == 40 && sha1.bytes().all(|byte| byte.is_ascii_hexdigit()))
          .map(|sha1| sha1.to_ascii_lowercase()),
      });
    }
  }
  Err(ResourceError::NoDownloadApi.into())
}

fn iso_date(seconds: i64) -> String {
  DateTime::from_timestamp(seconds, 0)
    .map(|time| time.to_rfc3339())
    .unwrap_or_default()
}

pub async fn fetch_modpacks(
  app: &AppHandle,
  query: &OtherResourceSearchQuery,
) -> SJMCLResult<OtherResourceSearchRes> {
  let term = query.search_query.trim();
  let method = if term.is_empty() { "browse" } else { "search" };
  let page = query.page.saturating_add(1);
  let sort = if query.sort_by == "updated" {
    "updated"
  } else {
    "popular"
  };
  let version = query.game_version.trim();
  let filters = if version.is_empty() || version == "All" {
    sort.to_owned()
  } else {
    format!("{}/{sort}", urlencoding::encode(version))
  };
  let client = app.state::<reqwest::Client>();
  let request = client.get(format!("{INDEX}/{method}/{filters}/{page}"));
  let request = if term.is_empty() {
    request
  } else {
    request.query(&[("term", term)])
  };
  let results: Projects = metadata(request).await?;
  let total = if page < results.pages {
    u64::from(results.pages - 1) * u64::from(PAGE_SIZE) + 1
  } else {
    u64::from(query.page) * u64::from(PAGE_SIZE) + results.packs.len() as u64
  };
  let list = results
    .packs
    .into_iter()
    .map(|pack| OtherResourceInfo {
      id: pack.id.to_string(),
      _type: "modpack".to_owned(),
      name: pack.name,
      description: pack.synopsis.unwrap_or_default(),
      icon_src: pack
        .art
        .into_iter()
        .find(|art| art.kind == "square")
        .map(|art| art.url)
        .unwrap_or_default(),
      last_updated: iso_date(pack.updated),
      downloads: pack.installs,
      author: pack.authors.into_iter().next().map(|author| author.name),
      source: OtherResourceSource::CurseForge,
      ..Default::default()
    })
    .collect();
  Ok(OtherResourceSearchRes {
    list,
    total,
    page: query.page,
    page_size: PAGE_SIZE,
  })
}

pub async fn fetch_modpack_versions(
  app: &AppHandle,
  query: &OtherResourceVersionPackQuery,
) -> SJMCLResult<Vec<OtherResourceVersionPack>> {
  #[derive(Deserialize)]
  struct Modpack {
    versions: Vec<Version>,
  }
  let project = query
    .resource_id
    .parse::<u64>()
    .map_err(|_| ResourceError::ParseError)?;
  let client = app.state::<reqwest::Client>();
  let data: Modpack = metadata(client.get(format!("{INDEX}/{project}"))).await?;
  let mut packs = HashMap::<String, Vec<OtherResourceFileInfo>>::new();
  for version in data.versions.into_iter().filter(|version| !version.private) {
    let loader = version
      .targets
      .iter()
      .find(|target| target.kind == "modloader")
      .map(|target| target.version.clone());
    if query.mod_loader != "All"
      && !query.mod_loader.is_empty()
      && !loader
        .as_deref()
        .is_some_and(|loader| loader.eq_ignore_ascii_case(&query.mod_loader))
    {
      continue;
    }
    let item = OtherResourceFileInfo {
      resource_id: query.resource_id.clone(),
      file_id: Some(version.id),
      name: version.name,
      file_date: iso_date(version.updated),
      release_type: version.kind.unwrap_or_else(|| "release".to_owned()),
      loader,
      ..Default::default()
    };
    for game in version
      .targets
      .into_iter()
      .filter(|target| target.kind == "game")
    {
      if query.game_versions.is_empty()
        || query
          .game_versions
          .iter()
          .any(|value| value == "All" || value == &game.version)
      {
        packs.entry(game.version).or_default().push(item.clone());
      }
    }
  }
  let mut results: Vec<_> = packs
    .into_iter()
    .map(|(name, items)| OtherResourceVersionPack { name, items })
    .collect();
  results.sort_by(version_pack_sort);
  Ok(results)
}
