use serde::Deserialize;
use serde::de::Deserializer;
use serde_json::Value;

use crate::launcher_config::models::AppearanceBackgroundConfig;

pub fn deserialize_language<'de, D>(deserializer: D) -> Result<String, D::Error>
where
  D: Deserializer<'de>,
{
  let language = String::deserialize(deserializer)?;
  Ok(match language.as_str() {
    "en" | "zh-Hans" | "zh-Hant" => language,
    "lzh" => "zh-Hans".to_string(),
    _ => "en".to_string(),
  })
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct BackgroundPayload {
  choice: String,
  random_custom: bool,
  auto_darken: bool,
}

pub fn deserialize_background<'de, D>(
  deserializer: D,
) -> Result<AppearanceBackgroundConfig, D::Error>
where
  D: Deserializer<'de>,
{
  let mut payload = BackgroundPayload::deserialize(deserializer)?;

  if payload.choice.starts_with("%built-in:") {
    payload.choice = AppearanceBackgroundConfig::default().choice;
  }

  Ok(AppearanceBackgroundConfig {
    choice: payload.choice,
    random_custom: payload.random_custom,
    auto_darken: payload.auto_darken,
  })
}

// Deserializing discover sources from old and new formats.
// Migrated from Vec<String> to Vec<(String, bool)> with default enabled=true
pub fn deserialize_discover_sources<'de, D>(
  deserializer: D,
) -> Result<Vec<(String, bool)>, D::Error>
where
  D: Deserializer<'de>,
{
  let value = match Value::deserialize(deserializer) {
    Ok(value) => value,
    Err(_) => return Ok(Vec::default()),
  };

  let items = match value.as_array() {
    Some(items) => items,
    None => return Ok(Vec::default()),
  };

  Ok(
    items
      .iter()
      .filter_map(|item| match item {
        Value::String(url) => Some((url.to_string(), true)),
        Value::Array(tuple) if tuple.len() == 2 => {
          let url = tuple.first()?.as_str()?;
          let enabled = tuple.get(1)?.as_bool()?;
          Some((url.to_string(), enabled))
        }
        _ => None,
      })
      .collect(),
  )
}

#[cfg(test)]
mod tests {
  use crate::launcher_config::models::GeneralConfig;
  use serde_json::json;

  #[test]
  fn config_keeps_supported_languages() {
    for language in ["en", "zh-Hans", "zh-Hant"] {
      let config: GeneralConfig = serde_json::from_value(json!({
        "general": { "language": language }
      }))
      .expect("supported language should load");

      assert_eq!(config.general.language, language);
    }
  }

  #[test]
  fn config_migrates_removed_languages_without_losing_other_settings() {
    for (language, expected) in [
      ("es", "en"),
      ("fr", "en"),
      ("ja", "en"),
      ("lzh", "zh-Hans"),
      ("de", "en"),
    ] {
      let config: GeneralConfig = serde_json::from_value(json!({
        "general": { "language": language },
        "functionality": {
          "discoverPage": "off",
          "autoDownloadJava": false
        }
      }))
      .expect("legacy configuration should load");

      assert_eq!(config.general.language, expected);
      assert_eq!(config.functionality.discover_page, "off");
      assert!(!config.functionality.auto_download_java);
    }
  }
}
