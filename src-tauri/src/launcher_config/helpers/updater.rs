use serde_json::Value;
use sjmcl_types::error::{SJMCLError, SJMCLResult};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tauri_plugin_http::reqwest;

use crate::launcher_config::models::{BuildType, LauncherConfig, LauncherConfigError};
use crate::tasks::PTaskParam;
use crate::tasks::commands::schedule_progressive_task_group;
use crate::tasks::download::DownloadParam;

const RELEASES_ENDPOINT: &str = "https://api.github.com/repos/Supaio/SAUMCL/releases?per_page=100";

pub fn supports_launcher_updates(build_type: &BuildType, version: &str) -> bool {
  (build_type == &BuildType::Release
    || (build_type == &BuildType::TestBuild && version.ends_with("-indev")))
    && semver::Version::parse(version).is_ok()
}

fn release_version(release: &Value) -> Option<semver::Version> {
  let tag = release.get("tag_name")?.as_str()?;
  let version = match tag.strip_prefix("indev-") {
    Some(number) => format!("{number}-indev"),
    None => tag.strip_prefix('v').unwrap_or(tag).to_string(),
  };
  semver::Version::parse(&version).ok()
}

// Generate the new version filename on remote origin according to the current os, arch and is_portable
fn build_resource_filename(ver: &str, os: &str, arch: &str, is_portable: bool) -> String {
  let arch = if arch == "x86" { "i686" } else { arch };
  let suffix = match os {
    "windows" => {
      if is_portable {
        "_portable.exe"
      } else {
        "_setup.exe"
      }
    }
    "linux" => "_portable",
    "macos" => ".app.tar.gz",
    _ => "",
  };
  format!("SAUMCL_{}_{}_{}{}", ver, os, arch, suffix)
}

fn release_asset<'a>(
  release: &'a Value,
  version: &semver::Version,
  os: &str,
  arch: &str,
  is_portable: bool,
) -> Option<&'a Value> {
  let legacy_name = build_resource_filename(&version.to_string(), os, arch, is_portable);
  let portable_name = match (os, arch, is_portable) {
    ("windows", "x86_64", true) => Some("SAUMCL.exe"),
    ("linux", "x86_64", _) => Some("SAUMCL"),
    _ => None,
  };
  release.get("assets")?.as_array()?.iter().find(|asset| {
    let name = asset.get("name").and_then(Value::as_str);
    let url = asset
      .get("browser_download_url")
      .and_then(Value::as_str)
      .and_then(|value| url::Url::parse(value).ok());
    (name == Some(legacy_name.as_str()) || portable_name.is_some_and(|value| name == Some(value)))
      && asset.get("state").and_then(Value::as_str) == Some("uploaded")
      && asset.get("size").and_then(Value::as_u64).unwrap_or(0) > 0
      && url.is_some_and(|url| {
        url.scheme() == "https"
          && url.host_str() == Some("github.com")
          && url.path().starts_with("/Supaio/SAUMCL/releases/download/")
      })
  })
}

fn select_release<'a>(
  releases: &'a Value,
  current: &semver::Version,
  os: &str,
  arch: &str,
  is_portable: bool,
) -> Option<(&'a Value, semver::Version, &'a Value)> {
  releases
    .as_array()?
    .iter()
    .filter(|release| release.get("draft").and_then(Value::as_bool) != Some(true))
    .filter_map(|release| {
      let version = release_version(release)?;
      if current.pre.is_empty()
        && (!version.pre.is_empty()
          || release.get("prerelease").and_then(Value::as_bool) == Some(true))
      {
        return None;
      }
      let asset = release_asset(release, &version, os, arch, is_portable)?;
      Some((release, version, asset))
    })
    .max_by(|(_, left, _), (_, right, _)| left.cmp(right))
}

