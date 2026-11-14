//! Readers for the local Elden Ring install. Nothing from the game is shipped
//! inside the editor: names, icons and models are extracted into a cache.

pub mod archive;
pub mod bnd4;
pub mod catalog;
pub mod dcx;
pub mod fmg;
pub mod mods;
pub mod regulation;
pub mod worldmap;

pub use archive::{decrypt_header, find_entry, game_archives, parse_bhd5, path_hash, public_keys_from_exe, read_entry_bytes};
pub use catalog::{all_names, build_catalog, search, CatalogStats};
pub use dcx::decompress_dcx;

use std::path::{Path, PathBuf};

pub fn cache_root() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    base.join("EldenRingSaveEditor").join("cache")
}

pub fn version_cache(game_version: &str) -> PathBuf {
    cache_root().join(game_version)
}

pub fn ensure_dir(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)
}

pub fn find_oodle(game_dir: &Path) -> Option<PathBuf> {
    for name in ["oo2core_6_win64.dll", "oo2core_8_win64.dll", "oo2core_9_win64.dll"] {
        let direct = game_dir.join(name);
        if direct.exists() {
            return Some(direct);
        }
        let parent = game_dir.parent().map(|dir| dir.join(name));
        if let Some(parent) = parent {
            if parent.exists() {
                return Some(parent);
            }
        }
    }
    None
}
