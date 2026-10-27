use chrono::{DateTime, Days, Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::{self, ErrorKind, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlaytimeLedger {
  schema_version: u32,
  historical_seconds: Option<u64>,
  tracking_started_at: NaiveDate,
  daily_millis: BTreeMap<NaiveDate, u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaytimeStats {
  pub daily_seconds: BTreeMap<NaiveDate, u64>,
  pub historical_seconds: u64,
  pub total_seconds: u64,
  pub tracking_started_at: NaiveDate,
  pub active_sessions: usize,
  pub save_failed: bool,
}

pub struct PlaytimeTracker {
  path: PathBuf,
  ledger: PlaytimeLedger,
  sessions: HashMap<u64, Instant>,
  dirty: bool,
  save_failed: bool,
}

impl PlaytimeTracker {
  pub fn load(path: PathBuf, today: NaiveDate) -> io::Result<Self> {
    let ledger = match fs::read(&path) {
      Ok(bytes) => {
        let ledger: PlaytimeLedger = serde_json::from_slice(&bytes)?;
        if ledger.schema_version != 1 {
          return Err(io::Error::new(
            ErrorKind::InvalidData,
            "Unsupported playtime schema",
          ));
        }
        ledger
      }
      Err(error) if error.kind() == ErrorKind::NotFound => PlaytimeLedger {
        schema_version: 1,
        historical_seconds: None,
        tracking_started_at: today,
        daily_millis: BTreeMap::new(),
      },
      Err(error) => return Err(error),
    };
    Ok(Self {
      path,
      ledger,
      sessions: HashMap::new(),
      dirty: false,
      save_failed: false,
    })
  }

  pub fn import_history(&mut self, seconds: u64) {
    if self.ledger.historical_seconds.is_none() {
      self.ledger.historical_seconds = Some(seconds);
      self.dirty = true;
    }
  }

  pub fn start(&mut self, id: u64, now: Instant) {
    self.sessions.entry(id).or_insert(now);
  }

  fn add_interval<Tz: TimeZone>(&mut self, mut start: DateTime<Tz>, end: DateTime<Tz>) {
    while start < end {
      let day = start.date_naive();
      let next_day = day.checked_add_days(Days::new(1)).unwrap();
      // Some time zones skip midnight when their UTC offset changes.
      let boundary = (0..24).find_map(|hour| {
        start
          .timezone()
          .from_local_datetime(&next_day.and_hms_opt(hour, 0, 0)?)
          .earliest()
      });
      let until = boundary
        .filter(|boundary| *boundary < end)
        .unwrap_or_else(|| end.clone());
      let millis = (until.clone() - start).num_milliseconds().max(0) as u64;
      let recorded = self.ledger.daily_millis.entry(day).or_default();
      *recorded = recorded.saturating_add(millis);
      self.dirty |= millis > 0;
      start = until;
    }
  }

  pub fn checkpoint(&mut self, now: Instant, wall_time: DateTime<Local>) {
    let elapsed = self
      .sessions
      .values_mut()
      .map(|last| {
        let millis = now
          .saturating_duration_since(*last)
          .as_millis()
          .min(i64::MAX as u128) as i64;
        *last = now;
        millis
      })
      .collect::<Vec<_>>();
    for millis in elapsed.into_iter().filter(|millis| *millis > 0) {
      if let Some(start) = wall_time.checked_sub_signed(chrono::Duration::milliseconds(millis)) {
        self.add_interval(start, wall_time);
      }
    }
  }

  pub fn flush(&mut self) -> io::Result<()> {
    if !self.dirty {
      return Ok(());
    }
    let result = (|| {
      let parent = self
        .path
        .parent()
        .ok_or_else(|| io::Error::new(ErrorKind::InvalidInput, "Missing playtime directory"))?;
      fs::create_dir_all(parent)?;
      let temporary = self.path.with_extension("json.tmp");
      let mut file = fs::File::create(&temporary)?;
      file.write_all(&serde_json::to_vec(&self.ledger)?)?;
      file.sync_all()?;
      drop(file);
      fs::rename(temporary, &self.path)
    })();
    self.save_failed = result.is_err();
    if result.is_ok() {
      self.dirty = false;
    }
    result
  }

  pub fn snapshot(&self) -> PlaytimeStats {
    let historical_seconds = self.ledger.historical_seconds.unwrap_or(0);
    let recorded_millis = self
      .ledger
      .daily_millis
      .values()
      .fold(0u128, |sum, value| sum.saturating_add(*value as u128));
    PlaytimeStats {
      daily_seconds: self
        .ledger
        .daily_millis
        .iter()
        .map(|(day, millis)| (*day, millis / 1000))
        .collect(),
      historical_seconds,
      total_seconds: historical_seconds
        .saturating_add((recorded_millis / 1000).min(u64::MAX as u128) as u64),
      tracking_started_at: self.ledger.tracking_started_at,
      active_sessions: self.sessions.len(),
      save_failed: self.save_failed,
    }
  }
}

pub struct PlaytimeState(Mutex<Result<PlaytimeTracker, String>>);

impl PlaytimeState {
  pub fn new(path: PathBuf) -> Self {
    Self(Mutex::new(
      PlaytimeTracker::load(path, Local::now().date_naive())
        .map_err(|_| "PLAYTIME_LOAD_FAILED".to_string()),
    ))
  }

  fn with_tracker<T>(
    &self,
    action: impl FnOnce(&mut PlaytimeTracker) -> io::Result<T>,
  ) -> Result<T, String> {
    let mut state = self
      .0
      .lock()
      .map_err(|_| "PLAYTIME_UNAVAILABLE".to_string())?;
    let tracker = state.as_mut().map_err(|error| error.clone())?;
    action(tracker).map_err(|_| "PLAYTIME_SAVE_FAILED".to_string())
  }

  pub fn needs_history(&self) -> bool {
    self
      .with_tracker(|tracker| Ok(tracker.ledger.historical_seconds.is_none()))
      .unwrap_or(false)
  }

  pub fn import_history(&self, seconds: u64) -> Result<(), String> {
    self.with_tracker(|tracker| {
      tracker.import_history(seconds);
      tracker.flush()
    })
  }

  pub fn start(&self, id: u64, historical_seconds: u64, now: Instant) -> Result<(), String> {
    self.with_tracker(|tracker| {
      tracker.import_history(historical_seconds);
      tracker.start(id, now);
      tracker.flush()
    })
  }

  pub fn flush(&self) -> Result<(), String> {
    self.with_tracker(|tracker| {
      tracker.checkpoint(Instant::now(), Local::now());
      tracker.flush()
    })
  }

  pub fn finish(&self, id: u64) -> Result<(), String> {
    self.with_tracker(|tracker| {
      tracker.checkpoint(Instant::now(), Local::now());
      tracker.sessions.remove(&id);
      tracker.flush()
    })
  }

  pub fn snapshot(&self) -> Result<PlaytimeStats, String> {
    self.with_tracker(|tracker| {
      tracker.checkpoint(Instant::now(), Local::now());
      Ok(tracker.snapshot())
    })
  }
}

#[cfg(test)]
mod tests {
  use crate::launch::playtime::{PlaytimeState, PlaytimeTracker};
  use chrono::{DateTime, Local, NaiveDate};
  use std::fs;
  use std::path::PathBuf;
  use std::time::{Duration, Instant};

  struct TestDirectory(PathBuf);
  impl TestDirectory {
    fn new() -> Self {
      let path = std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("saumcl-playtime-{}", uuid::Uuid::new_v4()));
      fs::create_dir(&path).unwrap();
      Self(path)
    }
    fn tracker(&self) -> PlaytimeTracker {
      PlaytimeTracker::load(
        self.0.join("playtime.json"),
        NaiveDate::from_ymd_opt(2026, 10, 24).unwrap(),
      )
      .unwrap()
    }
  }
  impl Drop for TestDirectory {
    fn drop(&mut self) {
      if let (Ok(target), Ok(root)) = (self.0.canonicalize(), std::env::temp_dir().canonicalize()) {
        if target.parent() == Some(root.as_path())
          && target
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("saumcl-playtime-")
        {
          let _ = fs::remove_dir_all(target);
        }
      }
    }
  }

  #[test]
  fn legacy_total_is_imported_once_without_fabricating_calendar_days() {
    let directory = TestDirectory::new();
    let mut tracker = directory.tracker();
    tracker.import_history(7200);
    tracker.import_history(99999);
    tracker.flush().unwrap();
    let mut restored = directory.tracker();
    restored.import_history(99999);
    let stats = restored.snapshot();
    assert_eq!(stats.total_seconds, 7200);
    assert!(stats.daily_seconds.is_empty());
  }

  #[test]
  fn a_session_crossing_local_midnight_is_split_between_both_days() {
    let directory = TestDirectory::new();
    let mut tracker = directory.tracker();
    tracker.add_interval(
      DateTime::parse_from_rfc3339("2026-10-24T23:30:00+09:00").unwrap(),
      DateTime::parse_from_rfc3339("2026-10-25T01:15:00+09:00").unwrap(),
    );
    let stats = tracker.snapshot();
    assert_eq!(
      stats.daily_seconds[&NaiveDate::from_ymd_opt(2026, 10, 24).unwrap()],
      1800
    );
    assert_eq!(
      stats.daily_seconds[&NaiveDate::from_ymd_opt(2026, 10, 25).unwrap()],
      4500
    );
    assert_eq!(stats.total_seconds, 6300);
  }

  #[test]
  fn a_sunday_session_and_the_next_week_are_not_combined_into_one_date() {
    let directory = TestDirectory::new();
    let mut tracker = directory.tracker();
    tracker.add_interval(
      DateTime::parse_from_rfc3339("2026-10-25T23:59:00+08:00").unwrap(),
      DateTime::parse_from_rfc3339("2026-10-26T00:01:00+08:00").unwrap(),
    );
    assert_eq!(
      tracker
        .snapshot()
        .daily_seconds
        .values()
        .copied()
        .collect::<Vec<_>>(),
      vec![60, 60]
    );
  }

  #[test]
  fn live_snapshots_count_elapsed_time_once_and_keep_subsecond_progress() {
    let directory = TestDirectory::new();
    let mut tracker = directory.tracker();
    let start = Instant::now();
    let wall = Local::now();
    tracker.start(1, start);
    tracker.start(1, start + Duration::from_secs(20));
    tracker.checkpoint(start + Duration::from_millis(500), wall);
    tracker.checkpoint(start + Duration::from_millis(1500), wall);
    tracker.checkpoint(start + Duration::from_millis(1500), wall);
    tracker.checkpoint(start + Duration::from_millis(60000), wall);
    assert_eq!(tracker.snapshot().total_seconds, 60);
    assert_eq!(tracker.snapshot().active_sessions, 1);
  }

  #[test]
  fn checkpoint_survives_a_restart_without_counting_the_closed_session_again() {
    let directory = TestDirectory::new();
    let mut tracker = directory.tracker();
    let start = Instant::now();
    tracker.import_history(3600);
    tracker.start(1, start);
    tracker.checkpoint(start + Duration::from_secs(90), Local::now());
    tracker.flush().unwrap();
    let mut restored = directory.tracker();
    restored.checkpoint(start + Duration::from_secs(3600), Local::now());
    assert_eq!(restored.snapshot().total_seconds, 3690);
    assert_eq!(restored.snapshot().active_sessions, 0);
  }

  #[test]
  fn finishing_removes_the_live_session_and_persists_its_time() {
    let directory = TestDirectory::new();
    let state = PlaytimeState::new(directory.0.join("playtime.json"));
    state
      .start(1, 3600, Instant::now() - Duration::from_secs(90))
      .unwrap();
    state.finish(1).unwrap();
    assert_eq!(state.snapshot().unwrap().active_sessions, 0);
    assert!(directory.tracker().snapshot().total_seconds >= 3690);
  }

  #[test]
  fn unreadable_history_is_preserved_instead_of_overwritten() {
    let directory = TestDirectory::new();
    let path = directory.0.join("playtime.json");
    fs::write(&path, b"not json").unwrap();
    let state = PlaytimeState::new(path.clone());
    assert!(state.snapshot().is_err());
    assert!(state.start(1, 999, Instant::now()).is_err());
    assert_eq!(fs::read(path).unwrap(), b"not json");
  }

  #[test]
  fn a_failed_save_keeps_the_in_memory_total_and_can_be_retried() {
    let directory = TestDirectory::new();
    let blocked = directory.0.join("blocked");
    let mut tracker =
      PlaytimeTracker::load(blocked.join("playtime.json"), Local::now().date_naive()).unwrap();
    tracker.import_history(3600);
    fs::write(&blocked, b"blocked").unwrap();
    assert!(tracker.flush().is_err());
    assert_eq!(tracker.snapshot().total_seconds, 3600);
    assert!(tracker.snapshot().save_failed);
    fs::remove_file(&blocked).unwrap();
    tracker.flush().unwrap();
    assert!(!tracker.snapshot().save_failed);
  }
}
