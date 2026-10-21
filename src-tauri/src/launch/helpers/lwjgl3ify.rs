use serde_json::{Value, json};
use sha1::{Digest, Sha1};
use sjmcl_types::error::{SJMCLError, SJMCLResult};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path};
use zip::ZipArchive;

use crate::instance::helpers::client_json::McClientInfo;
use crate::launch::helpers::file_validator::convert_library_name_to_path;

const RELAUNCHER_PATH: &str = "me/eigenraven/lwjgl3ify/relauncher/";
const MAIN_CLASS: &str = "com.gtnewhorizons.retrofuturabootstrap.Main";
const FORGE_PATCHES_PREFIX: &str = "com.github.GTNewHorizons:lwjgl3ify:";

/// Use the matching launch profile bundled in the active mod, including for packs
/// whose MultiMC patches were not imported. Never edit the user's version JSON.
pub fn prepare_lwjgl3ify(
  mods_dir: &Path,
  libraries_dir: &Path,
  client_info: &mut McClientInfo,
) -> SJMCLResult<bool> {
  let mut mod_paths = Vec::new();
  for directory in [mods_dir.to_path_buf(), mods_dir.join("1.7.10")] {
    if !directory.is_dir() {
      continue;
    }
    for entry in fs::read_dir(directory)? {
      let path = entry?.path();
      let name = path.file_name().unwrap_or_default().to_string_lossy();
      if path.is_file()
        && name.to_ascii_lowercase().starts_with("lwjgl3ify-")
        && path.extension().is_some_and(|ext| ext == "jar")
      {
        mod_paths.push(path);
      }
    }
  }

  let mut launch_profile = None;
  for mod_path in mod_paths {
    let mut archive = ZipArchive::new(File::open(mod_path)?)?;
    let mut profile: Value = match archive.by_name(&format!("{RELAUNCHER_PATH}version.json")) {
      Ok(file) => serde_json::from_reader(file)?,
      Err(zip::result::ZipError::FileNotFound) => continue,
      Err(error) => return Err(error.into()),
    };
    if profile["mainClass"].as_str() != Some(MAIN_CLASS) {
      continue;
    }
    if launch_profile.is_some() {
      return Err(SJMCLError(
        "Multiple active lwjgl3ify mods were found".to_string(),
      ));
    }

    let libraries = profile["libraries"]
      .as_array_mut()
      .ok_or_else(|| SJMCLError("Invalid lwjgl3ify launch profile".to_string()))?;
    let mut found_forge_patches = false;
    for library in libraries.iter_mut() {
      let name = library["name"]
        .as_str()
        .ok_or_else(|| SJMCLError("Invalid lwjgl3ify library name".to_string()))?
        .to_string();
      let fallback_path = convert_library_name_to_path(&name, None)?;
      let path = library["downloads"]["artifact"]["path"]
        .as_str()
        .filter(|path| !path.is_empty())
        .unwrap_or(&fallback_path)
        .to_string();
      if !Path::new(&path)
        .components()
        .all(|component| matches!(component, Component::Normal(_)))
      {
        return Err(SJMCLError("Invalid lwjgl3ify library path".to_string()));
      }

      let repository = library["url"]
        .as_str()
        .unwrap_or("https://libraries.minecraft.net/")
        .to_string();
      let fallback_url = url::Url::parse(&repository)?.join(&path)?.to_string();
      if !library["downloads"].is_object() {
        library["downloads"] = json!({});
      }
      if !library["downloads"]["artifact"].is_object() {
        library["downloads"]["artifact"] = json!({});
      }
      let artifact = &mut library["downloads"]["artifact"];
      artifact["path"] = json!(path);
      if artifact["url"].as_str().is_none_or(str::is_empty) {
        artifact["url"] = json!(fallback_url);
      }

      if name.starts_with(FORGE_PATCHES_PREFIX) && name.ends_with(":forgePatches") {
        let mut contents = Vec::new();
        archive
          .by_name(&format!("{RELAUNCHER_PATH}forgePatches.zip"))?
          .read_to_end(&mut contents)?;
        let expected_hash = format!("{:x}", Sha1::digest(&contents));
        let destination = libraries_dir.join(&path);
        let matches = fs::read(&destination)
          .is_ok_and(|bytes| format!("{:x}", Sha1::digest(bytes)) == expected_hash);
        if !matches {
          if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
          }
          fs::write(destination, &contents)?;
        }
        artifact["sha1"] = json!(expected_hash);
        artifact["size"] = json!(contents.len());
        found_forge_patches = true;
      }
    }
    if !found_forge_patches {
      return Err(SJMCLError("Missing lwjgl3ify Forge patches".to_string()));
    }

    // These classes must shadow Forge/ASM from every other library on the classpath.
    libraries.sort_by_key(|library| {
      !library["name"].as_str().is_some_and(|name| {
        name.starts_with(FORGE_PATCHES_PREFIX) && name.ends_with(":forgePatches")
      })
    });
    launch_profile = Some(serde_json::from_value::<McClientInfo>(profile)?);
  }

  let Some(profile) = launch_profile else {
    return Ok(false);
  };
  client_info.main_class = profile.main_class;
  client_info.arguments = profile.arguments;
  client_info.minecraft_arguments = profile.minecraft_arguments;
  client_info.libraries = profile.libraries;
  client_info.java_version = profile.java_version;
  Ok(true)
}

