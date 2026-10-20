use std::fs;
use std::io::{Cursor, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use zip::result::ZipError;
use zip::write::{ExtendedFileOptions, FileOptions, SimpleFileOptions};
use zip::{CompressionMethod, ZipArchive, ZipWriter};

static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
  fn new() -> Self {
    let path = std::env::temp_dir().join(format!(
      "saumcl-zip-regression-{}-{}",
      std::process::id(),
      NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&path).unwrap();
    Self(path)
  }
}

impl Drop for TestDirectory {
  fn drop(&mut self) {
    let _ = fs::remove_dir_all(&self.0);
  }
}

fn archive_with_file(name: &str, contents: &[u8]) -> Vec<u8> {
  let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
  writer
    .start_file(name, SimpleFileOptions::default())
    .unwrap();
  writer.write_all(contents).unwrap();
  writer.finish().unwrap().into_inner()
}

#[test]
fn modpack_entries_round_trip_with_stored_and_deflated_files() {
  let directory = TestDirectory::new();
  let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
  let deflated = FileOptions::<ExtendedFileOptions>::default()
    .compression_method(CompressionMethod::Deflated)
    .compression_level(Some(1));
  writer
    .start_file("modrinth.index.json", deflated.clone())
    .unwrap();
  writer.write_all(br#"{"formatVersion":1}"#).unwrap();
  writer
    .start_file("overrides/config/校服.txt", deflated)
    .unwrap();
  writer.write_all(b"school configuration").unwrap();
  writer
    .start_file(
      "overrides/mods/example.jar",
      FileOptions::<ExtendedFileOptions>::default().compression_method(CompressionMethod::Stored),
    )
    .unwrap();
  writer.write_all(b"jar contents").unwrap();
  let bytes = writer.finish().unwrap().into_inner();

  let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
  archive.extract(&directory.0).unwrap();

  assert_eq!(
    fs::read(directory.0.join("modrinth.index.json")).unwrap(),
    br#"{"formatVersion":1}"#
  );
  assert_eq!(
    fs::read(directory.0.join("overrides/config/校服.txt")).unwrap(),
    b"school configuration"
  );
  assert_eq!(
    fs::read(directory.0.join("overrides/mods/example.jar")).unwrap(),
    b"jar contents"
  );
}

#[test]
fn native_archives_can_share_an_existing_destination() {
  let directory = TestDirectory::new();
  for (name, contents) in [
    ("native-a.dll", b"first".as_slice()),
    ("native-b.dll", b"second"),
  ] {
    let bytes = archive_with_file(name, contents);
    ZipArchive::new(Cursor::new(bytes))
      .unwrap()
      .extract(&directory.0)
      .unwrap();
  }
  assert_eq!(
    fs::read(directory.0.join("native-a.dll")).unwrap(),
    b"first"
  );
  assert_eq!(
    fs::read(directory.0.join("native-b.dll")).unwrap(),
    b"second"
  );
}

#[test]
fn extraction_rejects_symlinks_that_escape_the_destination() {
  let directory = TestDirectory::new();
  let destination = directory.0.join("extracted");
  let outside = directory.0.join("outside.txt");
  fs::write(&outside, b"unchanged").unwrap();
  let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
  writer
    .add_symlink("escape", "../outside.txt", SimpleFileOptions::default())
    .unwrap();
  let bytes = writer.finish().unwrap().into_inner();
  let result = ZipArchive::new(Cursor::new(bytes))
    .unwrap()
    .extract(&destination);

  assert!(matches!(result, Err(ZipError::InvalidArchive(_))));
  assert!(fs::symlink_metadata(destination.join("escape")).is_err());
  assert_eq!(fs::read(outside).unwrap(), b"unchanged");
}

#[cfg(unix)]
#[test]
fn extraction_does_not_write_through_an_existing_symlink() {
  let directory = TestDirectory::new();
  let destination = directory.0.join("extracted");
  let outside = directory.0.join("outside");
  fs::create_dir(&destination).unwrap();
  fs::create_dir(&outside).unwrap();
  std::os::unix::fs::symlink(&outside, destination.join("escape")).unwrap();
  let bytes = archive_with_file("escape/modified.txt", b"must stay inside");
  let result = ZipArchive::new(Cursor::new(bytes))
    .unwrap()
    .extract(&destination);

  assert!(result.is_err());
  assert!(!outside.join("modified.txt").exists());
}

#[cfg(unix)]
#[test]
fn extraction_strips_setuid_and_setgid_but_keeps_execute_permissions() {
  use std::os::unix::fs::PermissionsExt;

  let directory = TestDirectory::new();
  let mut bytes = archive_with_file("run.sh", b"echo example");
  let central = bytes
    .windows(4)
    .position(|part| part == b"PK\x01\x02")
    .unwrap();
  // Encode an untrusted Unix regular-file mode directly in the central directory.
  bytes[central + 5] = 3;
  bytes[central + 38..central + 42].copy_from_slice(&(0o106755u32 << 16).to_le_bytes());
  ZipArchive::new(Cursor::new(bytes))
    .unwrap()
    .extract(&directory.0)
    .unwrap();

  let permissions = fs::metadata(directory.0.join("run.sh"))
    .unwrap()
    .permissions()
    .mode();
  assert_eq!(permissions & 0o6000, 0);
  assert_eq!(permissions & 0o111, 0o111);
}
