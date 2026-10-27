#[path = "../src/maintenance/auth.rs"]
pub mod maintenance_auth;
#[path = "../src/maintenance/storage.rs"]
pub mod maintenance_storage;
mod maintenance {
  pub use crate::maintenance_auth as auth;
  pub use crate::maintenance_storage as storage;
}
#[path = "../src/instance/helpers/campus_plan.rs"]
mod campus_plan;

use campus_plan::*;
use maintenance::storage::{CampusDraft, CampusLoader};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use zip::write::SimpleFileOptions;

struct TestDirectory(PathBuf);
impl TestDirectory {
  fn new() -> Self {
    let root = std::env::temp_dir().join(format!("saumcl-campus-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    Self(root)
  }
  fn archive(&self, entries: &[(&str, &str)]) -> PathBuf {
    let path = self.0.join(format!("{}.zip", uuid::Uuid::new_v4()));
    let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
    for (name, content) in entries {
      zip.start_file(*name, SimpleFileOptions::default()).unwrap();
      zip.write_all(content.as_bytes()).unwrap();
    }
    zip.finish().unwrap();
    path
  }
}
impl Drop for TestDirectory {
  fn drop(&mut self) {
    let root = self.0.canonicalize().unwrap();
    assert_eq!(
      root.parent(),
      Some(std::env::temp_dir().canonicalize().unwrap().as_path())
    );
    assert!(
      root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("saumcl-campus-test-")
    );
    fs::remove_dir_all(root).unwrap();
  }
}

fn profile() -> CampusDraft {
  CampusDraft {
    current_round: Some(20),
    minecraft_version: "1.21.8".into(),
    modpack_version: "20.1".into(),
    modpack_url: "https://example.invalid/client.mrpack".into(),
    ..Default::default()
  }
}

#[test]
fn identity_changes_for_content_and_round_but_not_connection_or_announcement() {
  let profile = profile();
  let key = client_key(&profile);
  let mut changed = profile.clone();
  changed.server_address = "example.invalid:25566".into();
  changed.announcement = "New address".into();
  changed.maintenance = false;
  changed.next_round = Some(21);
  assert_eq!(client_key(&changed), key);
  for change in 0..5 {
    let mut changed = profile.clone();
    match change {
      0 => changed.current_round = Some(21),
      1 => changed.modpack_version = "20.2".into(),
      2 => changed.modpack_url = "https://example.invalid/new.mrpack".into(),
      3 => changed.minecraft_version = "1.21.9".into(),
      _ => changed.modpack_sha256 = "a".repeat(64),
    }
    assert_ne!(client_key(&changed), key);
  }
  let mut hashed = profile.clone();
  hashed.modpack_sha256 = "a".repeat(64);
  let key = client_key(&hashed);
  hashed.modpack_url = "https://mirror.example.invalid/new-link.mrpack".into();
  hashed.modpack_sha256 = "A".repeat(64);
  assert_eq!(client_key(&hashed), key);
}

#[test]
fn compatible_metadata_requires_the_published_loader_and_pack_version() {
  let mut draft = profile();
  assert!(matches_client(
    &draft,
    "1.21.8",
    "Unknown",
    "",
    Some("20.1")
  ));
  assert!(!matches_client(
    &draft,
    "1.21.9",
    "Unknown",
    "",
    Some("20.1")
  ));
  assert!(!matches_client(&draft, "1.21.8", "Unknown", "", None));
  draft.loader = CampusLoader::Forge;
  draft.loader_version = "47.4.0".into();
  for loader in ["Forge", "LegacyForge", "Cleanroom"] {
    assert!(matches_client(
      &draft,
      "1.21.8",
      loader,
      "47.4.0",
      Some("20.1")
    ));
  }
  assert!(!matches_client(
    &draft,
    "1.21.8",
    "Forge",
    "47.3.0",
    Some("20.1")
  ));
  assert!(!matches_client(
    &draft,
    "1.21.8",
    "Fabric",
    "47.4.0",
    Some("20.1")
  ));
}

#[test]
fn legacy_config_without_checksum_is_accepted_and_invalid_checksum_is_rejected() {
  let mut data = serde_json::to_value(profile()).unwrap();
  data.as_object_mut().unwrap().remove("modpackSha256");
  let draft: CampusDraft = serde_json::from_value(data).unwrap();
  assert!(draft.modpack_sha256.is_empty());
  assert!(draft.validate().is_ok());
  for hash in ["123".into(), "g".repeat(64), "a".repeat(65)] {
    let mut invalid = draft.clone();
    invalid.modpack_sha256 = hash;
    assert!(invalid.validate().is_err());
  }
}

#[test]
fn validates_archives_and_rejects_escaping_zip_and_manifest_paths() {
  let root = TestDirectory::new();
  let valid = root.archive(&[("overrides/config/example.txt", "example")]);
  assert!(validate_archive(&valid).is_ok());
  assert_eq!(hash_archive(&valid).unwrap().len(), 64);
  for name in [
    "../outside",
    "/outside",
    "C:/outside",
    "overrides/../../outside",
    "overrides\\..\\outside",
  ] {
    let path = root.archive(&[(name, "unsafe")]);
    assert_eq!(validate_archive(&path).unwrap_err(), "PACK_UNSAFE_PATH");
  }
  for name in ["../outside", "C:\\outside", "\\\\host\\share", "/outside"] {
    let manifest = serde_json::json!({"files": [{"path": name, "downloads": ["https://example.invalid/mod.jar"]}]}).to_string();
    let path = root.archive(&[("modrinth.index.json", &manifest)]);
    assert_eq!(validate_archive(&path).unwrap_err(), "PACK_UNSAFE_PATH");
  }
  let path = root.archive(&[(
    "modrinth.index.json",
    r#"{"files":[{"path":"mods/mod.jar","downloads":["file:///etc/passwd"]}]}"#,
  )]);
  assert_eq!(
    validate_archive(&path).unwrap_err(),
    "PACK_FORMAT_UNSUPPORTED"
  );
}

#[test]
fn incomplete_or_invalid_receipts_never_mark_a_client_ready() {
  let root = TestDirectory::new();
  let receipt = CampusReceipt {
    schema_version: 1,
    client_key: "key".into(),
    installed_at: 1,
    archive_sha256: "a".repeat(64),
  };
  fs::write(
    root.0.join(READY_FILE),
    serde_json::to_vec(&receipt).unwrap(),
  )
  .unwrap();
  assert_eq!(read_receipt(&root.0).unwrap().client_key, "key");
  fs::write(root.0.join(PENDING_FILE), "pending").unwrap();
  assert!(read_receipt(&root.0).is_none());
  fs::remove_file(root.0.join(PENDING_FILE)).unwrap();
  fs::write(root.0.join(READY_FILE), "invalid").unwrap();
  assert!(read_receipt(&root.0).is_none());
}

#[test]
fn cleanup_never_deletes_ready_old_or_outside_instances() {
  let root = TestDirectory::new();
  let versions = root.0.join("versions");
  fs::create_dir(&versions).unwrap();
  for (name, ready) in [
    ("SAUMCL-CLMC-new", false),
    ("SAUMCL-CLMC-ready", true),
    ("player-instance", false),
  ] {
    let path = versions.join(name);
    fs::create_dir(&path).unwrap();
    fs::write(path.join(PENDING_FILE), "pending").unwrap();
    if ready {
      fs::write(path.join(READY_FILE), "receipt").unwrap();
    }
    assert_eq!(
      clean_incomplete(&versions, &path),
      name == "SAUMCL-CLMC-new"
    );
    assert_eq!(path.exists(), name != "SAUMCL-CLMC-new");
  }
  let outside = root.0.join("SAUMCL-CLMC-outside");
  fs::create_dir(&outside).unwrap();
  fs::write(outside.join(PENDING_FILE), "pending").unwrap();
  assert!(!clean_incomplete(&versions, &outside));
  assert!(outside.exists());
}

#[test]
fn preference_copy_preserves_old_data_and_pack_settings() {
  let root = TestDirectory::new();
  let old = root.0.join("old");
  let new = root.0.join("new");
  for dir in [&old, &new] {
    fs::create_dir(dir).unwrap();
  }
  fs::create_dir(old.join("saves")).unwrap();
  fs::write(old.join("saves/world"), "keep world").unwrap();
  fs::write(old.join("options.txt"), "old options").unwrap();
  fs::write(old.join("servers.dat"), "old servers").unwrap();
  fs::write(new.join("options.txt"), "pack options").unwrap();
  copy_player_preferences(&old, &new).unwrap();
  assert_eq!(
    fs::read_to_string(new.join("options.txt")).unwrap(),
    "pack options"
  );
  assert_eq!(
    fs::read_to_string(new.join("servers.dat")).unwrap(),
    "old servers"
  );
  assert_eq!(
    fs::read_to_string(old.join("saves/world")).unwrap(),
    "keep world"
  );
  assert!(!new.join("saves").exists());
}
