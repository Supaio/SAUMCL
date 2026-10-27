// Exercise the actual verifier and store without starting a Tauri application.
#[path = "../src/maintenance/auth.rs"]
pub mod maintenance_auth;
#[path = "../src/maintenance/community.rs"]
pub mod maintenance_community;
#[path = "../src/maintenance/storage.rs"]
pub mod maintenance_storage;

mod maintenance {
  pub use crate::maintenance_auth as auth;
  pub use crate::maintenance_community as community;
  pub use crate::maintenance_storage as storage;
}
