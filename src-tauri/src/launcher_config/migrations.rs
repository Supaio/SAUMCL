use serde::Deserialize;
use serde::de::Deserializer;

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

#[cfg(test)]
mod tests {
  use crate::launcher_config::models::{GeneralConfig, LauncherConfig};
  use serde_json::json;

  #[test]
  fn legacy_news_sources_do_not_override_managed_feeds_or_other_preferences() {
    for sources in [
      json!(["https://example.invalid/news"]),
      json!([["https://mc.sjtu.cn/api-sjmcl/article/mua", false]]),
    ] {
      let config: LauncherConfig = serde_json::from_value(json!({
        "discoverSourceEndpoints": sources,
        "discoverSourcesVersion": 1,
        "appearance": { "theme": { "primaryColor": "teal" } }
      }))
      .expect("legacy news settings must not prevent loading the launcher config");
      assert_eq!(config.appearance.theme.primary_color, "teal");
      let serialized = serde_json::to_value(config).unwrap();
      assert!(serialized.get("discoverSourceEndpoints").is_none());
      assert!(serialized.get("discoverSourcesVersion").is_none());
    }
  }

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
