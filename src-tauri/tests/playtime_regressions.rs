// Run the real recorder's regression tests without loading a Tauri window.
#[path = "../src/launch/playtime.rs"]
pub mod playtime;

mod launch {
  pub use crate::playtime;
}