#[cfg(test)]
mod tests {
  use serde_json::json;
  use std::fs::{self, File};
  use std::io::Write;
  use std::path::PathBuf;
  use uuid::Uuid;
  use zip::ZipWriter;
  use zip::write::SimpleFileOptions;

  use crate::instance::helpers::client_json::{FeaturesInfo, McClientInfo};
  use crate::instance::models::misc::ModLoaderType;
  use crate::launch::helpers::file_validator::get_nonnative_library_paths;
  use crate::launch::helpers::lwjgl3ify::{MAIN_CLASS, RELAUNCHER_PATH, prepare_lwjgl3ify};

  struct TestDirectory(PathBuf);

  impl TestDirectory {
    fn new() -> Self {
      let path = std::env::temp_dir().join(format!("saumcl-lwjgl3ify-{}", Uuid::new_v4()));
      fs::create_dir_all(&path).unwrap();
      Self(path)
    }

    fn write_mod(&self, name: &str, profile: serde_json::Value) {
      let path = self.0.join("mods").join(name);
      fs::create_dir_all(path.parent().unwrap()).unwrap();
      let mut archive = ZipWriter::new(File::create(path).unwrap());
      let options = SimpleFileOptions::default();
      archive
        .start_file(format!("{RELAUNCHER_PATH}version.json"), options)
        .unwrap();
      archive.write_all(profile.to_string().as_bytes()).unwrap();
      archive
        .start_file(format!("{RELAUNCHER_PATH}forgePatches.zip"), options)
        .unwrap();
      archive
        .write_all(b"matching embedded Forge patches")
        .unwrap();
      archive.finish().unwrap();
    }
  }

