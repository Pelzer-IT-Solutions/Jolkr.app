//! Serde helpers shared across crates.

/// Deserialize an optional field that distinguishes between *absent* and
/// *present-and-null*.
///
/// Plain `Option<T>` cannot tell the difference because both produce `None`.
/// PATCH endpoints that need to express "unset this field" must therefore use
/// `Option<Option<T>>`:
///
/// | JSON                | Rust                  | Meaning                |
/// |---------------------|-----------------------|------------------------|
/// | field absent        | `None`                | leave unchanged        |
/// | `"field": null`     | `Some(None)`          | clear the field        |
/// | `"field": <value>`  | `Some(Some(<value>))` | set to `<value>`       |
///
/// Pair with `#[serde(default)]` so an absent field deserialises to `None`.
pub mod double_option {
    use serde::{Deserialize, Deserializer};

    /// Deserializer that wraps any present value (including JSON `null`) in
    /// `Some(...)`. Use with `#[serde(default, deserialize_with = "...")]` on
    /// `Option<Option<T>>` fields to distinguish absent from present-and-null.
    pub fn deserialize<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
    where
        T: Deserialize<'de>,
        D: Deserializer<'de>,
    {
        Deserialize::deserialize(deserializer).map(Some)
    }
}
