//! Gameplay tweaks written to `<game>/mod/regulation.bin` for ModEngine.
//! The game's own regulation.bin is only read. Every apply starts again from
//! the base file, so applying ×10 twice stays ×10.

use std::path::{Path, PathBuf};

use aes::cipher::generic_array::GenericArray;
use aes::cipher::{BlockEncrypt, KeyInit};
use serde::{Deserialize, Serialize};

use crate::archive::ArchiveError;
use crate::regulation::{decrypt, KEY};
use crate::{bnd4, decompress_dcx, find_oodle};

const DCX_HEADER: usize = 0x4C;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preset {
    pub runes: f64,
    pub drops: f64,
    /// 0 leaves every enemy with 1 HP.
    pub enemy_hp: f64,
    /// 0 removes enemy damage.
    pub enemy_damage: f64,
    pub free_upgrade: bool,
}

impl Default for Preset {
    fn default() -> Self {
        Self { runes: 1.0, drops: 1.0, enemy_hp: 1.0, enemy_damage: 1.0, free_upgrade: false }
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub npc_runes: usize,
    pub boss_runes: usize,
    pub npc_hp: usize,
    pub damage: usize,
    pub drops: usize,
    pub upgrade: usize,
    pub shops: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub original: String,
    pub target: String,
    pub has_original: bool,
    pub using_mod: bool,
    pub ours: bool,
    pub can_revert: bool,
    pub preset: Option<Preset>,
}

fn err(message: impl Into<String>) -> ArchiveError {
    ArchiveError::Message(message.into())
}

fn io(error: std::io::Error) -> ArchiveError {
    err(error.to_string())
}

fn paths(game: &Path) -> (PathBuf, PathBuf, PathBuf, PathBuf) {
    let target = game.join("mod").join("regulation.bin");
    let backup = game.join("mod").join("regulation.bin.editor-backup");
    let marker = game.join("mod").join("regulation.bin.editor.json");
    (game.join("regulation.bin"), target, backup, marker)
}

pub fn status(game: &Path) -> Status {
    let (original, target, backup, marker) = paths(game);
    let preset = std::fs::read_to_string(&marker).ok().and_then(|text| serde_json::from_str(&text).ok());
    Status {
        original: original.display().to_string(),
        target: target.display().to_string(),
        has_original: original.exists(),
        using_mod: target.exists(),
        ours: marker.exists(),
        can_revert: marker.exists() || backup.exists(),
        preset,
    }
}

struct Opened {
    encrypted: bool,
    iv: [u8; 16],
    header: Vec<u8>,
    plain: Vec<u8>,
}

fn open_file(file: &Path, game: &Path) -> Result<Opened, ArchiveError> {
    let raw = std::fs::read(file).map_err(io)?;
    let encrypted = !raw.starts_with(b"DCX\0");
    let iv: [u8; 16] = raw.get(..16).and_then(|bytes| bytes.try_into().ok()).ok_or_else(|| err("regulation.bin curto demais"))?;
    let dcx = if encrypted { decrypt(&raw) } else { raw };
    if !dcx.starts_with(b"DCX\0") || dcx.len() < DCX_HEADER {
        return Err(err("regulation.bin não abriu"));
    }
    if &dcx[0x28..0x2C] != b"ZSTD" {
        return Err(err("Este regulation.bin não usa ZSTD; o editor não sabe regravá-lo."));
    }
    let plain = decompress_dcx(&dcx, find_oodle(game).as_deref())?;
    Ok(Opened { encrypted, iv, header: dcx[..DCX_HEADER].to_vec(), plain })
}

fn seal(opened: &Opened, plain: &[u8]) -> Result<Vec<u8>, ArchiveError> {
    let compressed = zstd::encode_all(plain, 9).map_err(io)?;
    let mut dcx = opened.header.clone();
    dcx[0x1C..0x20].copy_from_slice(&(plain.len() as u32).to_be_bytes());
    dcx[0x20..0x24].copy_from_slice(&(compressed.len() as u32).to_be_bytes());
    dcx.extend_from_slice(&compressed);
    if !opened.encrypted {
        return Ok(dcx);
    }
    dcx.resize(dcx.len().div_ceil(16) * 16, 0);
    let cipher = aes::Aes256::new(GenericArray::from_slice(&KEY));
    let mut out = Vec::with_capacity(dcx.len() + 16);
    out.extend_from_slice(&opened.iv);
    let mut previous = opened.iv;
    for chunk in dcx.chunks_exact(16) {
        let mut block = [0u8; 16];
        for index in 0..16 {
            block[index] = chunk[index] ^ previous[index];
        }
        let mut block = GenericArray::from(block);
        cipher.encrypt_block(&mut block);
        previous.copy_from_slice(&block);
        out.extend_from_slice(&block);
    }
    Ok(out)
}

/// Visits every row of `<name>.param` and of `<name>_*.param`. The visitor gets one row
/// and returns whether it changed it.
fn each_row(plain: &mut [u8], name: &str, mut visit: impl FnMut(&mut [u8]) -> bool) -> Result<usize, ArchiveError> {
    let exact = format!("{name}.param");
    let prefix = format!("{name}_");
    let ranges: Vec<_> = bnd4::member_ranges(plain)?
        .into_iter()
        .filter(|(member, _)| {
            let base = member.rsplit(['\\', '/']).next().unwrap_or("");
            base == exact || (base.starts_with(&prefix) && base.ends_with(".param"))
        })
        .map(|(_, range)| range)
        .collect();
    let mut changed = 0;
    for range in ranges {
        let data = &mut plain[range];
        if data.len() < 0x40 {
            continue;
        }
        let count = u16::from_le_bytes([data[0x0A], data[0x0B]]) as usize;
        let mut rows = Vec::with_capacity(count);
        for index in 0..count {
            let at = 0x40 + index * 24;
            if at + 24 > data.len() {
                break;
            }
            let id = i32::from_le_bytes(data[at..at + 4].try_into().unwrap());
            let offset = u64::from_le_bytes(data[at + 8..at + 16].try_into().unwrap()) as usize;
            rows.push((id, offset));
        }
        let mut offsets: Vec<usize> = rows.iter().map(|(_, offset)| *offset).collect();
        offsets.sort_unstable();
        offsets.dedup();
        let Some(size) = offsets.windows(2).map(|pair| pair[1] - pair[0]).filter(|gap| *gap > 0).min() else { continue };
        for (id, offset) in rows {
            if id <= 0 || offset + size > data.len() {
                continue;
            }
            if visit(&mut data[offset..offset + size]) {
                changed += 1;
            }
        }
    }
    Ok(changed)
}

fn read_u32(row: &[u8], at: usize) -> Option<u32> {
    row.get(at..at + 4).map(|bytes| u32::from_le_bytes(bytes.try_into().unwrap()))
}

fn scale_u32(row: &mut [u8], at: usize, factor: f64, min: u32) -> bool {
    let Some(value) = read_u32(row, at) else { return false };
    if value == 0 || value == u32::MAX {
        return false;
    }
    let next = ((value as f64) * factor).round().clamp(min as f64, 999_999_999.0) as u32;
    if next == value {
        return false;
    }
    row[at..at + 4].copy_from_slice(&next.to_le_bytes());
    true
}

fn scale_u16(row: &mut [u8], at: usize, factor: f64, min: u16) -> bool {
    let Some(bytes) = row.get(at..at + 2) else { return false };
    let value = u16::from_le_bytes([bytes[0], bytes[1]]);
    if value == 0 {
        return false;
    }
    let next = ((value as f64) * factor).round().clamp(min as f64, u16::MAX as f64) as u16;
    if next == value {
        return false;
    }
    row[at..at + 2].copy_from_slice(&next.to_le_bytes());
    true
}

/// Field offsets checked against the installed regulation: NpcParam hp +36 and runes +44,
/// GameAreaParam boss runes +4/+8, ShopLineupParam price +4, EquipMtrlSetParam counts +32.
pub fn apply_preset(plain: &mut [u8], preset: &Preset) -> Result<Counts, ArchiveError> {
    let mut counts = Counts::default();
    if preset.runes != 1.0 {
        counts.npc_runes = each_row(plain, "NpcParam", |row| scale_u32(row, 44, preset.runes, 1))?;
        counts.boss_runes = each_row(plain, "GameAreaParam", |row| {
            let single = scale_u32(row, 4, preset.runes, 1);
            let multi = scale_u32(row, 8, preset.runes, 1);
            single || multi
        })?;
    }
    if preset.enemy_hp != 1.0 {
        counts.npc_hp = each_row(plain, "NpcParam", |row| {
            if preset.enemy_hp > 0.0 {
                return scale_u32(row, 36, preset.enemy_hp, 1);
            }
            match read_u32(row, 36) {
                Some(value) if value > 1 => {
                    row[36..40].copy_from_slice(&1u32.to_le_bytes());
                    true
                }
                _ => false,
            }
        })?;
    }
    if preset.enemy_damage != 1.0 {
        counts.damage = each_row(plain, "AtkParam_Npc", |row| {
            let mut changed = false;
            for at in [80, 82, 84, 86] {
                if at + 2 > row.len() {
                    continue;
                }
                if preset.enemy_damage > 0.0 {
                    changed |= scale_u16(row, at, preset.enemy_damage, 1);
                } else if row[at] != 0 || row[at + 1] != 0 {
                    row[at..at + 2].fill(0);
                    changed = true;
                }
            }
            changed
        })?;
    }
    if preset.drops != 1.0 {
        counts.drops = each_row(plain, "ItemLotParam", |row| {
            if row.len() < 146 {
                return false;
            }
            let mut changed = false;
            for slot in 0..8 {
                let id = i32::from_le_bytes(row[slot * 4..slot * 4 + 4].try_into().unwrap());
                let num = row[138 + slot];
                if id <= 0 || num == 0 {
                    continue;
                }
                let next = ((num as f64) * preset.drops).round().clamp(1.0, 255.0) as u8;
                if next != num {
                    row[138 + slot] = next;
                    changed = true;
                }
            }
            changed
        })?;
    }
    if preset.free_upgrade {
        counts.upgrade = each_row(plain, "EquipMtrlSetParam", |row| {
            if row.len() < 38 {
                return false;
            }
            let mut changed = false;
            for slot in 0..6 {
                let id = i32::from_le_bytes(row[slot * 4..slot * 4 + 4].try_into().unwrap());
                let num = row[32 + slot] as i8;
                if id > 0 && num > 1 {
                    row[32 + slot] = 1;
                    changed = true;
                }
            }
            changed
        })?;
        counts.shops = each_row(plain, "ShopLineupParam", |row| {
            let Some(bytes) = row.get(4..8) else { return false };
            if i32::from_le_bytes(bytes.try_into().unwrap()) <= 1 {
                return false;
            }
            row[4..8].copy_from_slice(&1i32.to_le_bytes());
            true
        })?;
    }
    Ok(counts)
}

/// Builds the modded file from `base` without writing anything.
pub fn build(base: &Path, game: &Path, preset: &Preset) -> Result<(Vec<u8>, Counts), ArchiveError> {
    let opened = open_file(base, game)?;
    let mut plain = opened.plain.clone();
    let counts = apply_preset(&mut plain, preset)?;
    let sealed = seal(&opened, &plain)?;
    if open_bytes_check(&sealed, game)? != plain {
        return Err(err("O regulation regravado não confere. Nada foi gravado."));
    }
    Ok((sealed, counts))
}

pub fn apply(game: &Path, preset: &Preset) -> Result<Counts, ArchiveError> {
    let (original, target, backup, marker) = paths(game);
    if !original.exists() {
        return Err(err("regulation.bin não encontrado na pasta do jogo."));
    }
    std::fs::create_dir_all(target.parent().unwrap()).map_err(io)?;
    if target.exists() && !marker.exists() && !backup.exists() {
        std::fs::copy(&target, &backup).map_err(io)?;
    }
    let base = if backup.exists() { backup.clone() } else { original };
    let (sealed, counts) = build(&base, game, preset)?;
    let temp = target.with_extension("bin.tmp");
    std::fs::write(&temp, &sealed).map_err(io)?;
    std::fs::rename(&temp, &target).map_err(io)?;
    std::fs::write(&marker, serde_json::to_string(preset).unwrap_or_default()).map_err(io)?;
    Ok(counts)
}

fn open_bytes_check(sealed: &[u8], game: &Path) -> Result<Vec<u8>, ArchiveError> {
    let dcx = if sealed.starts_with(b"DCX\0") { sealed.to_vec() } else { decrypt(sealed) };
    decompress_dcx(&dcx, find_oodle(game).as_deref())
}

/// Puts the mod folder back the way it was before the editor wrote to it.
pub fn revert(game: &Path) -> Result<(), ArchiveError> {
    let (_, target, backup, marker) = paths(game);
    if backup.exists() {
        std::fs::copy(&backup, &target).map_err(io)?;
        std::fs::remove_file(&backup).map_err(io)?;
    } else if marker.exists() {
        if target.exists() {
            std::fs::remove_file(&target).map_err(io)?;
        }
    } else {
        return Err(err("O editor não gravou nenhum regulation nesta pasta."));
    }
    if marker.exists() {
        std::fs::remove_file(&marker).map_err(io)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaling_respects_limits() {
        let mut row = vec![0u8; 8];
        row[0..4].copy_from_slice(&500u32.to_le_bytes());
        assert!(scale_u32(&mut row, 0, 10.0, 1));
        assert_eq!(read_u32(&row, 0), Some(5000));
        row[4..6].copy_from_slice(&60000u16.to_le_bytes());
        assert!(scale_u16(&mut row, 4, 10.0, 1));
        assert_eq!(u16::from_le_bytes([row[4], row[5]]), u16::MAX);
    }
}
