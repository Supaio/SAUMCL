use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use rsa::RsaPublicKey;
use rsa::pkcs8::DecodePublicKey;
use rsa::traits::PublicKeyParts;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

const KEY_PREFIX: &str = "SAUMCL-MAINT-1.";
pub const MAX_KEY_BYTES: usize = 8192;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrustedKey {
  pub id: String,
  pub public_key: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaintainerIdentity {
  pub id: String,
  pub name: String,
  pub account_uuid: Uuid,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GrantClaims {
  schema: u32,
  iss: String,
  aud: String,
  sub: String,
  name: String,
  role: String,
  #[serde(rename = "accountUuid")]
  account_uuid: Option<Uuid>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MaintenanceError {
  NotConfigured,
  InvalidKey,
  AccountBindingRequired,
  KeyAccountMismatch,
  MicrosoftAccountRequired,
  MicrosoftVerificationFailed,
  Unauthorized,
  InvalidDraft,
  StorageFailed,
  CollectionFailed,
}

pub fn verify_key(
  key: &str,
  trusted_keys: &[TrustedKey],
) -> Result<MaintainerIdentity, MaintenanceError> {
  if trusted_keys.is_empty() {
    return Err(MaintenanceError::NotConfigured);
  }
  let key = key.trim();
  if key.len() > MAX_KEY_BYTES {
    return Err(MaintenanceError::InvalidKey);
  }
  let token = key
    .strip_prefix(KEY_PREFIX)
    .ok_or(MaintenanceError::InvalidKey)?;
  let header = decode_header(token).map_err(|_| MaintenanceError::InvalidKey)?;
  if header.alg != Algorithm::RS256 || header.typ.as_deref() != Some("JWT") {
    return Err(MaintenanceError::InvalidKey);
  }
  let trusted_key = trusted_keys
    .iter()
    .find(|key| Some(key.id.as_str()) == header.kid.as_deref())
    .ok_or(MaintenanceError::InvalidKey)?;
  let rsa_key = RsaPublicKey::from_public_key_pem(&trusted_key.public_key)
    .map_err(|_| MaintenanceError::NotConfigured)?;
  if rsa_key.n().bits() < 2048 {
    return Err(MaintenanceError::NotConfigured);
  }
  let public_key =
    DecodingKey::from_rsa_raw_components(&rsa_key.n().to_bytes_be(), &rsa_key.e().to_bytes_be());
  let mut validation = Validation::new(Algorithm::RS256);
  validation.set_required_spec_claims(&["iss", "aud", "sub"]);
  validation.set_issuer(&["saumcl-maintainer"]);
  validation.set_audience(&["saumcl-maintenance"]);
  // Maintenance qualifications are permanent and independent of launcher/pack versions.
  validation.validate_exp = false;
  let claims = decode::<GrantClaims>(token, &public_key, &validation)
    .map_err(|_| MaintenanceError::InvalidKey)?
    .claims;
  if claims.iss != "saumcl-maintainer"
    || claims.aud != "saumcl-maintenance"
    || claims.role != "maintainer"
    || claims.sub.trim().is_empty()
    || claims.sub.len() > 128
    || claims.name.trim().is_empty()
    || claims.name.chars().count() > 80
  {
    return Err(MaintenanceError::InvalidKey);
  }
  let account_uuid = match (claims.schema, claims.account_uuid) {
    (1, None) => return Err(MaintenanceError::AccountBindingRequired),
    (2, Some(uuid)) if !uuid.is_nil() => uuid,
    _ => return Err(MaintenanceError::InvalidKey),
  };
  Ok(MaintainerIdentity {
    id: claims.sub,
    name: claims.name,
    account_uuid,
  })
}

#[cfg(test)]
pub(crate) mod tests {
  use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
  use jsonwebtoken::{EncodingKey, Header, encode};
  use rsa::pkcs1::EncodeRsaPrivateKey;
  use rsa::pkcs1v15::SigningKey;
  use rsa::pkcs8::{EncodePublicKey, LineEnding};
  use rsa::signature::{SignatureEncoding, Signer};
  use rsa::{RsaPrivateKey, RsaPublicKey};
  use serde_json::{Value, json};
  use sha2::Sha256;
  use std::sync::LazyLock;
  use uuid::Uuid;

  use crate::maintenance::auth::{MaintenanceError, TrustedKey, verify_key};

  // Test signing material is generated in memory and is never written or printed.
  static SIGNING_PAIR: LazyLock<(EncodingKey, String, RsaPrivateKey)> = LazyLock::new(|| {
    let private = RsaPrivateKey::new(&mut rsa::rand_core::OsRng, 2048).unwrap();
    let public = RsaPublicKey::from(&private)
      .to_public_key_pem(LineEnding::LF)
      .unwrap();
    let der = private.to_pkcs1_der().unwrap();
    (EncodingKey::from_rsa_der(der.as_bytes()), public, private)
  });

  pub(crate) fn trusted_keys() -> Vec<TrustedKey> {
    vec![TrustedKey {
      id: "test-owner".to_string(),
      public_key: SIGNING_PAIR.1.clone(),
    }]
  }

  pub(crate) fn account_uuid() -> Uuid {
    Uuid::from_u128(1)
  }

  fn claims() -> Value {
    json!({
      "schema": 2,
      "iss": "saumcl-maintainer",
      "aud": "saumcl-maintenance",
      "sub": "test-maintainer",
      "name": "测试维护人员",
      "role": "maintainer",
      "accountUuid": account_uuid().simple().to_string()
    })
  }

  fn sign(claims: &Value) -> String {
    let mut header = Header::new(jsonwebtoken::Algorithm::RS256);
    header.kid = Some("test-owner".to_string());
    format!(
      "SAUMCL-MAINT-1.{}",
      encode(&header, claims, &SIGNING_PAIR.0).unwrap()
    )
  }

  pub(crate) fn valid_key() -> String {
    sign(&claims())
  }

  #[test]
  fn permanent_grant_needs_no_expiration_or_game_launcher_version() {
    let grant = verify_key(&valid_key(), &trusted_keys()).unwrap();
    assert_eq!(grant.name, "测试维护人员");
    assert_eq!(grant.account_uuid, account_uuid());
  }

  #[test]
  fn legacy_grant_requires_owner_to_reissue_it_for_an_account() {
    let mut claims = claims();
    claims["schema"] = json!(1);
    claims.as_object_mut().unwrap().remove("accountUuid");
    assert!(matches!(
      verify_key(&sign(&claims), &trusted_keys()),
      Err(MaintenanceError::AccountBindingRequired)
    ));
  }

  #[test]
  fn grants_signed_with_previous_rustcrypto_implementation_remain_valid() {
    let header = json!({ "alg": "RS256", "typ": "JWT", "kid": "test-owner" });
    let message = format!(
      "{}.{}",
      URL_SAFE_NO_PAD.encode(serde_json::to_vec(&header).unwrap()),
      URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims()).unwrap())
    );
    let signature = SigningKey::<Sha256>::new(SIGNING_PAIR.2.clone()).sign(message.as_bytes());
    let key = format!(
      "SAUMCL-MAINT-1.{message}.{}",
      URL_SAFE_NO_PAD.encode(signature.to_bytes())
    );
    let grant = verify_key(&key, &trusted_keys()).unwrap();
    assert_eq!(grant.id, "test-maintainer");
  }

  #[test]
  fn adding_another_owner_key_keeps_existing_grants_valid() {
    let mut keys = trusted_keys();
    keys.push(TrustedKey {
      id: "another-owner".to_string(),
      public_key: keys[0].public_key.clone(),
    });
    assert!(verify_key(&valid_key(), &keys).is_ok());
  }

  #[test]
  fn wrong_purpose_role_or_expiring_format_is_rejected() {
    for (field, value) in [
      ("aud", json!("another-app")),
      ("iss", json!("another-issuer")),
      ("role", json!("player")),
      ("exp", json!(1)),
      ("name", json!("")),
      ("schema", json!(3)),
      ("accountUuid", json!(null)),
      ("accountUuid", json!(Uuid::nil())),
    ] {
      let mut claims = claims();
      claims[field] = value;
      assert!(matches!(
        verify_key(&sign(&claims), &trusted_keys()),
        Err(MaintenanceError::InvalidKey)
      ));
    }
  }

  #[test]
  fn altered_signature_unknown_owner_and_unsigned_input_are_rejected() {
    let key = valid_key();
    let (prefix, signature) = key.rsplit_once('.').unwrap();
    let changed = if signature.starts_with('A') { 'B' } else { 'A' };
    let altered = format!("{prefix}.{changed}{}", &signature[1..]);
    assert!(verify_key(&altered, &trusted_keys()).is_err());
    let mut keys = trusted_keys();
    keys[0].id = "different-owner".to_string();
    assert!(verify_key(&key, &keys).is_err());
    for malformed in ["", "SAUMCL-MAINT-1.", "{\"authorized\":true}"] {
      assert!(verify_key(malformed, &trusted_keys()).is_err());
    }
  }
}