async fn fetch_releases(client: &reqwest::Client) -> SJMCLResult<Value> {
  let releases = client
    .get(RELEASES_ENDPOINT)
    .header("Accept", "application/vnd.github+json")
    .header("User-Agent", "SAUMCL")
    .send()
    .await
    .map_err(|_| LauncherConfigError::FetchError)?
    .error_for_status()
    .map_err(|_| LauncherConfigError::FetchError)?
    .json::<Value>()
    .await
    .map_err(|_| LauncherConfigError::FetchError)?;
  if !releases.is_array() {
    return Err(LauncherConfigError::FetchError.into());
  }
  Ok(releases)
}

// Generate the new filename on the local disk.
// If old_name contains old_version, replace the first occurrence with new_version.
// Otherwise, keep the old_name unchanged.
fn build_local_new_filename(old_name: &str, old_version: &str, new_version: &str) -> String {
  if let Some(idx) = old_name.find(old_version) {
    let mut s = String::with_capacity(old_name.len() - old_version.len() + new_version.len());
    s.push_str(&old_name[..idx]);
    s.push_str(new_version);
    s.push_str(&old_name[idx + old_version.len()..]);
    s
  } else {
    old_name.to_string()
  }
}

pub async fn fetch_latest_version(
  app: &AppHandle,
) -> SJMCLResult<Option<(String, String, String, String)>> {
  let config_binding = app.state::<Mutex<LauncherConfig>>();
  let (current_version, os, arch, is_portable) = {
    let config_state = config_binding.lock()?;
    (
      config_state.basic_info.launcher_version.clone(),
      config_state.basic_info.os_type.clone(),
      config_state.basic_info.arch.clone(),
      config_state.basic_info.is_portable,
    )
  };
  let client = app.state::<reqwest::Client>();
  let current =
    semver::Version::parse(&current_version).map_err(|_| LauncherConfigError::FetchError)?;
  let releases = fetch_releases(&client).await?;
  Ok(
    select_release(&releases, &current, &os, &arch, is_portable).map(
      |(release, version, asset)| {
        (
          version.to_string(),
          asset["name"].as_str().unwrap().to_string(),
          release["body"].as_str().unwrap_or_default().to_string(),
          release["published_at"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        )
      },
    ),
  )
}

pub async fn download_target_version(
  app: &AppHandle,
  version: String,
  fname: String,
) -> SJMCLResult<()> {
  let config_binding = app.state::<Mutex<LauncherConfig>>();
  let (download_cache_dir, os, arch, is_portable) = {
    let config_state = config_binding.lock()?;
    (
      config_state.download.cache.directory.clone(),
      config_state.basic_info.os_type.clone(),
      config_state.basic_info.arch.clone(),
      config_state.basic_info.is_portable,
    )
  };

  let client = app.state::<reqwest::Client>();

  let wanted = semver::Version::parse(&version).map_err(|_| LauncherConfigError::FetchError)?;
  let releases = fetch_releases(&client).await?;
  let asset = releases
    .as_array()
    .unwrap()
    .iter()
    .filter(|release| release.get("draft").and_then(Value::as_bool) != Some(true))
    .filter(|release| release_version(release).as_ref() == Some(&wanted))
    .filter_map(|release| release_asset(release, &wanted, &os, &arch, is_portable))
    .find(|asset| asset["name"].as_str() == Some(fname.as_str()))
    .ok_or(LauncherConfigError::FetchError)?;
  let url = asset["browser_download_url"].as_str().unwrap();
  schedule_progressive_task_group(
    app.clone(),
    format!("launcher-update?{}", fname),
    vec![PTaskParam::Download(DownloadParam {
      src: url::Url::parse(url).map_err(|_| LauncherConfigError::FetchError)?,
      dest: download_cache_dir.join(&fname),
      filename: Some(fname),
      sha1: None,
    })],
    true,
  )
  .await?;
  Ok(())
}

#[cfg(target_os = "windows")]
pub async fn install_update_windows(
  app: &AppHandle,
  downloaded_filename: String,
  restart: bool,
) -> SJMCLResult<()> {
  use std::os::windows::process::CommandExt;

  let config_binding = app.state::<Mutex<LauncherConfig>>();
  let (old_version, downloaded_path, new_version, is_portable) = {
    let config_state = config_binding.lock()?;
    (
      config_state.basic_info.launcher_version.clone(),
      config_state
        .download
        .cache
        .directory
        .join(&downloaded_filename),
      downloaded_filename
        .split('_')
        .nth(1)
        .map(|s| s.to_string())
        .unwrap_or_else(|| config_state.basic_info.launcher_version.clone()),
      config_state.basic_info.is_portable,
    )
  };
  let cur_exe = std::env::current_exe()?;

  if is_portable {
    // Portable: replace current exe with the newly downloaded one via a temp cmd script.
    let cur_dir = cur_exe
      .parent()
      .ok_or_else(|| SJMCLError("No parent dir for exe".to_string()))?;
    let old_name = cur_exe
      .file_name()
      .and_then(|s| s.to_str())
      .ok_or_else(|| SJMCLError("Invalid exe name".to_string()))?
      .to_string();

    let target_name = build_local_new_filename(&old_name, &old_version, &new_version);
    let target = cur_dir.join(target_name);
    let pid = std::process::id().to_string();
    let restart_flag = if restart { "1" } else { "0" };

    // write and execute a PowerShell script to wait -> replace -> start -> cleanup
    let script_path = app
      .path()
      .resolve::<PathBuf>("update.ps1".into(), BaseDirectory::AppCache)?;
    let script_content = r#"param(
  [string]$ProcessId,
  [string]$Downloaded,
  [string]$Target,
  [string]$OldExe,
  [string]$Restart
)

try {
  while (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
    Start-Sleep -Milliseconds 200
  }

  if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $OldExe) { Remove-Item -LiteralPath $OldExe -Force -ErrorAction SilentlyContinue }

  Move-Item -LiteralPath $Downloaded -Destination $Target -Force

  if ($Restart -eq '1') {
    Start-Process -FilePath $Target
  }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
"#;

    fs::write(&script_path, script_content.as_bytes())?;
    let _ = Command::new("powershell.exe")
      .arg("-NoProfile")
      .arg("-ExecutionPolicy")
      .arg("Bypass")
      .arg("-File")
      .arg(&script_path)
      .arg(&pid)
      .arg(&downloaded_path)
      .arg(&target)
      .arg(&cur_exe)
      .arg(restart_flag)
      .creation_flags(0x08000000)
      .spawn()?;

    if restart {
      app.exit(0);
    }
    Ok(())
  } else {
    // Installed (NSIS): run the downloaded installer directly.
    if restart {
      let _ = Command::new(&downloaded_path)
        .args(["/UPDATE", "/P"])
        .creation_flags(0x08000000)
        .spawn()?;
      app.exit(0);
    }
    Ok(())
  }
}

