//! Item names from the installed game, including Shadow of the Erdtree message files.
//! The result is a SQLite database in the local cache. No game text is shipped with the editor.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};

use crate::archive::{decrypt_header, game_archives, parse_bhd5, public_keys_from_exe, read_entry_bytes, ArchiveEntry, ArchiveError};
use crate::bnd4;
use crate::dcx::decompress_dcx;
use crate::find_oodle;
use crate::fmg;

#[derive(Debug, Clone, serde::Serialize)]
pub struct CatalogStats {
    pub weapons: u32,
    pub armor: u32,
    pub talismans: u32,
    pub goods: u32,
    pub gems: u32,
    pub dlc_rows: u32,
}

pub struct Index {
    pub oodle: Option<PathBuf>,
    archives: Vec<(PathBuf, Vec<ArchiveEntry>)>,
}

impl Index {
    pub fn entry(&self, virtual_path: &str) -> Option<(PathBuf, ArchiveEntry)> {
        let hash = crate::archive::path_hash(virtual_path);
        self.archives.iter().find_map(|(header, entries)| {
            entries.iter().find(|entry| entry.hash == hash).map(|entry| (header.with_extension("bdt"), entry.clone()))
        })
    }

    pub fn open(game: &Path) -> Result<Self, ArchiveError> {
        let exe = std::fs::read(game.join("eldenring.exe")).map_err(|error| ArchiveError::Message(error.to_string()))?;
        let keys = public_keys_from_exe(&exe);
        if keys.is_empty() {
            return Err(ArchiveError::Message("o executável não tem chaves de arquivo".into()));
        }
        let mut archives = Vec::new();
        for header in game_archives(game) {
            let encrypted = std::fs::read(&header).map_err(|error| ArchiveError::Message(error.to_string()))?;
            let plain = decrypt_header(&encrypted, &keys)?;
            let parsed = parse_bhd5(&plain)?;
            archives.push((header, parsed));
        }
        Ok(Self { oodle: find_oodle(game), archives })
    }

    pub fn read(&self, virtual_path: &str) -> Result<Vec<u8>, ArchiveError> {
        let hash = crate::archive::path_hash(virtual_path);
        for (header, entries) in &self.archives {
            if let Some(entry) = entries.iter().find(|entry| entry.hash == hash) {
                let raw = read_entry_bytes(&header.with_extension("bdt"), entry)?;
                return if raw.starts_with(b"DCX\0") {
                    decompress_dcx(&raw, self.oodle.as_deref())
                } else {
                    Ok(raw)
                };
            }
        }
        Err(ArchiveError::Message(format!("arquivo não encontrado: {virtual_path}")))
    }
}

const KINDS: &[(&str, &str)] = &[
    ("WeaponName", "weapon"),
    ("ProtectorName", "armor"),
    ("AccessoryName", "talisman"),
    ("GoodsName", "goods"),
    ("GemName", "gem"),
];

fn kind_of(file_name: &str) -> Option<&'static str> {
    let base = Path::new(file_name).file_stem().and_then(|name| name.to_str()).unwrap_or(file_name);
    let base = base.strip_suffix(".fmg").unwrap_or(base);
    KINDS.iter().find(|(marker, _)| base.ends_with(marker) || base.contains(marker)).map(|(_, kind)| *kind)
}

fn texts_in_bundle(bytes: &[u8], oodle: Option<&Path>) -> Result<Vec<(&'static str, HashMap<i32, String>)>, ArchiveError> {
    let plain = if bytes.starts_with(b"DCX\0") { decompress_dcx(bytes, oodle)? } else { bytes.to_vec() };
    let files = bnd4::members(&plain)?;
    let mut found = Vec::new();
    for member in files {
        let Some(kind) = kind_of(&member.name) else { continue };
        let data = if member.data.starts_with(b"DCX\0") {
            decompress_dcx(&member.data, oodle).unwrap_or(member.data)
        } else {
            member.data
        };
        let table = fmg::parse(&data);
        if !table.is_empty() {
            found.push((kind, table));
        }
    }
    Ok(found)
}

