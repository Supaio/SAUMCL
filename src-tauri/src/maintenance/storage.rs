use serde::{Deserialize, Serialize};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use url::Url;
use uuid::Uuid;

use crate::maintenance::auth::{
  MAX_KEY_BYTES, MaintainerIdentity, MaintenanceError, TrustedKey, verify_key,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceStatus {
  pub configured: bool,
  pub account_uuid: Option<Uuid>,
  pub identity: Option<MaintainerIdentity>,
  pub invalid_saved_key: bool,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CampusLoader {
  #[default]
  None,
  Fabric,
  Forge,
  Neoforge,
  Quilt,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CampusRoundState {
  #[default]
  Auto,
  Active,
  Ended,
}

fn default_next_round() -> Option<u32> {
  Some(20)
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CampusDraft {
  pub schema_version: u32,
  pub server_name: String,
  pub server_address: String,
  pub minecraft_version: String,
  pub loader: CampusLoader,
  pub loader_version: String,
  pub modpack_version: String,
  pub modpack_url: String,
  #[serde(default)]
  pub modpack_sha256: String,
  pub announcement: String,
  pub maintenance: bool,
  #[serde(default)]
  pub current_round: Option<u32>,
  #[serde(default = "default_next_round")]
  pub next_round: Option<u32>,
  #[serde(default)]
  pub round_state: CampusRoundState,
  #[serde(default)]
  pub offline_since: Option<String>,
}

impl Default for CampusDraft {
  fn default() -> Self {
    Self {
      schema_version: 1,
      server_name: "四川农业大学川泷MC服".to_string(),
      server_address: String::new(),
      minecraft_version: String::new(),
      loader: CampusLoader::None,
      loader_version: String::new(),
      modpack_version: String::new(),
      modpack_url: String::new(),
      modpack_sha256: String::new(),
      announcement: String::new(),
      maintenance: true,
      current_round: None,
      next_round: default_next_round(),
      round_state: CampusRoundState::Auto,
      offline_since: None,
    }
  }
}

impl CampusDraft {
  pub fn validate(&self) -> Result<(), MaintenanceError> {
    if self.schema_version != 1
      || self.server_name.chars().count() > 120
      || self.server_address.len() > 255
      || self.server_address.chars().any(char::is_whitespace)
      || (!self.server_address.is_empty()
        && self
          .server_address
          .parse::<lite_mc_ping::ServerAddress>()
          .is_err())
      || self.minecraft_version.len() > 64
      || self.loader_version.len() > 64
      || self.modpack_version.len() > 64
      || self.modpack_url.len() > 2048
      || (!self.modpack_sha256.is_empty()
        && (self.modpack_sha256.len() != 64
          || !self
            .modpack_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())))
      || self.announcement.chars().count() > 4000
      || self
        .current_round
        .is_some_and(|round| round == 0 || round > 9999)
      || self
        .next_round
        .is_some_and(|round| round == 0 || round > 9999)
      || self
        .offline_since
        .as_ref()
        .is_some_and(|date| chrono::DateTime::parse_from_rfc3339(date).is_err())
    {
      return Err(MaintenanceError::InvalidDraft);
    }
    if !self.modpack_url.is_empty() {
      let url = Url::parse(&self.modpack_url).map_err(|_| MaintenanceError::InvalidDraft)?;
      if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
      {
        return Err(MaintenanceError::InvalidDraft);
      }
    }
    Ok(())
  }
}

pub struct MaintenanceStore {
  pub(super) directory: PathBuf,
  pub(super) account_uuid: Option<Uuid>,
  trusted_keys: Vec<TrustedKey>,
}

impl MaintenanceStore {
  pub fn new(
    directory: PathBuf,
    trusted_keys: Vec<TrustedKey>,
    account_uuid: Option<Uuid>,
  ) -> Self {
    Self {
      directory,
      account_uuid,
      trusted_keys,
    }
  }

  fn key_path(&self) -> Result<PathBuf, MaintenanceError> {
    let uuid = self
      .account_uuid
      .ok_or(MaintenanceError::MicrosoftAccountRequired)?;
    Ok(
      self
        .directory
        .join("authorizations")
        .join(format!("{uuid}.saumclkey")),
    )
  }

  fn verify_for_account(&self, key: &str) -> Result<MaintainerIdentity, MaintenanceError> {
    let identity = verify_key(key, &self.trusted_keys)?;
    if Some(identity.account_uuid) != self.account_uuid {
      return Err(MaintenanceError::KeyAccountMismatch);
    }
    Ok(identity)
  }

  pub fn status(&self) -> Result<MaintenanceStatus, MaintenanceError> {
    let mut status = MaintenanceStatus {
      configured: !self.trusted_keys.is_empty(),
      account_uuid: self.account_uuid,
      invalid_saved_key: false,
      identity: None,
    };
    let Ok(path) = self.key_path() else {
      return Ok(status);
    };
    if let Ok(metadata) = fs::metadata(&path)
      && metadata.len() > MAX_KEY_BYTES as u64
    {
      status.invalid_saved_key = true;
      return Ok(status);
    }
    let saved = match fs::read_to_string(path) {
      Ok(key) => Some(key),
      Err(error) if error.kind() == ErrorKind::NotFound => None,
      Err(error) if error.kind() == ErrorKind::InvalidData => Some(String::new()),
      Err(_) => return Err(MaintenanceError::StorageFailed),
    };
    status.identity = saved
      .as_deref()
      .and_then(|key| self.verify_for_account(key).ok());
    status.invalid_saved_key = saved.is_some() && status.identity.is_none();
    Ok(status)
  }

  pub fn activate(&self, key: &str) -> Result<MaintainerIdentity, MaintenanceError> {
    let path = self.key_path()?;
    let identity = self.verify_for_account(key)?;
    let parent = self.directory.join("authorizations");
    fs::create_dir_all(&parent).map_err(|_| MaintenanceError::StorageFailed)?;
    let temporary = parent.join(format!("{}.tmp", Uuid::new_v4()));
    if fs::write(&temporary, key.trim())
      .and_then(|_| fs::rename(&temporary, path))
      .is_err()
    {
      let _ = fs::remove_file(temporary);
      return Err(MaintenanceError::StorageFailed);
    }
    Ok(identity)
  }

  pub fn activate_file(&self, path: &Path) -> Result<MaintainerIdentity, MaintenanceError> {
    if fs::metadata(path)
      .map_err(|_| MaintenanceError::StorageFailed)?
      .len()
      > MAX_KEY_BYTES as u64
    {
      return Err(MaintenanceError::InvalidKey);
    }
    let key = fs::read_to_string(path).map_err(|_| MaintenanceError::StorageFailed)?;
    self.activate(&key)
  }

  pub fn deactivate(&self) -> Result<(), MaintenanceError> {
    match fs::remove_file(self.key_path()?) {
      Ok(()) => Ok(()),
      Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
      Err(_) => Err(MaintenanceError::StorageFailed),
    }
  }

  pub(super) fn require_authorization(&self) -> Result<(), MaintenanceError> {
    if self.status()?.identity.is_none() {
      return Err(MaintenanceError::Unauthorized);
    }
    Ok(())
  }

  pub fn load_draft(&self) -> Result<CampusDraft, MaintenanceError> {
    self.require_authorization()?;
    let text = match fs::read_to_string(self.directory.join("campus-draft.json")) {
      Ok(text) => text,
      Err(error) if error.kind() == ErrorKind::NotFound => return Ok(CampusDraft::default()),
      Err(_) => return Err(MaintenanceError::StorageFailed),
    };
    let draft: CampusDraft =
      serde_json::from_str(&text).map_err(|_| MaintenanceError::InvalidDraft)?;
    draft.validate()?;
    Ok(draft)
  }

  pub fn save_draft(&self, draft: &CampusDraft) -> Result<(), MaintenanceError> {
    self.require_authorization()?;
    draft.validate()?;
    let text = serde_json::to_string_pretty(draft).map_err(|_| MaintenanceError::InvalidDraft)?;
    fs::create_dir_all(&self.directory).map_err(|_| MaintenanceError::StorageFailed)?;
    fs::write(self.directory.join("campus-draft.json"), text)
      .map_err(|_| MaintenanceError::StorageFailed)
  }

  pub fn export_draft(&self, draft: &CampusDraft, path: &Path) -> Result<(), MaintenanceError> {
    self.require_authorization()?;
    draft.validate()?;
    if !path
      .extension()
      .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
      || path == self.directory.join("campus-draft.json")
    {
      return Err(MaintenanceError::InvalidDraft);
    }
    let text = serde_json::to_string_pretty(draft).map_err(|_| MaintenanceError::InvalidDraft)?;
    fs::write(path, text).map_err(|_| MaintenanceError::StorageFailed)
  }

  pub fn apply_preview(&self, draft: &CampusDraft) -> Result<(), MaintenanceError> {
    self.require_authorization()?;
    draft.validate()?;
    let text = serde_json::to_string_pretty(draft).map_err(|_| MaintenanceError::InvalidDraft)?;
    fs::create_dir_all(&self.directory).map_err(|_| MaintenanceError::StorageFailed)?;
    fs::write(self.directory.join("campus-preview.json"), text)
      .map_err(|_| MaintenanceError::StorageFailed)
  }

  pub fn load_preview(&self) -> Result<Option<CampusDraft>, MaintenanceError> {
    if self.status()?.identity.is_none() {
      return Ok(None);
    }
    let text = match fs::read_to_string(self.directory.join("campus-preview.json")) {
      Ok(text) => text,
      Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
      Err(_) => return Err(MaintenanceError::StorageFailed),
    };
    let draft: CampusDraft =
      serde_json::from_str(&text).map_err(|_| MaintenanceError::InvalidDraft)?;
    draft.validate()?;
    Ok(Some(draft))
  }
}

#[cfg(test)]
mod tests {
  use std::fs;

  use crate::maintenance::auth::MaintenanceError;
  use crate::maintenance::auth::tests::{account_uuid, trusted_keys, valid_key};
  use crate::maintenance::storage::{CampusDraft, MaintenanceStore};

  #[test]
  fn authorization_survives_restart_and_draft_changes_but_local_exit_locks_again() {
    let directory =
      std::env::temp_dir().join(format!("saumcl-maintenance-{}", uuid::Uuid::new_v4()));
    let store = MaintenanceStore::new(directory.clone(), trusted_keys(), Some(account_uuid()));
    assert!(matches!(
      store.load_draft(),
      Err(MaintenanceError::Unauthorized)
    ));
    assert!(matches!(
      store.save_draft(&CampusDraft::default()),
      Err(MaintenanceError::Unauthorized)
    ));
    assert!(store.activate("invalid").is_err());
    assert!(!directory.exists());
    let key = valid_key();
    store.activate(&key).unwrap();
    let restarted = MaintenanceStore::new(directory.clone(), trusted_keys(), Some(account_uuid()));
    assert!(restarted.status().unwrap().identity.is_some());
    let mut draft = restarted.load_draft().unwrap();
    draft.minecraft_version = "1.7.10".to_string();
    draft.modpack_version = "next-pack".to_string();
    restarted.save_draft(&draft).unwrap();
    assert_eq!(draft.next_round, Some(20));
    restarted.apply_preview(&draft).unwrap();
    assert_eq!(
      restarted.load_preview().unwrap().unwrap().modpack_version,
      "next-pack"
    );
    assert!(matches!(
      restarted.export_draft(&draft, &restarted.key_path().unwrap()),
      Err(MaintenanceError::InvalidDraft)
    ));
    let export = directory.join("export.json");
    restarted.export_draft(&draft, &export).unwrap();
    let exported = fs::read_to_string(&export).unwrap();
    assert!(!exported.contains("SAUMCL-MAINT-1"));
    assert!(!exported.contains("authorization"));
    restarted.deactivate().unwrap();
    assert!(restarted.status().unwrap().identity.is_none());
    assert!(restarted.load_preview().unwrap().is_none());
    assert!(matches!(
      restarted.apply_preview(&draft),
      Err(MaintenanceError::Unauthorized)
    ));
    assert!(matches!(
      restarted.export_draft(&draft, &export),
      Err(MaintenanceError::Unauthorized)
    ));
    restarted.activate(&key).unwrap();
    assert_eq!(restarted.load_draft().unwrap().modpack_version, "next-pack");
    fs::remove_dir_all(&directory).unwrap();
  }

  #[test]
  fn switching_accounts_hides_maintenance_and_forwarded_keys_cannot_unlock_it() {
    let directory =
      std::env::temp_dir().join(format!("saumcl-maintenance-{}", uuid::Uuid::new_v4()));
    let maintainer = MaintenanceStore::new(directory.clone(), trusted_keys(), Some(account_uuid()));
    let player = MaintenanceStore::new(
      directory.clone(),
      trusted_keys(),
      Some(uuid::Uuid::new_v4()),
    );
    let signed_out = MaintenanceStore::new(directory.clone(), trusted_keys(), None);
    let key = valid_key();
    assert!(matches!(
      signed_out.activate(&key),
      Err(MaintenanceError::MicrosoftAccountRequired)
    ));
    assert!(matches!(
      player.activate(&key),
      Err(MaintenanceError::KeyAccountMismatch)
    ));
    assert!(!directory.exists());
    maintainer.activate(&key).unwrap();
    maintainer.apply_preview(&CampusDraft::default()).unwrap();
    fs::copy(maintainer.key_path().unwrap(), player.key_path().unwrap()).unwrap();
    assert!(player.status().unwrap().invalid_saved_key);
    assert!(player.load_preview().unwrap().is_none());
    assert!(signed_out.load_preview().unwrap().is_none());
    assert!(matches!(
      player.load_draft(),
      Err(MaintenanceError::Unauthorized)
    ));
    player.deactivate().unwrap();
    assert!(maintainer.status().unwrap().identity.is_some());
    assert!(maintainer.load_preview().unwrap().is_some());
    fs::remove_dir_all(&directory).unwrap();
  }

  #[test]
  fn tampering_with_saved_grant_locks_all_maintenance_operations() {
    let directory =
      std::env::temp_dir().join(format!("saumcl-maintenance-{}", uuid::Uuid::new_v4()));
    let store = MaintenanceStore::new(directory.clone(), trusted_keys(), Some(account_uuid()));
    store.activate(&valid_key()).unwrap();
    let path = store.key_path().unwrap();
    fs::write(&path, "invalid").unwrap();
    assert!(store.status().unwrap().invalid_saved_key);
    assert!(matches!(
      store.load_draft(),
      Err(MaintenanceError::Unauthorized)
    ));
    fs::write(
      &path,
      vec![b'x'; crate::maintenance::auth::MAX_KEY_BYTES + 1],
    )
    .unwrap();
    assert!(store.status().unwrap().invalid_saved_key);
    fs::write(&path, [0xff]).unwrap();
    assert!(store.status().unwrap().invalid_saved_key);
    fs::remove_dir_all(&directory).unwrap();
  }

  #[test]
  fn draft_rejects_executable_urls_credentials_and_oversized_notices() {
    let mut draft = CampusDraft::default();
    assert!(draft.validate().is_ok());
    for url in [
      "javascript:alert(1)",
      "file:///pack.zip",
      "https://user@example.invalid/pack",
    ] {
      draft.modpack_url = url.to_string();
      assert!(draft.validate().is_err());
    }
    draft.modpack_url = "https://example.invalid/pack.zip".to_string();
    assert!(draft.validate().is_ok());
    draft.announcement = "牛".repeat(4001);
    assert!(draft.validate().is_err());
  }
}
