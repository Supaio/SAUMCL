use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;

use crate::maintenance::storage::CampusDraft;

pub const PENDING_FILE: &str = ".saumcl-campus-pending";
pub const READY_FILE: &str = ".saumcl-campus.json";
pub const MAX_PACK_BYTES: u64 = 8 * 1024 * 1024 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CampusReceipt {
  pub schema_version: u32,
  pub client_key: String,
  pub installed_at: u64,
  pub archive_sha256: String,
}

// An address or announcement change must not redownload the client. A new
// round, client version or content hash must never silently reuse an old pack.
pub fn client_key(profile: &CampusDraft) -> String {
  let hash = profile.modpack_sha256.to_ascii_lowercase();
  let identity = serde_json::to_vec(&(
    profile.current_round,
    profile.minecraft_version.trim(),
    &profile.loader,
    profile.loader_version.trim(),
    profile.modpack_version.trim(),
    if hash.is_empty() {
      profile.modpack_url.trim()
    } else {
      ""
    },
    &hash,
  ))
  .unwrap();
  format!("{:x}", Sha256::digest(identity))
}

pub fn matches_client(
  profile: &CampusDraft,
  minecraft: &str,
  loader: &str,
  loader_version: &str,
  pack_version: Option<&str>,
) -> bool {
  let expected_loader = match profile.loader {
    crate::maintenance::storage::CampusLoader::None => loader == "Unknown",
    crate::maintenance::storage::CampusLoader::Fabric => loader == "Fabric",
    crate::maintenance::storage::CampusLoader::Forge => {
      matches!(loader, "Forge" | "LegacyForge" | "Cleanroom")
    }
    crate::maintenance::storage::CampusLoader::Neoforge => loader == "NeoForge",
    crate::maintenance::storage::CampusLoader::Quilt => loader == "Quilt",
  };
  (profile.minecraft_version.is_empty() || profile.minecraft_version == minecraft)
    && expected_loader
    && (profile.loader_version.is_empty()
      || loader == "Unknown"
      || profile.loader_version == loader_version)
    && (profile.modpack_version.is_empty()
      || pack_version == Some(profile.modpack_version.as_str()))
}

pub fn hash_archive(path: &Path) -> Result<String, String> {
  let mut file = File::open(path).map_err(|_| "PACK_READ_FAILED")?;
  if file.metadata().map_err(|_| "PACK_READ_FAILED")?.len() > MAX_PACK_BYTES {
    return Err("PACK_TOO_LARGE".into());
  }
  let mut hasher = Sha256::new();
  let mut buffer = [0; 128 * 1024];
  loop {
    let count = file.read(&mut buffer).map_err(|_| "PACK_READ_FAILED")?;
    if count == 0 {
      break;
    }
    hasher.update(&buffer[..count]);
  }
  Ok(format!("{:x}", hasher.finalize()))
}

fn safe_relative_path(path: &str) -> bool {
  !path.is_empty()
    && !path.starts_with(['/', '\\'])
    && !path.contains([':', '\0'])
    && !path.replace('\\', "/").split('/').any(|part| part == "..")
}