pub fn build_catalog(game: &Path, database: &Path) -> Result<CatalogStats, ArchiveError> {
    if let Some(parent) = database.parent() {
        std::fs::create_dir_all(parent).map_err(|error| ArchiveError::Message(error.to_string()))?;
    }
    let index = Index::open(game)?;
    let mut connection = Connection::open(database).map_err(|error| ArchiveError::Message(error.to_string()))?;
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS names (
            kind TEXT NOT NULL,
            param_id INTEGER NOT NULL,
            lang TEXT NOT NULL,
            name TEXT NOT NULL,
            dlc INTEGER NOT NULL,
            PRIMARY KEY (kind, param_id, lang)
        );",
    ).map_err(|error| ArchiveError::Message(error.to_string()))?;

    let mut stats = CatalogStats { weapons: 0, armor: 0, talismans: 0, goods: 0, gems: 0, dlc_rows: 0 };
    let transaction = connection.transaction().map_err(|error| ArchiveError::Message(error.to_string()))?;
    for lang in ["porbr", "engus"] {
        for (file, dlc) in [("item.msgbnd.dcx", 0), ("item_dlc01.msgbnd.dcx", 1), ("item_dlc02.msgbnd.dcx", 1)] {
            let path = format!("/msg/{lang}/{file}");
            let Ok(bytes) = index.read(&path) else { continue };
            if bytes.len() > 40_000_000 {
                continue;
            }
            let tables = texts_in_bundle(&bytes, index.oodle.as_deref())?;
            let mut statement = transaction.prepare(
                "INSERT INTO names (kind, param_id, lang, name, dlc) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(kind, param_id, lang) DO UPDATE SET
                    name = CASE WHEN excluded.name = '' OR excluded.name LIKE '[%' OR excluded.name LIKE '%null%' THEN names.name ELSE excluded.name END,
                    dlc = MIN(names.dlc, excluded.dlc)",
            ).map_err(|error| ArchiveError::Message(error.to_string()))?;
            for (kind, table) in tables {
                for (id, name) in table {
                    statement.execute(params![kind, id, lang, name, dlc]).map_err(|error| ArchiveError::Message(error.to_string()))?;
                }
            }
        }
    }
    transaction.commit().map_err(|error| ArchiveError::Message(error.to_string()))?;
    let count = |kind: &str| -> u32 {
        connection.query_row(
            "SELECT COUNT(*) FROM names WHERE kind = ?1 AND lang = 'porbr'",
            [kind],
            |row| row.get(0),
        ).unwrap_or(0)
    };
    stats.weapons = count("weapon");
    stats.armor = count("armor");
    stats.talismans = count("talisman");
    stats.goods = count("goods");
    stats.gems = count("gem");
    stats.dlc_rows = connection.query_row("SELECT COUNT(*) FROM names WHERE dlc = 1 AND lang = 'porbr'", [], |row| row.get(0)).unwrap_or(0);
    Ok(stats)
}

pub fn all_names(database: &Path, lang: &str) -> Result<Vec<serde_json::Value>, ArchiveError> {
    let connection = Connection::open(database).map_err(|error| ArchiveError::Message(error.to_string()))?;
    let mut statement = connection.prepare(
        "SELECT kind, param_id, name, dlc FROM names
         WHERE lang = ?1 AND name <> '' AND name NOT LIKE '[%' AND name NOT LIKE '%null%'",
    ).map_err(|error| ArchiveError::Message(error.to_string()))?;
    let rows = statement.query_map(params![lang], |row| {
        Ok(serde_json::json!([
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i32>(3)?,
        ]))
    }).map_err(|error| ArchiveError::Message(error.to_string()))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| ArchiveError::Message(error.to_string()))
}

pub fn search(database: &Path, lang: &str, query: &str, limit: u32) -> Result<Vec<serde_json::Value>, ArchiveError> {
    let connection = Connection::open(database).map_err(|error| ArchiveError::Message(error.to_string()))?;
    let mut statement = connection.prepare(
        "SELECT kind, param_id, name, dlc FROM names
         WHERE lang = ?1 AND name LIKE ?2
         ORDER BY name LIMIT ?3",
    ).map_err(|error| ArchiveError::Message(error.to_string()))?;
    let pattern = format!("%{query}%");
    let rows = statement.query_map(params![lang, pattern, limit], |row| {
        Ok(serde_json::json!({
            "kind": row.get::<_, String>(0)?,
            "paramId": row.get::<_, i32>(1)?,
            "name": row.get::<_, String>(2)?,
            "dlc": row.get::<_, i32>(3)? == 1,
        }))
    }).map_err(|error| ArchiveError::Message(error.to_string()))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| ArchiveError::Message(error.to_string()))
}
