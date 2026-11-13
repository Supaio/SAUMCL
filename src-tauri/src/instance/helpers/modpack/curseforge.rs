use serde::{Deserialize, Serialize};
use sjmcl_types::error::SJMCLResult;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use zip::ZipArchive;

use crate::instance::constants::INSTANCE_CFG_FILE_NAME;
use crate::instance::helpers::modpack::import::ModpackMetaInfo;
use crate::instance::models::misc::{InstanceError, ModLoader, ModLoaderType};
use crate::resource::models::OtherResourceSource;
use crate::utils::fs::validate_sha1;

const MANIFEST_LIMIT: u64 = 4 * 1024 * 1024;
const PROFILE_LIMIT: u64 = 32 * 1024 * 1024;
const CONTENT_FOLDERS: &[&str] = &[
  "mods",
  "resourcepacks",
  "shaderpacks",
  "datapacks",
  "texturepacks",
  "saves",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeManifest {
  manifest_type: String,
  manifest_version: u32,
  minecraft: Minecraft,
  name: String,
  version: Option<String>,
  author: Option<String>,
  overrides: Option<String>,
  files: Vec<ManifestFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Minecraft {
  version: String,
  mod_loaders: Vec<Loader>,
}

#[derive(Debug, Deserialize)]
struct Loader {
  id: String,
  #[serde(default)]
  primary: bool,
}

type FileId = (u64, u64);

#[derive(Debug, Deserialize)]
struct ManifestFile {
  #[serde(rename = "projectID")]
  project_id: u64,
  #[serde(rename = "fileID")]
  file_id: u64,
  required: bool,
}

impl ManifestFile {
  fn id(&self) -> FileId {
    (self.project_id, self.file_id)
  }
}

fn read_limited(file: impl Read, limit: u64) -> io::Result<String> {
  let mut text = String::new();
  file.take(limit + 1).read_to_string(&mut text)?;
  if text.len() as u64 > limit {
    return Err(io::Error::new(
      io::ErrorKind::InvalidData,
      "Metadata exceeds size limit",
    ));
  }
  Ok(text)
}

fn parse_loader(id: &str, game: &str) -> Option<ModLoader> {
  let (kind, version) = id.split_once('-')?;
  let loader_type = match kind {
    "forge" => ModLoaderType::Forge,
    "neoforge" => ModLoaderType::NeoForge,
    "fabric" => ModLoaderType::Fabric,
    "quilt" => ModLoaderType::Quilt,
    _ => return None,
  };
  let version = version.strip_prefix(&format!("{game}-")).unwrap_or(version);
  let version = version.strip_suffix(&format!("-{game}")).unwrap_or(version);
  if version.is_empty()
    || !version
      .bytes()
      .all(|c| c.is_ascii_alphanumeric() || b".-_+".contains(&c))
  {
    return None;
  }
  Some(ModLoader {
    loader_type,
    version: version.to_owned(),
    ..Default::default()
  })
}

fn safe_component(name: &str) -> bool {
  if name.is_empty()
    || name.ends_with(['.', ' '])
    || name
      .chars()
      .any(|c| c.is_control() || "\\/:<>\"|?*".contains(c))
  {
    return false;
  }
  let stem = name
    .split('.')
    .next()
    .unwrap_or_default()
    .to_ascii_uppercase();
  !matches!(
    stem.as_str(),
    "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
  ) && !["COM", "LPT"].iter().any(|prefix| {
    stem.strip_prefix(prefix).is_some_and(|number| {
      (number.len() == 1 && number.as_bytes()[0].is_ascii_digit())
        || matches!(number, "¹" | "²" | "³")
    })
  })
}

pub fn validate_instance_name(name: &str) -> SJMCLResult<()> {
  if name.trim().is_empty() || name.encode_utf16().count() > 255 || !safe_component(name) {
    return Err(InstanceError::InvalidNameError.into());
  }
  Ok(())
}

impl CurseForgeManifest {
  pub fn is_archive(file: &File) -> bool {
    ZipArchive::new(file)
      .ok()
      .is_some_and(|mut zip| zip.by_name("manifest.json").is_ok())
  }

  pub fn from_archive(file: &File) -> SJMCLResult<Option<Self>> {
    let mut zip = ZipArchive::new(file)?;
    let Ok(entry) = zip.by_name("manifest.json") else {
      return Ok(None);
    };
    let text =
      read_limited(entry, MANIFEST_LIMIT).map_err(|_| InstanceError::ModpackManifestParseError)?;
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text.trim_start_matches('\u{feff}'))
    else {
      return Ok(None);
    };
    if value["manifestType"].as_str() != Some("minecraftModpack") {
      return Ok(None);
    }
    let pack: Self =
      serde_json::from_value(value).map_err(|_| InstanceError::ModpackManifestParseError)?;
    pack.validate()?;
    Ok(Some(pack))
  }

  pub fn read(path: &Path) -> SJMCLResult<Self> {
    Self::from_archive(&File::open(path).map_err(|_| InstanceError::FileNotFoundError)?)?
      .ok_or_else(|| InstanceError::ModpackManifestParseError.into())
  }

  fn validate(&self) -> SJMCLResult<()> {
    if self.manifest_type != "minecraftModpack"
      || self.manifest_version != 1
      || self.name.trim().is_empty()
      || self.minecraft.version.trim().is_empty()
      || self
        .files
        .iter()
        .any(|file| file.project_id == 0 || file.file_id == 0)
      || self.overrides.as_deref().is_some_and(|path| {
        !path.is_empty() && !path.trim_end_matches('/').split('/').all(safe_component)
      })
    {
      return Err(InstanceError::ModpackManifestParseError.into());
    }
    self.loader()?;
    Ok(())
  }

  fn loader(&self) -> SJMCLResult<Option<ModLoader>> {
    self
      .minecraft
      .mod_loaders
      .iter()
      .find(|loader| loader.primary)
      .or_else(|| self.minecraft.mod_loaders.first())
      .map(|loader| {
        parse_loader(&loader.id, &self.minecraft.version)
          .ok_or_else(|| InstanceError::UnsupportedModLoader.into())
      })
      .transpose()
  }

  pub fn meta_info(&self) -> SJMCLResult<ModpackMetaInfo> {
    Ok(ModpackMetaInfo {
      name: self.name.clone(),
      version: self.version.clone(),
      description: None,
      author: self.author.clone(),
      modpack_source: OtherResourceSource::CurseForge,
      client_version: self.minecraft.version.clone(),
      mod_loader: self.loader()?,
    })
  }

  fn matches_loader(&self, game: &str, loader: Option<ModLoader>) -> bool {
    game == self.minecraft.version
      && self.loader().ok().is_some_and(|expected| {
        expected
          .as_ref()
          .map(|loader| (loader.loader_type, &loader.version))
          == loader
            .as_ref()
            .map(|loader| (loader.loader_type, &loader.version))
      })
  }

  fn required_files(&self) -> HashSet<FileId> {
    self
      .files
      .iter()
      .filter(|file| file.required)
      .map(ManifestFile::id)
      .collect()
  }

  fn copy_overrides(&self, file: &File, destination: &Path) -> SJMCLResult<()> {
    let Some(directory) = self
      .overrides
      .as_deref()
      .filter(|directory| !directory.is_empty())
    else {
      return Ok(());
    };
    let prefix = format!("{}/", directory.trim_end_matches('/'));
    let mut zip = ZipArchive::new(file)?;
    if zip.len() > 100_000 {
      return Err(InstanceError::ZipFileProcessFailed.into());
    }
    let mut bytes = 0u64;
    for index in 0..zip.len() {
      let mut entry = zip.by_index(index)?;
      let name = entry.name()?;
      let Some(relative) = name.strip_prefix(&prefix).filter(|name| !name.is_empty()) else {
        continue;
      };
      if !relative
        .trim_end_matches('/')
        .split('/')
        .all(safe_component)
        || entry
          .unix_mode()
          .is_some_and(|mode| mode & 0o170000 == 0o120000)
      {
        return Err(InstanceError::InvalidSourcePath.into());
      }
      if !entry.is_file() {
        continue;
      }
      let first = relative.split('/').next().unwrap_or_default();
      if first.eq_ignore_ascii_case(INSTANCE_CFG_FILE_NAME)
        || first.to_ascii_lowercase().starts_with(".saumcl-")
      {
        continue;
      }
      bytes = bytes.saturating_add(entry.size());
      if bytes > 32 * 1024 * 1024 * 1024 {
        return Err(InstanceError::ZipFileProcessFailed.into());
      }
      let output = destination.join(relative);
      fs::create_dir_all(output.parent().ok_or(InstanceError::InvalidSourcePath)?)?;
      io::copy(
        &mut entry,
        &mut File::options().write(true).create_new(true).open(output)?,
      )?;
    }
    Ok(())
  }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurseForgeProfile {
  game_version: String,
  base_mod_loader: Option<ProfileLoader>,
  #[serde(default)]
  installed_addons: Vec<Addon>,
}

#[derive(Deserialize)]
struct ProfileLoader {
  name: String,
}

#[derive(Deserialize)]
struct Addon {
  #[serde(rename = "addonID", alias = "addonId")]
  addon_id: Option<u64>,
  #[serde(rename = "installedFile")]
  installed_file: Option<InstalledFile>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledFile {
  id: u64,
  file_name: Option<String>,
  file_name_on_disk: Option<String>,
  #[serde(default)]
  hashes: Vec<CurseForgeHash>,
}

#[derive(Deserialize)]
struct CurseForgeHash {
  algo: u32,
  value: String,
}

#[derive(Deserialize)]
struct PrismIndex {
  filename: String,
  update: PrismUpdate,
  download: Option<PrismHash>,
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
struct PrismHash {
  hash_format: String,
  hash: String,
}

#[derive(Deserialize)]
struct PrismUpdate {
  curseforge: PrismFileId,
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
struct PrismFileId {
  project_id: u64,
  file_id: u64,
}

#[derive(Debug)]
struct LocalFile {
  path: PathBuf,
  relative: PathBuf,
  sha1: Option<String>,
}

fn bounded_json<T: serde::de::DeserializeOwned>(path: &Path, limit: u64) -> Option<T> {
  let text = read_limited(File::open(path).ok()?, limit).ok()?;
  serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

fn local_file(root: &Path, folder: &str, name: &str, sha1: Option<String>) -> Option<LocalFile> {
  if !safe_component(name) {
    return None;
  }
  let relative = Path::new(folder).join(name);
  let path = root.join(&relative).canonicalize().ok()?;
  let metadata = path.metadata().ok()?;
  if !path.starts_with(root) || !metadata.is_file() || metadata.len() == 0 {
    return None;
  }
  Some(LocalFile {
    path,
    relative,
    sha1,
  })
}

fn curseforge_files(
  root: &Path,
  pack: &CurseForgeManifest,
  requested: &HashSet<FileId>,
  files: &mut HashMap<FileId, LocalFile>,
) {
  let Some(profile) =
    bounded_json::<CurseForgeProfile>(&root.join("minecraftinstance.json"), PROFILE_LIMIT)
  else {
    return;
  };
  let loader = match profile.base_mod_loader {
    Some(loader) => match parse_loader(&loader.name, &profile.game_version) {
      Some(loader) => Some(loader),
      None => return,
    },
    None => None,
  };
  if !pack.matches_loader(&profile.game_version, loader) {
    return;
  }
  for addon in profile.installed_addons {
    let (Some(project_id), Some(installed)) = (addon.addon_id, addon.installed_file) else {
      continue;
    };
    let id = (project_id, installed.id);
    if files.contains_key(&id) || !requested.contains(&id) {
      continue;
    }
    let Some(name) = installed
      .file_name_on_disk
      .as_deref()
      .filter(|name| !name.is_empty())
      .or(installed.file_name.as_deref())
    else {
      continue;
    };
    let sha1 = installed
      .hashes
      .into_iter()
      .find(|hash| {
        hash.algo == 1
          && hash.value.len() == 40
          && hash.value.bytes().all(|byte| byte.is_ascii_hexdigit())
      })
      .map(|hash| hash.value.to_ascii_lowercase());
    if let Some(file) = CONTENT_FOLDERS
      .iter()
      .find_map(|folder| local_file(root, folder, name, sha1.clone()))
    {
      files.insert(id, file);
    }
  }
}

fn prism_files(
  root: &Path,
  pack: &CurseForgeManifest,
  requested: &HashSet<FileId>,
  files: &mut HashMap<FileId, LocalFile>,
) {
  let Some(source) =
    bounded_json::<CurseForgeManifest>(&root.join("flame/manifest.json"), MANIFEST_LIMIT)
  else {
    return;
  };
  if source.validate().is_err()
    || source.name != pack.name
    || source.version != pack.version
    || !pack.matches_loader(&source.minecraft.version, source.loader().ok().flatten())
  {
    return;
  }
  let Some(game_root) = [".minecraft", "minecraft"].iter().find_map(|name| {
    root
      .join(name)
      .canonicalize()
      .ok()
      .filter(|path| path.is_dir() && path.starts_with(root))
  }) else {
    return;
  };
  for folder in CONTENT_FOLDERS {
    let Ok(entries) = fs::read_dir(game_root.join(folder).join(".index")) else {
      continue;
    };
    for entry in entries.flatten().take(10_000) {
      let path = entry.path();
      if path.extension().is_none_or(|extension| extension != "toml") {
        continue;
      }
      let Ok(text) = File::open(path).and_then(|file| read_limited(file, 64 * 1024)) else {
        continue;
      };
      let Ok(index) = toml::from_str::<PrismIndex>(&text) else {
        continue;
      };
      let id = (
        index.update.curseforge.project_id,
        index.update.curseforge.file_id,
      );
      if files.contains_key(&id) || !requested.contains(&id) {
        continue;
      }
      let sha1 = index
        .download
        .filter(|download| {
          download.hash_format.eq_ignore_ascii_case("sha1")
            && download.hash.len() == 40
            && download.hash.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
        .map(|download| download.hash.to_ascii_lowercase());
      if let Some(file) = local_file(&game_root, folder, &index.filename, sha1) {
        files.insert(id, file);
      }
    }
  }
}

fn instance_roots(app: &AppHandle, custom: Option<&Path>) -> Vec<PathBuf> {
  let mut roots = Vec::new();
  let mut parents = Vec::new();
  if let Some(path) = custom {
    roots.push(path.to_path_buf());
    parents.push(path.to_path_buf());
  }
  if let Ok(home) = app.path().home_dir() {
    parents.push(home.join("curseforge/minecraft/Instances"));
    #[cfg(target_os = "linux")]
    parents
      .push(home.join(".var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher/instances"));
  }
  if let Ok(data) = app.path().data_dir() {
    let prism = data.join("PrismLauncher");
    parents.push(prism_instance_directory(&prism));
    parents.push(data.join("CurseForge/minecraft/Instances"));
  }
  if let Ok(documents) = app.path().document_dir() {
    parents.push(documents.join("curseforge/minecraft/Instances"));
  }
  if let Some(executable) = prism_executable(app)
    && let Some(parent) = executable.parent()
    && parent.join("prismlauncher.cfg").is_file()
  {
    parents.push(prism_instance_directory(parent));
  }
  for path in parents {
    if let Ok(entries) = fs::read_dir(path) {
      roots.extend(
        entries
          .flatten()
          .filter(|entry| entry.file_type().is_ok_and(|ty| ty.is_dir()))
          .take(256)
          .map(|entry| entry.path()),
      );
    }
  }
  roots
}

fn prism_instance_directory(root: &Path) -> PathBuf {
  if let Ok(text) =
    File::open(root.join("prismlauncher.cfg")).and_then(|file| read_limited(file, 1024 * 1024))
    && let Some(path) = text
      .lines()
      .find_map(|line| line.strip_prefix("InstanceDir="))
    && !path.trim().is_empty()
  {
    return root.join(path.trim());
  }
  root.join("instances")
}

pub struct CurseForgeImport {
  archive: File,
  pack: CurseForgeManifest,
  files: HashMap<FileId, LocalFile>,
}

impl CurseForgeImport {
  pub fn resolve(app: &AppHandle, archive: PathBuf, custom: Option<&Path>) -> SJMCLResult<Self> {
    let file = File::open(&archive).map_err(|_| InstanceError::FileNotFoundError)?;
    let pack =
      CurseForgeManifest::from_archive(&file)?.ok_or(InstanceError::ModpackManifestParseError)?;
    Ok(Self::from_sources(file, pack, instance_roots(app, custom)))
  }

  fn from_sources(archive: File, pack: CurseForgeManifest, roots: Vec<PathBuf>) -> Self {
    let mut files = HashMap::new();
    let mut scanned = HashSet::new();
    let requested: HashSet<_> = pack.files.iter().map(ManifestFile::id).collect();
    if !requested.is_empty() {
      for root in roots
        .into_iter()
        .filter_map(|root| root.canonicalize().ok())
      {
        if scanned.insert(root.clone()) {
          curseforge_files(&root, &pack, &requested, &mut files);
          prism_files(&root, &pack, &requested, &mut files);
          if files.len() == requested.len() {
            break;
          }
        }
      }
    }
    Self {
      archive,
      pack,
      files,
    }
  }

  pub fn meta_info(&self) -> SJMCLResult<ModpackMetaInfo> {
    self.pack.meta_info()
  }

  pub fn progress(&self) -> (usize, usize) {
    let required = self.pack.required_files();
    (
      required
        .iter()
        .filter(|id| self.files.contains_key(id))
        .count(),
      required.len(),
    )
  }

  pub fn validate_target(&self, destination: &Path) -> SJMCLResult<()> {
    let (found, required) = self.progress();
    if found != required {
      return Err(InstanceError::CurseForgeFilesMissing.into());
    }
    let mut destinations = HashSet::new();
    for file in self.files.values() {
      if !destinations.insert(file.relative.to_string_lossy().to_lowercase())
        || file.path.starts_with(destination)
      {
        return Err(InstanceError::FileCopyFailed.into());
      }
    }
    Ok(())
  }

  pub fn copy_into(&self, destination: &Path) -> SJMCLResult<()> {
    self.pack.copy_overrides(&self.archive, destination)?;
    for file in self.files.values() {
      let target = destination.join(&file.relative);
      fs::create_dir_all(target.parent().ok_or(InstanceError::InvalidSourcePath)?)?;
      let mut output = File::options().write(true).create_new(true).open(&target)?;
      if io::copy(&mut File::open(&file.path)?, &mut output)? == 0 {
        return Err(InstanceError::FileCopyFailed.into());
      }
      drop(output);
      if let Some(sha1) = &file.sha1 {
        validate_sha1(target, sha1.clone()).map_err(|_| InstanceError::CurseForgeFileMismatch)?;
      }
    }
    Ok(())
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurseForgeImportStatus {
  pub available_files: usize,
  pub required_files: usize,
  pub prism_available: bool,
}

#[derive(Default)]
pub struct CurseForgeImportState(pub tokio::sync::Mutex<()>);

pub fn prism_executable(app: &AppHandle) -> Option<PathBuf> {
  let mut paths = Vec::new();
  #[cfg(target_os = "windows")]
  {
    for key in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
      if let Some(path) = std::env::var_os(key) {
        paths.push(PathBuf::from(path).join("PrismLauncher/prismlauncher.exe"));
      }
    }
    if let Ok(data) = app.path().local_data_dir() {
      paths.push(data.join("Programs/PrismLauncher/prismlauncher.exe"));
      paths.push(data.join("PrismLauncher/prismlauncher.exe"));
    }
  }
  #[cfg(target_os = "macos")]
  {
    paths.push(PathBuf::from(
      "/Applications/Prism Launcher.app/Contents/MacOS/prismlauncher",
    ));
    if let Ok(home) = app.path().home_dir() {
      paths.push(home.join("Applications/Prism Launcher.app/Contents/MacOS/prismlauncher"));
    }
  }
  #[cfg(target_os = "linux")]
  {
    let _ = app;
    paths.extend([
      PathBuf::from("/usr/bin/prismlauncher"),
      PathBuf::from("/usr/local/bin/prismlauncher"),
    ]);
  }
  paths.into_iter().find(|path| path.is_file())
}

#[cfg(test)]
mod tests {
  use serde_json::{Value, json};
  use std::io::Write;
  use uuid::Uuid;
  use zip::ZipWriter;
  use zip::write::SimpleFileOptions;

  use crate::instance::helpers::modpack::curseforge::{
    CurseForgeImport, CurseForgeManifest, File, Path, fs,
  };
  use crate::instance::models::misc::{InstanceError, ModLoaderType};
  use crate::utils::fs::RemoveDirGuard;

  fn fixture() -> Value {
    json!({
      "manifestType": "minecraftModpack", "manifestVersion": 1,
      "name": "Test pack", "version": "0.14.0-beta", "author": "Test",
      "minecraft": {"version":"26.1.2","modLoaders":[{"id":"neoforge-26.1.2.126","primary":true}]},
      "overrides": "overrides",
      "files": [{"projectID":12,"fileID":34,"required":true},{"projectID":56,"fileID":78,"required":false}]
    })
  }

  fn archive(root: &Path, extra: &str) -> File {
    let path = root.join("pack.zip");
    let mut zip = ZipWriter::new(File::create(&path).unwrap());
    for (name, contents) in [
      ("manifest.json", fixture().to_string()),
      (extra, "example".into()),
    ] {
      zip.start_file(name, SimpleFileOptions::default()).unwrap();
      zip.write_all(contents.as_bytes()).unwrap();
    }
    zip.finish().unwrap();
    File::open(path).unwrap()
  }

  fn prepare() -> (std::path::PathBuf, RemoveDirGuard) {
    let root = std::env::temp_dir().join(format!("saumcl-curseforge-{}", Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    let guard = RemoveDirGuard::new(root.clone());
    (root, guard)
  }

  #[test]
  fn reads_loader_and_reuses_only_the_requested_file_from_curseforge() {
    let (root, _guard) = prepare();
    let zip = archive(&root, "overrides/config/test.cfg");
    let source = root.join("cursematching");
    fs::create_dir_all(source.join("mods")).unwrap();
    let mut profile = json!({
      "gameVersion":"26.1.2","baseModLoader":{"name":"neoforge-26.1.2.126"},
      "installedAddons":[{"addonID":12,"installedFile":{"id":33,"fileNameOnDisk":"test.jar"}}]
    });
    fs::write(source.join("mods/test.jar"), b"abc").unwrap();
    fs::write(source.join("mods/unlisted.jar"), b"other").unwrap();
    let profile_path = source.join("minecraftinstance.json");
    fs::write(&profile_path, profile.to_string()).unwrap();
    let pack = CurseForgeManifest::from_archive(&zip).unwrap().unwrap();
    let mod_loader = pack.meta_info().unwrap().mod_loader.unwrap();
    assert_eq!(mod_loader.loader_type, ModLoaderType::NeoForge);
    assert_eq!(mod_loader.version, "26.1.2.126");
    let import = CurseForgeImport::from_sources(zip, pack, vec![source.clone()]);
    assert_eq!(import.progress(), (0, 1));
    let output = root.join("output");
    assert_eq!(
      import.validate_target(&output).unwrap_err().0,
      InstanceError::CurseForgeFilesMissing.to_string()
    );
    profile["installedAddons"][0]["installedFile"]["id"] = json!(34);
    profile["installedAddons"][0]["installedFile"]["hashes"] =
      json!([{"algo":1,"value":"a9993e364706816aba3e25717850c26c9cd0d89d"}]);
    fs::write(&profile_path, profile.to_string()).unwrap();
    let zip = File::open(root.join("pack.zip")).unwrap();
    let pack = CurseForgeManifest::from_archive(&zip).unwrap().unwrap();
    let import = CurseForgeImport::from_sources(zip, pack, vec![source.clone()]);
    assert_eq!(import.progress(), (1, 1));
    import.validate_target(&output).unwrap();
    import.copy_into(&output).unwrap();
    assert_eq!(fs::read(output.join("mods/test.jar")).unwrap(), b"abc");
    assert!(output.join("config/test.cfg").is_file());
    assert!(!output.join("mods/unlisted.jar").exists());
    fs::write(source.join("mods/test.jar"), b"different contents").unwrap();
    assert_eq!(
      import.copy_into(&root.join("invalid")).unwrap_err().0,
      InstanceError::CurseForgeFileMismatch.to_string()
    );
  }

  #[test]
  fn prism_metadata_requires_the_exact_file_to_be_present() {
    let (root, _guard) = prepare();
    let zip = archive(&root, "overrides/config/test.cfg");
    let source = root.join("prism");
    let mods = source.join(".minecraft/mods");
    fs::create_dir_all(mods.join(".index")).unwrap();
    fs::create_dir_all(source.join("flame")).unwrap();
    fs::write(source.join("flame/manifest.json"), fixture().to_string()).unwrap();
    fs::write(
      mods.join(".index/test.pw.toml"),
      "filename = 'test.jar'\n[update.curseforge]\nproject-id = 12\nfile-id = 34\n",
    )
    .unwrap();
    let pack = CurseForgeManifest::from_archive(&zip).unwrap().unwrap();
    let import = CurseForgeImport::from_sources(zip, pack, vec![source.clone()]);
    assert_eq!(import.progress(), (0, 1));
    fs::write(mods.join("test.jar"), b"abc").unwrap();
    let zip = File::open(root.join("pack.zip")).unwrap();
    let pack = CurseForgeManifest::from_archive(&zip).unwrap().unwrap();
    let import = CurseForgeImport::from_sources(zip, pack, vec![source]);
    assert_eq!(import.progress(), (1, 1));
  }

  #[test]
  fn rejects_override_paths_that_escape_the_instance() {
    let (root, _guard) = prepare();
    let zip = archive(&root, "overrides/../escaped.cfg");
    let pack = CurseForgeManifest::from_archive(&zip).unwrap().unwrap();
    assert!(pack.copy_overrides(&zip, &root.join("output")).is_err());
    assert!(!root.join("escaped.cfg").exists());
  }
}
