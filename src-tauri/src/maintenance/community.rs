use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use url::Url;

use crate::maintenance::auth::MaintenanceError;
use crate::maintenance::storage::MaintenanceStore;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RewardOffer {
  pub id: String,
  pub title: String,
  pub description: String,
  pub kind: String,
  pub edition: String,
  pub source_url: String,
  pub claim_url: String,
  pub starts_at: Option<String>,
  pub earn_until: Option<String>,
  pub redeem_until: Option<String>,
  pub requires_code: bool,
  pub no_end_date: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RewardDraft {
  pub offer: RewardOffer,
  pub status: String,
  pub reviewed_at: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommunityLink {
  pub id: String,
  #[serde(default = "default_link_section")]
  pub section: String,
  pub kind: String,
  pub name: String,
  pub description: String,
  pub group_number: String,
  pub url: String,
  pub enabled: bool,
}

fn default_link_section() -> String {
  "sau".to_string()
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommunityDraft {
  pub schema_version: u32,
  pub last_collected_at: Option<String>,
  pub rewards: Vec<RewardDraft>,
  pub links: Vec<CommunityLink>,
}

impl Default for CommunityDraft {
  fn default() -> Self {
    Self {
      schema_version: 1,
      last_collected_at: None,
      rewards: Vec::new(),
      links: serde_json::from_str::<CommunityFeed>(include_str!("../../../public/community.json"))
        .map(|feed| feed.links)
        .unwrap_or_default(),
    }
  }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommunityFeed {
  pub schema_version: u32,
  pub rewards: Vec<RewardOffer>,
  pub links: Vec<CommunityLink>,
}

fn web_url(value: &str) -> bool {
  Url::parse(value).is_ok_and(|url| {
    matches!(url.scheme(), "https" | "http")
      && url.host_str().is_some()
      && url.username().is_empty()
      && url.password().is_none()
      && value.len() <= 2048
  })
}

pub fn official_article(value: &str) -> Option<String> {
  let url = Url::parse(value).ok()?;
  if url.scheme() != "https"
    || !matches!(url.host_str(), Some("minecraft.net" | "www.minecraft.net"))
    || !url.username().is_empty()
    || url.password().is_some()
    || url.port().is_some()
  {
    return None;
  }
  let (_, article) = url.path().split_once("/article/")?;
  let slug = article.trim_end_matches('/');
  if slug.is_empty() || slug.contains('/') {
    return None;
  }
  Some(format!("https://www.minecraft.net/en-us/article/{slug}"))
}

fn date_value(value: &str, end: bool) -> Option<i64> {
  if value.len() == 10 {
    return NaiveDate::parse_from_str(value, "%Y-%m-%d")
      .ok()
      .filter(|date| date.format("%Y-%m-%d").to_string() == value)
      .map(|date| {
        date
          .and_hms_opt(
            if end { 23 } else { 0 },
            if end { 59 } else { 0 },
            if end { 59 } else { 0 },
          )
          .unwrap()
          .and_utc()
          .timestamp()
      });
  }
  DateTime::parse_from_rfc3339(value)
    .ok()
    .map(|date| date.timestamp())
}

impl RewardOffer {
  fn valid(&self, approved: bool) -> bool {
    if self.id.is_empty()
      || self.id.len() > 128
      || self.title.chars().count() > 200
      || self.description.chars().count() > 4000
      || !["cape", "skin", "addon", "other"].contains(&self.kind.as_str())
      || !["java", "bedrock", "both", "other", "unknown"].contains(&self.edition.as_str())
      || (!self.source_url.is_empty() && official_article(&self.source_url).is_none())
      || (!self.claim_url.is_empty() && !web_url(&self.claim_url))
      || [&self.starts_at, &self.earn_until, &self.redeem_until]
        .iter()
        .any(|value| {
          value
            .as_ref()
            .is_some_and(|date| date_value(date, false).is_none())
        })
      || (!self.requires_code && self.redeem_until.is_some())
      || (self.no_end_date && (self.earn_until.is_some() || self.redeem_until.is_some()))
    {
      return false;
    }
    let start = self
      .starts_at
      .as_deref()
      .and_then(|date| date_value(date, false));
    let earn = self
      .earn_until
      .as_deref()
      .and_then(|date| date_value(date, true));
    let redeem = self
      .redeem_until
      .as_deref()
      .and_then(|date| date_value(date, true));
    if matches!((start, earn), (Some(a), Some(b)) if a > b)
      || matches!((start, redeem), (Some(a), Some(b)) if a > b)
      || matches!((earn, redeem), (Some(a), Some(b)) if a > b)
    {
      return false;
    }
    !approved
      || (!self.title.trim().is_empty()
        && !self.description.trim().is_empty()
        && self.edition != "unknown"
        && official_article(&self.source_url).is_some()
        && web_url(&self.claim_url)
        && (self.no_end_date || earn.is_some() || redeem.is_some()))
  }
}

impl CommunityDraft {
  fn validate(&self) -> Result<(), MaintenanceError> {
    let mut ids = HashSet::new();
    if self.schema_version != 1
      || self.rewards.len() > 200
      || self.links.len() > 60
      || self
        .last_collected_at
        .as_ref()
        .is_some_and(|date| DateTime::parse_from_rfc3339(date).is_err())
      || self.rewards.iter().any(|reward| {
        !ids.insert(&reward.offer.id)
          || !["pending", "approved", "rejected"].contains(&reward.status.as_str())
          || !reward.offer.valid(reward.status == "approved")
          || (reward.status == "approved" && reward.reviewed_at.is_none())
          || reward
            .reviewed_at
            .as_ref()
            .is_some_and(|date| DateTime::parse_from_rfc3339(date).is_err())
      })
      || self.links.iter().any(|link| {
        !ids.insert(&link.id)
          || !["sau", "universities"].contains(&link.section.as_str())
          || link.id.is_empty()
          || link.id.len() > 128
          || !["qq", "website"].contains(&link.kind.as_str())
          || link.name.chars().count() > 120
          || link.description.chars().count() > 1000
          || (!link.url.is_empty() && !web_url(&link.url))
          || (!link.group_number.is_empty()
            && (!(5..=12).contains(&link.group_number.len())
              || !link.group_number.bytes().all(|c| c.is_ascii_digit())))
          || (link.enabled
            && (link.name.trim().is_empty()
              || (link.kind == "qq" && link.group_number.is_empty())
              || (link.kind == "website" && link.url.is_empty())))
      })
    {
      return Err(MaintenanceError::InvalidDraft);
    }
    Ok(())
  }

  fn public_feed(&self) -> CommunityFeed {
    CommunityFeed {
      schema_version: 1,
      rewards: self
        .rewards
        .iter()
        .filter(|r| r.status == "approved")
        .map(|r| r.offer.clone())
        .collect(),
      links: self.links.iter().filter(|l| l.enabled).cloned().collect(),
    }
  }
}

pub fn reward_candidate(title: &str, description: &str) -> bool {
  let text = format!("{title} {description}").to_lowercase();
  text.split(|c: char| !c.is_ascii_alphabetic()).any(|word| {
    [
      "cape",
      "capes",
      "free",
      "reward",
      "rewards",
      "giveaway",
      "redeem",
      "claim",
      "promotion",
      "promos",
    ]
    .contains(&word)
  }) || [
    "community challenge",
    "披风",
    "披風",
    "斗篷",
    "免费",
    "免費",
    "奖励",
    "獎勵",
    "赠送",
    "贈送",
    "兑换",
    "兌換",
  ]
  .iter()
  .any(|word| text.contains(word))
}

impl MaintenanceStore {
  pub fn load_community(&self) -> Result<CommunityDraft, MaintenanceError> {
    self.require_authorization()?;
    let text = match fs::read_to_string(self.directory.join("community-draft.json")) {
      Ok(text) => text,
      Err(error) if error.kind() == ErrorKind::NotFound => return Ok(CommunityDraft::default()),
      Err(_) => return Err(MaintenanceError::StorageFailed),
    };
    let draft: CommunityDraft =
      serde_json::from_str(&text).map_err(|_| MaintenanceError::InvalidDraft)?;
    draft.validate()?;
    Ok(draft)
  }

  pub fn save_community(&self, draft: &CommunityDraft) -> Result<(), MaintenanceError> {
    self.require_authorization()?;
    draft.validate()?;
    fs::create_dir_all(&self.directory).map_err(|_| MaintenanceError::StorageFailed)?;
    let text = serde_json::to_string_pretty(draft).map_err(|_| MaintenanceError::InvalidDraft)?;
    fs::write(self.directory.join("community-draft.json"), text)
      .map_err(|_| MaintenanceError::StorageFailed)
  }

  pub fn export_community(
    &self,
    draft: &CommunityDraft,
    path: &Path,
  ) -> Result<(), MaintenanceError> {
    self.require_authorization()?;
    draft.validate()?;
    if !path
      .extension()
      .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
      || path.starts_with(&self.directory)
    {
      return Err(MaintenanceError::InvalidDraft);
    }
    let text = serde_json::to_string_pretty(&draft.public_feed())
      .map_err(|_| MaintenanceError::InvalidDraft)?;
    fs::write(path, text).map_err(|_| MaintenanceError::StorageFailed)
  }

  pub fn preview_community(&self, draft: Option<&CommunityDraft>) -> Result<(), MaintenanceError> {
    self.require_authorization()?;
    let path = self.directory.join("community-preview.json");
    if let Some(draft) = draft {
      draft.validate()?;
      fs::create_dir_all(&self.directory).map_err(|_| MaintenanceError::StorageFailed)?;
      let text = serde_json::to_string_pretty(&draft.public_feed())
        .map_err(|_| MaintenanceError::InvalidDraft)?;
      fs::write(path, text).map_err(|_| MaintenanceError::StorageFailed)
    } else {
      match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(_) => Err(MaintenanceError::StorageFailed),
      }
    }
  }

  pub fn load_community_preview(&self) -> Result<Option<CommunityFeed>, MaintenanceError> {
    if self.status()?.identity.is_none() {
      return Ok(None);
    }
    match fs::read_to_string(self.directory.join("community-preview.json")) {
      Ok(text) => serde_json::from_str(&text)
        .map(Some)
        .map_err(|_| MaintenanceError::InvalidDraft),
      Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
      Err(_) => Err(MaintenanceError::StorageFailed),
    }
  }

  // Repeated scans never replace a human decision or edited eligibility/deadlines.
  pub fn merge_reward_candidates(
    &self,
    articles: Vec<(String, String, String)>,
  ) -> Result<CommunityDraft, MaintenanceError> {
    let mut draft = self.load_community()?;
    let mut seen: HashSet<String> = draft
      .rewards
      .iter()
      .filter_map(|r| official_article(&r.offer.source_url))
      .collect();
    for (title, description, link) in articles {
      let Some(source_url) = official_article(&link) else {
        continue;
      };
      if draft.rewards.len() >= 200
        || !reward_candidate(&title, &description)
        || !seen.insert(source_url.clone())
      {
        continue;
      }
      draft.rewards.push(RewardDraft {
        offer: RewardOffer {
          id: uuid::Uuid::new_v4().to_string(),
          title: title.chars().take(200).collect(),
          description: description.chars().take(4000).collect(),
          kind: "other".to_string(),
          edition: "unknown".to_string(),
          claim_url: source_url.clone(),
          source_url,
          starts_at: None,
          earn_until: None,
          redeem_until: None,
          requires_code: false,
          no_end_date: false,
        },
        status: "pending".to_string(),
        reviewed_at: None,
      });
    }
    draft.last_collected_at = Some(Utc::now().to_rfc3339());
    self.save_community(&draft)?;
    Ok(draft)
  }
}

#[cfg(test)]
mod tests {
  use crate::maintenance::auth::{
    MaintenanceError,
    tests::{trusted_keys, valid_key},
  };
  use crate::maintenance::community::{CommunityFeed, CommunityLink, reward_candidate};
  use crate::maintenance::storage::MaintenanceStore;
  use std::fs;

  #[test]
  fn inbox_requires_key_and_only_approved_content_is_exported() {
    let directory = std::env::temp_dir().join(format!("saumcl-community-{}", uuid::Uuid::new_v4()));
    let store = MaintenanceStore::new(directory.join("private"), trusted_keys());
    assert!(matches!(
      store.load_community(),
      Err(MaintenanceError::Unauthorized)
    ));
    store.activate(&valid_key()).unwrap();
    let articles = vec![
      (
        "A free cape".into(),
        "Review the requirements".into(),
        "https://www.minecraft.net/zh-hans/article/test-cape?ref=news".into(),
      ),
      (
        "A fake giveaway".into(),
        "".into(),
        "https://www.minecraft.net.example.invalid/en-us/article/fake".into(),
      ),
      (
        "A snapshot".into(),
        "Bug fixes".into(),
        "https://www.minecraft.net/en-us/article/snapshot".into(),
      ),
    ];
    let mut draft = store.merge_reward_candidates(articles.clone()).unwrap();
    assert_eq!(draft.rewards.len(), 1);
    let export = directory.join("community.json");
    store.export_community(&draft, &export).unwrap();
    let feed: CommunityFeed = serde_json::from_str(&fs::read_to_string(&export).unwrap()).unwrap();
    assert!(feed.rewards.is_empty());
    draft.rewards[0].status = "approved".into();
    assert!(store.save_community(&draft).is_err());
    draft.rewards[0].reviewed_at = Some(chrono::Utc::now().to_rfc3339());
    draft.rewards[0].offer.edition = "both".into();
    draft.rewards[0].offer.earn_until = Some("2026-12-31".into());
    store.save_community(&draft).unwrap();
    let rescanned = store.merge_reward_candidates(articles).unwrap();
    assert_eq!(rescanned.rewards.len(), 1);
    assert_eq!(rescanned.rewards[0].status, "approved");
    draft.links.clear();
    draft.links.push(CommunityLink {
      id: "group".into(),
      section: "sau".into(),
      kind: "qq".into(),
      name: "QA group".into(),
      description: "".into(),
      group_number: "123456789".into(),
      url: "".into(),
      enabled: false,
    });
    store.export_community(&draft, &export).unwrap();
    let text = fs::read_to_string(&export).unwrap();
    assert!(!text.contains("reviewedAt"));
    assert!(!text.contains("lastCollectedAt"));
    assert!(!text.contains("SAUMCL-MAINT-1"));
    let feed: CommunityFeed = serde_json::from_str(&text).unwrap();
    assert_eq!(feed.rewards.len(), 1);
    assert!(feed.links.is_empty());
    assert!(
      store
        .export_community(&draft, &directory.join("private/community-draft.json"))
        .is_err()
    );
    store.preview_community(Some(&draft)).unwrap();
    assert_eq!(
      store
        .load_community_preview()
        .unwrap()
        .unwrap()
        .rewards
        .len(),
      1
    );
    store.deactivate().unwrap();
    assert!(store.load_community_preview().unwrap().is_none());
    assert!(store.save_community(&draft).is_err());
    assert!(store.export_community(&draft, &export).is_err());
    assert!(store.preview_community(None).is_err());
    fs::remove_dir_all(directory).unwrap();
  }

  #[test]
  fn approval_rejects_incomplete_dates_and_unsafe_links() {
    assert!(
      crate::maintenance::community::CommunityDraft::default()
        .validate()
        .is_ok()
    );
    let directory = std::env::temp_dir().join(format!("saumcl-review-{}", uuid::Uuid::new_v4()));
    let store = MaintenanceStore::new(directory.clone(), trusted_keys());
    store.activate(&valid_key()).unwrap();
    let mut draft = store
      .merge_reward_candidates(vec![(
        "Free cape".into(),
        "Rules".into(),
        "https://www.minecraft.net/en-us/article/cape".into(),
      )])
      .unwrap();
    let reward = &mut draft.rewards[0];
    reward.status = "approved".into();
    reward.reviewed_at = Some(chrono::Utc::now().to_rfc3339());
    reward.offer.edition = "java".into();
    reward.offer.no_end_date = true;
    assert!(draft.validate().is_ok());
    draft.rewards[0].offer.claim_url = "javascript:alert(1)".into();
    assert!(draft.validate().is_err());
    draft.rewards[0].offer.claim_url = "https://user:pass@example.invalid/".into();
    assert!(draft.validate().is_err());
    draft.rewards[0].offer.claim_url = "https://www.minecraft.net/en-us/redeem".into();
    draft.rewards[0].offer.no_end_date = false;
    draft.rewards[0].offer.earn_until = Some("2026-02-30".into());
    assert!(draft.validate().is_err());
    draft.rewards[0].offer.earn_until = Some("2026-12-31".into());
    draft.rewards[0].offer.redeem_until = Some("2026-11-30".into());
    draft.rewards[0].offer.requires_code = true;
    assert!(draft.validate().is_err());
    assert!(!reward_candidate("Escape the cave", "Adventure map"));
    assert!(reward_candidate("社区挑战", "领取免费皮肤"));
    fs::remove_dir_all(directory).unwrap();
  }
}