  impl Drop for TestDirectory {
    fn drop(&mut self) {
      assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  fn profile() -> serde_json::Value {
    // The relevant layout in GTNH 2.8.4 / lwjgl3ify 2.1.16, with tiny test artifacts.
    json!({
      "mainClass": MAIN_CLASS,
      "javaVersion": { "majorVersion": 21, "component": "java-runtime-delta" },
      "arguments": {
        "game": ["--username", "${auth_player_name}", "--tweakClass", "cpw.mods.fml.common.launcher.FMLTweaker"],
        "jvm": [
          "-Djava.system.class.loader=com.gtnewhorizons.retrofuturabootstrap.RfbSystemClassLoader",
          "--add-opens", "java.base/java.lang=ALL-UNNAMED"
        ]
      },
      "libraries": [
        {"name": "net.minecraftforge:forge:1.7.10-10.13.4.1614-1.7.10:universal", "url": "https://maven.minecraftforge.net/"},
        {"name": "com.github.GTNewHorizons:lwjgl3ify:2.1.16:forgePatches", "url": "https://nexus.gtnewhorizons.com/repository/public/"},
        {"name": "org.lwjgl:lwjgl:3.3.3", "downloads": {"artifact": {
          "path": "org/lwjgl/lwjgl/3.3.3/custom-lwjgl.jar",
          "url": "https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar",
          "sha1": "test-checksum", "size": 123
        }}},
        {"name": "org.lwjgl:lwjgl-natives-windows:3.3.3", "downloads": {"artifact": {
          "url": "https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar"
        }}, "rules": [{"action": "allow", "os": {"name": "windows"}}]},
        {"name": "com.google.guava:guava:17.0"}
      ]
    })
  }

  #[test]
  fn prepares_matching_profile_and_early_classpath_without_changing_instance_identity() {
    let directory = TestDirectory::new();
    directory.write_mod("lwjgl3ify-2.1.16.jar", profile());
    let libraries_dir = directory.0.join("libraries");
    let mut client = McClientInfo {
      id: "川农 GTNH 2.8.4".to_string(),
      jar: Some("original-client".to_string()),
      main_class: Some("net.minecraft.launchwrapper.Launch".to_string()),
      minecraft_arguments: Some("old arguments".to_string()),
      ..Default::default()
    };
    assert!(prepare_lwjgl3ify(&directory.0.join("mods"), &libraries_dir, &mut client).unwrap());
    assert_eq!(client.id, "川农 GTNH 2.8.4");
    assert_eq!(client.jar.as_deref(), Some("original-client"));
    assert_eq!(client.main_class.as_deref(), Some(MAIN_CLASS));
    assert!(client.minecraft_arguments.is_none());
    assert_eq!(client.java_version.as_ref().unwrap().major_version, 21);
    let arguments = client.arguments.as_ref().unwrap();
    assert!(
      arguments
        .to_jvm_arguments(&FeaturesInfo::default())
        .unwrap()
        .contains(
          &"-Djava.system.class.loader=com.gtnewhorizons.retrofuturabootstrap.RfbSystemClassLoader"
            .to_string()
        )
    );
    assert!(
      arguments
        .to_game_arguments(&FeaturesInfo::default())
        .unwrap()
        .contains(&"cpw.mods.fml.common.launcher.FMLTweaker".to_string())
    );

    for _ in 0..20 {
      let classpath =
        get_nonnative_library_paths(&client, &libraries_dir, ModLoaderType::Forge).unwrap();
      assert!(classpath[0].ends_with("lwjgl3ify-2.1.16-forgePatches.jar"));
      assert!(
        classpath
          .iter()
          .any(|path| path.ends_with("custom-lwjgl.jar"))
      );
      assert!(
        !classpath
          .iter()
          .any(|path| path.to_string_lossy().contains("launchwrapper"))
      );
    }
    let patches = client.libraries[0]
      .downloads
      .as_ref()
      .unwrap()
      .artifact
      .as_ref()
      .unwrap();
    assert_eq!(patches.sha1.len(), 40);
    assert_eq!(
      fs::read(libraries_dir.join(&patches.path)).unwrap(),
      b"matching embedded Forge patches"
    );
    let forge = client.libraries[1]
      .downloads
      .as_ref()
      .unwrap()
      .artifact
      .as_ref()
      .unwrap();
    assert_eq!(
      forge.url,
      "https://maven.minecraftforge.net/net/minecraftforge/forge/1.7.10-10.13.4.1614-1.7.10/forge-1.7.10-10.13.4.1614-1.7.10-universal.jar"
    );
    assert_eq!(
      client.libraries[2]
        .downloads
        .as_ref()
        .unwrap()
        .artifact
        .as_ref()
        .unwrap()
        .sha1,
      "test-checksum"
    );
  }

  #[test]
  fn repairs_corrupt_embedded_patches_and_can_prepare_again() {
    let directory = TestDirectory::new();
    directory.write_mod("1.7.10/lwjgl3ify-2.1.16.jar", profile());
    let libraries_dir = directory.0.join("libraries");
    let mut client = McClientInfo::default();
    prepare_lwjgl3ify(&directory.0.join("mods"), &libraries_dir, &mut client).unwrap();
    let patches = client.libraries[0]
      .downloads
      .as_ref()
      .unwrap()
      .artifact
      .as_ref()
      .unwrap()
      .path
      .clone();
    fs::write(libraries_dir.join(&patches), "corrupted").unwrap();
    prepare_lwjgl3ify(&directory.0.join("mods"), &libraries_dir, &mut client).unwrap();
    assert_eq!(
      fs::read(libraries_dir.join(patches)).unwrap(),
      b"matching embedded Forge patches"
    );
    assert_eq!(client.libraries.len(), 5);
  }

  #[test]
  fn ignores_missing_or_disabled_mods_and_leaves_other_instances_unchanged() {
    let directory = TestDirectory::new();
    let mut client = McClientInfo {
      id: "ordinary Forge".to_string(),
      ..Default::default()
    };
    assert!(
      !prepare_lwjgl3ify(
        &directory.0.join("mods"),
        &directory.0.join("libraries"),
        &mut client
      )
      .unwrap()
    );
    directory.write_mod("lwjgl3ify-2.1.16.jar.disabled", profile());
    assert!(
      !prepare_lwjgl3ify(
        &directory.0.join("mods"),
        &directory.0.join("libraries"),
        &mut client
      )
      .unwrap()
    );
    assert_eq!(client.id, "ordinary Forge");
    assert!(client.main_class.is_none());
    assert!(!directory.0.join("libraries").exists());
  }

  #[test]
  fn rejects_profiles_that_escape_the_library_directory() {
    let directory = TestDirectory::new();
    let mut invalid = profile();
    invalid["libraries"][0]["downloads"] = json!({"artifact": {"path": "../escaped.jar"}});
    directory.write_mod("lwjgl3ify-2.1.16.jar", invalid);
    assert!(
      prepare_lwjgl3ify(
        &directory.0.join("mods"),
        &directory.0.join("libraries"),
        &mut McClientInfo::default()
      )
      .is_err()
    );
    assert!(!directory.0.join("escaped.jar").exists());
  }
}
