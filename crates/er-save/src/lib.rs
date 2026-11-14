//! Elden Ring PC save reader and editor.
//!
//! Offsets were checked against a real `.sl2`. A failed edit is discarded by
//! the caller: [`apply_to_bytes`] returns a new buffer and never touches the file.

pub mod constants;
pub mod container;
pub mod error;
pub mod flags;
pub mod hash;
pub mod session;
pub mod slot;

pub use error::{SaveError, SaveResult};
pub use session::{
    apply_to_bytes, apply_with, open_bytes, slot_name_level, AddedItem, ApplyRequest, CopyBuild, OpenedSave, SlotOp, WritePolicy,
};
pub use slot::CharacterPatch;