pub fn validate_archive(path: &Path) -> Result<(), String> {
  let mut archive = zip::ZipArchive::new(File::open(path).map_err(|_| "PACK_READ_FAILED")?)
    .map_err(|_| "PACK_FORMAT_UNSUPPORTED")?;
  if archive.len() > 100_000 {
    return Err("PACK_TOO_LARGE".into());
  }
  let mut total_size = 0u64;
  for index in 0..archive.len() {
    let file = archive.by_index(index).map_err(|_| "PACK_READ_FAILED")?;
    let name = file.name().map_err(|_| "PACK_UNSAFE_PATH")?;
    if !safe_relative_path(&name)
      || file
        .unix_mode()
        .is_some_and(|mode| mode & 0o170000 == 0o120000)
    {
      return Err("PACK_UNSAFE_PATH".into());
    }
    total_size = total_size
      .checked_add(file.size())
      .ok_or("PACK_TOO_LARGE")?;
    if total_size > 32 * 1024 * 1024 * 1024 {
      return Err("PACK_TOO_LARGE".into());
    }
  }
  if let Ok(file) = archive.by_name("modrinth.index.json") {
    let mut text = String::new();
    file
      .take(4 * 1024 * 1024 + 1)
      .read_to_string(&mut text)
      .map_err(|_| "PACK_READ_FAILED")?;
    if text.len() > 4 * 1024 * 1024 {
      return Err("PACK_TOO_LARGE".into());
    }
    let manifest: serde_json::Value =
      serde_json::from_str(&text).map_err(|_| "PACK_FORMAT_UNSUPPORTED")?;
    let files = manifest["files"]
      .as_array()
      .ok_or("PACK_FORMAT_UNSUPPORTED")?;
    if files.len() > 100_000 {
      return Err("PACK_TOO_LARGE".into());
    }
    for file in files {
      if !file["path"].as_str().is_some_and(safe_relative_path) {
        return Err("PACK_UNSAFE_PATH".into());
      }
      for download in file["downloads"]
        .as_array()
        .ok_or("PACK_FORMAT_UNSUPPORTED")?
      {
        let url = url::Url::parse(download.as_str().ok_or("PACK_FORMAT_UNSUPPORTED")?)
          .map_err(|_| "PACK_FORMAT_UNSUPPORTED")?;
        if !matches!(url.scheme(), "https" | "http")
          || url.host_str().is_none()
          || !url.username().is_empty()
          || url.password().is_some()
        {
          return Err("PACK_FORMAT_UNSUPPORTED".into());
        }
      }
    }
  }
  Ok(())
}

pub fn read_receipt(root: &Path) -> Option<CampusReceipt> {
  if root.join(PENDING_FILE).exists() {
    return None;
  }
  let mut text = String::new();
  File::open(root.join(READY_FILE))
    .ok()?
    .take(8193)
    .read_to_string(&mut text)
    .ok()?;
  if text.len() > 8192 {
    return None;
  }
  let receipt: CampusReceipt = serde_json::from_str(&text).ok()?;
  (receipt.schema_version == 1).then_some(receipt)
}

pub fn copy_player_preferences(from: &Path, to: &Path) -> Result<(), String> {
  let root = from.canonicalize().map_err(|_| "PREFERENCES_FAILED")?;
  for name in ["options.txt", "optionsof.txt", "servers.dat"] {
    let source = from.join(name);
    let Ok(metadata) = fs::symlink_metadata(&source) else {
      continue;
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 8 * 1024 * 1024
    {
      continue;
    }
    if !source
      .canonicalize()
      .is_ok_and(|path| path.starts_with(&root))
    {
      continue;
    }
    let destination = to.join(name);
    if destination.exists() {
      continue;
    }
    let mut target = OpenOptions::new()
      .write(true)
      .create_new(true)
      .open(&destination)
      .map_err(|_| "PREFERENCES_FAILED")?;
    std::io::copy(
      &mut File::open(source).map_err(|_| "PREFERENCES_FAILED")?,
      &mut target,
    )
    .map_err(|_| "PREFERENCES_FAILED")?;
    target.flush().map_err(|_| "PREFERENCES_FAILED")?;
  }
  Ok(())
}

// Only clean the fresh, private attempt created by this operation. Never touch a
// ready installation, a link, a sibling directory, or a player's older instance.
pub fn clean_incomplete(versions: &Path, target: &Path) -> bool {
  let Ok(base) = versions.canonicalize() else {
    return false;
  };
  let Ok(metadata) = fs::symlink_metadata(target) else {
    return false;
  };
  let Ok(resolved) = target.canonicalize() else {
    return false;
  };
  let valid = metadata.is_dir()
    && !metadata.file_type().is_symlink()
    && resolved.parent() == Some(base.as_path())
    && target
      .file_name()
      .is_some_and(|name| name.to_string_lossy().starts_with("SAUMCL-CLMC-"))
    && target.join(PENDING_FILE).is_file()
    && !target.join(READY_FILE).exists();
  valid && fs::remove_dir_all(resolved).is_ok()
}

pub fn loader_task_group(root: &Path, name: &str, id: &str, normal: &str) -> String {
  if root.join(PENDING_FILE).is_file() {
    format!("campus-loader?{name}")
  } else {
    format!("{normal}?{id}")
  }
}