#[cfg(target_os = "macos")]
pub async fn install_update_macos(
  app: &AppHandle,
  downloaded_filename: String,
  restart: bool,
) -> SJMCLResult<()> {
  use std::ffi::OsStr;

  let config_binding = app.state::<Mutex<LauncherConfig>>();
  let (old_version, downloaded_path, new_version) = {
    let config_state = config_binding.lock()?;
    (
      config_state.basic_info.launcher_version.clone(),
      config_state
        .download
        .cache
        .directory
        .join(&downloaded_filename),
      downloaded_filename
        .clone()
        .split('_')
        .nth(1)
        .map(|s| s.to_string())
        .unwrap_or_else(|| config_state.basic_info.launcher_version.clone()),
    )
  };
  let cur_exe = std::env::current_exe()?;

  // find app bundle folder by walking up from executable
  let app_bundle = cur_exe
    .ancestors()
    .find(|p| p.extension().and_then(OsStr::to_str) == Some("app"))
    .ok_or_else(|| SJMCLError("Not inside .app bundle".to_string()))?
    .to_path_buf();
  let app_dir = app_bundle
    .parent()
    .ok_or_else(|| SJMCLError("No parent dir for .app".to_string()))?
    .to_path_buf();
  let old_name = app_bundle
    .file_name()
    .and_then(|s| s.to_str())
    .ok_or_else(|| SJMCLError("Invalid .app name".to_string()))?
    .to_string();

  let target_name = build_local_new_filename(&old_name, &old_version, &new_version);
  let target_app = app_dir.join(target_name);
  let pid = std::process::id().to_string();
  let restart_flag = if restart { "1" } else { "0" };

  // write and execute a bash script to wait -> replace -> start -> cleanup
  let script_path = app
    .path()
    .resolve::<PathBuf>("update.sh".to_string().into(), BaseDirectory::AppCache)?;

  let script_content = r#"#!/bin/bash
set -e
PID="$1"
DOWNLOADED="$2"
TARGET_APP="$3"
OLD_APP="$4"
RESTART="$5"

# wait until current process exits
while kill -0 $PID 2>/dev/null; do sleep 0.2; done

TMPDIR="$(mktemp -d)"
tar -xzf "$DOWNLOADED" -C "$TMPDIR"
NEW_APP="$(find "$TMPDIR" -maxdepth 1 -name "*.app" | head -n 1)"
if [ -z "$NEW_APP" ]; then
  echo "No .app found in archive" >&2
  exit 1
fi

rm -rf "$TARGET_APP" || true
rm -rf "$OLD_APP" || true
mv "$NEW_APP" "$TARGET_APP"

if [ "$RESTART" = "1" ]; then
  open -a "$TARGET_APP"
fi

rm -rf "$TMPDIR" || true
"#;

  fs::write(&script_path, script_content.as_bytes())?;
  let _ = Command::new("chmod").arg("+x").arg(&script_path).status();
  let _ = Command::new("bash")
    .arg(&script_path)
    .arg(&pid)
    .arg(&downloaded_path)
    .arg(&target_app)
    .arg(&app_bundle)
    .arg(restart_flag)
    .spawn()?;

  if restart {
    app.exit(0);
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use serde_json::{Value, json};

  use crate::launcher_config::helpers::updater::{
    build_local_new_filename, build_resource_filename, release_asset, release_version,
    select_release, supports_launcher_updates,
  };
  use crate::launcher_config::models::BuildType;

  fn release(tag: &str, prerelease: bool, filename: &str) -> Value {
    json!({
      "tag_name": tag,
      "prerelease": prerelease,
      "draft": false,
      "assets": [{
        "name": filename,
        "state": "uploaded",
        "size": 1024,
        "browser_download_url": format!(
          "https://github.com/Supaio/SAUMCL/releases/download/{tag}/{filename}"
        )
      }]
    })
  }

  #[test]
  fn indev_builds_can_check_updates_without_enabling_other_test_builds() {
    assert!(supports_launcher_updates(
      &BuildType::TestBuild,
      "19.0.1-indev"
    ));
    assert!(supports_launcher_updates(&BuildType::Release, "19.0.1"));
    for build_type in [BuildType::Dev, BuildType::Nightly, BuildType::Beta] {
      assert!(!supports_launcher_updates(&build_type, "19.0.1-indev"));
    }
    assert!(!supports_launcher_updates(&BuildType::TestBuild, "0.0.1"));
    assert!(!supports_launcher_updates(&BuildType::Release, "invalid"));
  }

  #[test]
  fn github_tags_resolve_to_comparable_versions() {
    for tag in ["indev-19.0.1", "v19.0.1-indev", "19.0.1-indev"] {
      assert_eq!(
        release_version(&release(tag, true, "SAUMCL.exe"))
          .unwrap()
          .to_string(),
        "19.0.1-indev"
      );
    }
    assert!(release_version(&release("nightly", true, "SAUMCL.exe")).is_none());
  }

  #[test]
  fn indev_updates_use_semantic_order_and_skip_unavailable_releases() {
    let mut draft = release("indev-99.0.0", true, "SAUMCL.exe");
    draft["draft"] = json!(true);
    let mut uploading = release("indev-98.0.0", true, "SAUMCL.exe");
    uploading["assets"][0]["state"] = json!("new");
    let releases = json!([
      release("indev-19.0.2", true, "SAUMCL.exe"),
      draft,
      uploading,
      release("indev-19.0.10", true, "SAUMCL.exe"),
      release("indev-20.0.0", true, "SHA256SUMS.txt")
    ]);
    let current = semver::Version::parse("19.0.1-indev").unwrap();
    let (_, version, asset) =
      select_release(&releases, &current, "windows", "x86_64", true).unwrap();
    assert_eq!(version.to_string(), "19.0.10-indev");
    assert_eq!(asset["name"], "SAUMCL.exe");
    assert_eq!(
      asset["browser_download_url"],
      "https://github.com/Supaio/SAUMCL/releases/download/indev-19.0.10/SAUMCL.exe"
    );
  }

  #[test]
  fn stable_clients_skip_prereleases() {
    let releases = json!([
      release("indev-20.0.0", true, "SAUMCL.exe"),
      release("v19.0.2", false, "SAUMCL.exe")
    ]);
    let current = semver::Version::parse("19.0.1").unwrap();
    let (_, version, _) = select_release(&releases, &current, "windows", "x86_64", true).unwrap();
    assert_eq!(version.to_string(), "19.0.2");
  }

  #[test]
  fn portable_assets_are_not_offered_to_other_architectures_or_installers() {
    let release = release("indev-19.0.2", true, "SAUMCL.exe");
    let version = semver::Version::parse("19.0.2-indev").unwrap();
    assert!(release_asset(&release, &version, "windows", "x86_64", true).is_some());
    assert!(release_asset(&release, &version, "windows", "aarch64", true).is_none());
    assert!(release_asset(&release, &version, "windows", "x86_64", false).is_none());
  }

  #[test]
  fn unsafe_or_empty_release_assets_are_rejected() {
    let version = semver::Version::parse("19.0.2-indev").unwrap();
    for url in [
      "https://example.invalid/SAUMCL.exe",
      "http://github.com/Supaio/SAUMCL/releases/download/indev-19.0.2/SAUMCL.exe",
      "https://github.com/other/project/releases/download/indev-19.0.2/SAUMCL.exe",
    ] {
      let mut value = release("indev-19.0.2", true, "SAUMCL.exe");
      value["assets"][0]["browser_download_url"] = json!(url);
      assert!(release_asset(&value, &version, "windows", "x86_64", true).is_none());
    }
    let mut empty = release("indev-19.0.2", true, "SAUMCL.exe");
    empty["assets"][0]["size"] = json!(0);
    assert!(release_asset(&empty, &version, "windows", "x86_64", true).is_none());
  }

  #[test]
  fn release_filenames_match_saumcl_distribution_artifacts() {
    for (os, arch, portable, expected) in [
      (
        "windows",
        "x86_64",
        true,
        "SAUMCL_0.1.0_windows_x86_64_portable.exe",
      ),
      (
        "windows",
        "x86_64",
        false,
        "SAUMCL_0.1.0_windows_x86_64_setup.exe",
      ),
      ("linux", "x86", true, "SAUMCL_0.1.0_linux_i686_portable"),
      (
        "macos",
        "aarch64",
        false,
        "SAUMCL_0.1.0_macos_aarch64.app.tar.gz",
      ),
    ] {
      assert_eq!(
        build_resource_filename("0.1.0", os, arch, portable),
        expected
      );
    }
  }

  #[test]
  fn portable_update_preserves_the_saumcl_name() {
    assert_eq!(
      build_local_new_filename("SAUMCL_0.1.0_windows_x86_64_portable.exe", "0.1.0", "0.2.0"),
      "SAUMCL_0.2.0_windows_x86_64_portable.exe"
    );
    assert_eq!(
      build_local_new_filename("SAUMCL.exe", "0.1.0", "0.2.0"),
      "SAUMCL.exe"
    );
  }
}
