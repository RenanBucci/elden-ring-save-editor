//! regulation.bin: AES-256-CBC around a DCX around a BND4 of PARAM files.

use std::path::Path;

use aes::cipher::generic_array::GenericArray;
use aes::cipher::{BlockDecrypt, KeyInit};

use crate::archive::ArchiveError;
use crate::{bnd4, decompress_dcx, find_oodle};

pub(crate) const KEY: [u8; 32] = [
    0x99, 0xbf, 0xfc, 0x36, 0x6a, 0x6b, 0xc8, 0xc6, 0xf5, 0x82, 0x7d, 0x09, 0x36, 0x02, 0xd6, 0x76,
    0xc4, 0x28, 0x92, 0xa0, 0x1c, 0x20, 0x7f, 0xb0, 0x24, 0xd3, 0xaf, 0x4e, 0x49, 0x3f, 0xef, 0x99,
];

pub(crate) fn decrypt(raw: &[u8]) -> Vec<u8> {
    let cipher = aes::Aes256::new(GenericArray::from_slice(&KEY));
    let mut previous: [u8; 16] = raw[..16].try_into().unwrap();
    let mut out = Vec::with_capacity(raw.len() - 16);
    for chunk in raw[16..].chunks_exact(16) {
        let mut block = GenericArray::clone_from_slice(chunk);
        cipher.decrypt_block(&mut block);
        for (index, byte) in block.iter().enumerate() {
            out.push(byte ^ previous[index]);
        }
        previous.copy_from_slice(chunk);
    }
    out
}

/// Returns the plain BND4 that holds every `.param` file.
pub fn open(game: &Path) -> Result<Vec<u8>, ArchiveError> {
    let raw = std::fs::read(game.join("regulation.bin")).map_err(|error| ArchiveError::Message(error.to_string()))?;
    let dcx = if raw.starts_with(b"DCX\0") { raw } else { decrypt(&raw) };
    if !dcx.starts_with(b"DCX\0") {
        return Err(ArchiveError::Message("regulation.bin não abriu".into()));
    }
    decompress_dcx(&dcx, find_oodle(game).as_deref())
}

pub struct Param {
    pub data: Vec<u8>,
    pub rows: Vec<(i64, usize)>,
}

impl Param {
    pub fn row(&self, id: i64) -> Option<&[u8]> {
        let position = self.rows.iter().position(|(row, _)| *row == id)?;
        let start = self.rows[position].1;
        let end = self.rows.iter().map(|(_, offset)| *offset).filter(|offset| *offset > start).min().unwrap_or(self.data.len());
        Some(&self.data[start..end])
    }
}

pub fn param(plain: &[u8], name: &str) -> Result<Param, ArchiveError> {
    let wanted = format!("{name}.param");
    let member = bnd4::members(plain)?
        .into_iter()
        .find(|member| member.name.rsplit(['\\', '/']).next() == Some(wanted.as_str()))
        .ok_or_else(|| ArchiveError::Message(format!("{wanted} ausente do regulation.bin")))?;
    let data = member.data;
    if data.len() < 0x40 {
        return Err(ArchiveError::Message(format!("{wanted} curto demais")));
    }
    let count = u16::from_le_bytes([data[0x0A], data[0x0B]]) as usize;
    let mut rows = Vec::with_capacity(count);
    for index in 0..count {
        let at = 0x40 + index * 24;
        if at + 24 > data.len() {
            break;
        }
        let id = i32::from_le_bytes(data[at..at + 4].try_into().unwrap()) as i64;
        let offset = u64::from_le_bytes(data[at + 8..at + 16].try_into().unwrap()) as usize;
        if offset < data.len() {
            rows.push((id, offset));
        }
    }
    Ok(Param { data, rows })
}
