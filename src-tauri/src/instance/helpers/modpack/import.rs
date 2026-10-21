use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sjmcl_types::error::SJMCLResult;
use std::fs;
use std::fs::File;
use std::path::Path;
use tauri::AppHandle;
use zip::ZipArchive;

use crate::instance::helpers::modpack::modrinth::ModrinthManifest;
use crate::instance::helpers::modpack::multimc::MultiMcManifest;
use crate::instance::models::misc::{InstanceError, ModLoader, ModLoaderType};
use crate::resource::commands::fetch_mod_loader_version_list;
use crate::resource::models::OtherResourceSource;
use crate::tasks::PTaskParam;

#[async_trait]
pub trait ModpackManifest {
  fn from_archive(file: &File) -> SJMCLResult<Self>
  where
    Self: Sized;
  fn get_client_version(&self) -> SJMCLResult<String>;
  fn get_mod_loader_type_version(&self) -> SJMCLResult<(ModLoaderType, String)>;
  async fn get_meta_info(&self, app: &AppHandle) -> SJMCLResult<ModpackMetaInfo>;
  async fn get_download_params(
    &self,
    app: &AppHandle,
    instance_path: &Path,
  ) -> SJMCLResult<Vec<PTaskParam>>;
  fn get_overrides_path(&self) -> String;
}

type ManifestBox = Box<dyn ModpackManifest + Send + Sync>;
type Parser = Box<dyn Fn(&File) -> SJMCLResult<ManifestBox> + Send + Sync>;

fn get_parsers() -> Vec<Parser> {
  vec![
    Box::new(|f| {
      ModrinthManifest::from_archive(f).map(|m| {
        let b: ManifestBox = Box::new(m);
        b
      })
    }),
    Box::new(|f| {
      MultiMcManifest::from_archive(f).map(|m| {
        let b: ManifestBox = Box::new(m);
        b
      })
    }),
  ]
}

impl ModLoader {
  pub async fn with_branch(&self, app: &AppHandle, mc_version: String) -> SJMCLResult<Self> {
    let version_list =
      fetch_mod_loader_version_list(app.clone(), mc_version, self.loader_type).await?;
    if let Some(version) = version_list.iter().find(|v| v.version == self.version) {
      return Ok(Self {
        branch: version.branch.clone(),
        ..self.clone()
      });
    }
    Err(InstanceError::ModLoaderVersionParseError.into())
  }
}

#[derive(Deserialize, Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModpackMetaInfo {
  pub name: String,
  pub version: Option<String>,
  pub description: Option<String>,
  pub author: Option<String>,
  pub modpack_source: OtherResourceSource,
  pub client_version: String,
  pub mod_loader: Option<ModLoader>,
}

impl ModpackMetaInfo {
  pub async fn from_archive(app: &AppHandle, file: &File) -> SJMCLResult<Self> {
    for parser in get_parsers() {
      if let Ok(manifest) = parser(file) {
        return manifest.get_meta_info(app).await;
      }
    }

    Err(InstanceError::ModpackManifestParseError.into())
  }
}

pub async fn get_download_params(
  app: &AppHandle,
  file: &File,
  instance_path: &Path,
) -> SJMCLResult<Vec<PTaskParam>> {
  for parser in get_parsers() {
    if let Ok(manifest) = parser(file) {
      return manifest.get_download_params(app, instance_path).await;
    }
  }

  Err(InstanceError::ModpackManifestParseError.into())
}

pub fn extract_overrides(file: &File, instance_path: &Path) -> SJMCLResult<()> {
  let get_overrides_path = |file| {
    for parser in get_parsers() {
      if let Ok(manifest) = parser(file) {
        return Some(manifest.get_overrides_path());
      }
    }
    None
  };
  let overrides_path = get_overrides_path(file).ok_or(InstanceError::ModpackManifestParseError)?;
  let overrides_path = format!("{}/", overrides_path.trim_end_matches('/'));
  let mut archive = ZipArchive::new(file)?;
  for i in 0..archive.len() {
    let mut file = archive.by_index(i)?;
    let path = file.mangled_name()?;
    let outpath = if path.starts_with(&overrides_path) {
      // Remove "{overrides}/" prefix and join with instance path
      let relative_path = path.strip_prefix(&overrides_path).unwrap();
      instance_path.join(relative_path)
    } else {
      continue;
    };

    if file.is_file() {
      // Create parent directories if they don't exist
      if let Some(p) = outpath.parent()
        && !p.exists()
      {
        fs::create_dir_all(p)?;
      }

      // Extract file
      let mut outfile = File::create(&outpath)?;
      std::io::copy(&mut file, &mut outfile)?;
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use std::fs::{self, File};
  use std::io::Write;
  use uuid::Uuid;
  use zip::ZipWriter;
  use zip::write::SimpleFileOptions;

  use crate::instance::helpers::modpack::import::extract_overrides;

  #[test]
  fn extracts_multimc_game_files_from_root_and_nested_archives() {
    let root = std::env::temp_dir().join(format!("saumcl-multimc-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    for (index, prefix) in [
      "",
      "GT New Horizons 2.8.4/",
      "bundle/GT New Horizons 2.8.4/",
    ]
    .iter()
    .enumerate()
    {
      let archive_path = root.join(format!("{index}.zip"));
      let mut archive = ZipWriter::new(File::create(&archive_path).unwrap());
      let options = SimpleFileOptions::default();
      for (name, contents) in [
        (
          "mmc-pack.json",
          r#"{"formatVersion":1,"components":[{"uid":"net.minecraft","version":"1.7.10"}]}"#,
        ),
        ("instance.cfg", "InstanceType=OneSix\nname=GTNH 2.8.4\n"),
        (".minecraft/mods/example.jar", "mod contents"),
        (".minecraft/config/lwjgl3ify.cfg", "pack configuration"),
        (
          "patches/net.minecraft.json",
          "metadata outside the game directory",
        ),
      ] {
        archive
          .start_file(format!("{prefix}{name}"), options)
          .unwrap();
        archive.write_all(contents.as_bytes()).unwrap();
      }
      archive.finish().unwrap();
      let destination = root.join(format!("instance-{index}"));
      extract_overrides(&File::open(&archive_path).unwrap(), &destination).unwrap();
      assert_eq!(
        fs::read_to_string(destination.join("mods/example.jar")).unwrap(),
        "mod contents"
      );
      assert_eq!(
        fs::read_to_string(destination.join("config/lwjgl3ify.cfg")).unwrap(),
        "pack configuration"
      );
      assert!(!destination.join("patches").exists());
    }
    assert_eq!(root.parent(), Some(std::env::temp_dir().as_path()));
    fs::remove_dir_all(root).unwrap();
  }
}
