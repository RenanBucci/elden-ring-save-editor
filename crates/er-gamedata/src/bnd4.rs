//! BND4 member list. Elden Ring containers keep the file count at 0x0C.

use crate::archive::ArchiveError;

#[derive(Debug, Clone)]
pub struct Member {
    pub name: String,
    pub data: Vec<u8>,
}

pub fn members(buf: &[u8]) -> Result<Vec<Member>, ArchiveError> {
    Ok(member_ranges(buf)?
        .into_iter()
        .map(|(name, range)| Member { name, data: buf[range].to_vec() })
        .collect())
}

/// Same as [`members`] but returns where each file lives, so it can be edited in place.
pub fn member_ranges(buf: &[u8]) -> Result<Vec<(String, std::ops::Range<usize>)>, ArchiveError> {
    if buf.len() < 0x40 || &buf[..4] != b"BND4" {
        return Err(ArchiveError::Message("não é BND4".into()));
    }
    let count = u32::from_le_bytes(buf[0x0C..0x10].try_into().unwrap()) as usize;
    let entry_size = u32::from_le_bytes(buf[0x20..0x24].try_into().unwrap()).max(0x18) as usize;
    let unicode = buf[0x30] != 0;
    let mut files = Vec::new();
    for index in 0..count {
        let at = 0x40 + index * entry_size;
        if at + 0x24 > buf.len() {
            break;
        }
        let size = u64::from_le_bytes(buf[at + 8..at + 16].try_into().unwrap()) as usize;
        let data_off = u32::from_le_bytes(buf[at + 0x18..at + 0x1C].try_into().unwrap()) as usize;
        let name_off = u32::from_le_bytes(buf[at + 0x20..at + 0x24].try_into().unwrap()) as usize;
        if data_off.saturating_add(size) > buf.len() || name_off >= buf.len() {
            continue;
        }
        let name = if unicode { read_utf16(buf, name_off) } else { read_ascii(buf, name_off) };
        files.push((name, data_off..data_off + size));
    }
    Ok(files)
}

fn read_utf16(buf: &[u8], offset: usize) -> String {
    let mut text = String::new();
    let mut cursor = offset;
    while cursor + 1 < buf.len() {
        let code = u16::from_le_bytes([buf[cursor], buf[cursor + 1]]);
        if code == 0 {
            break;
        }
        text.push(char::from_u32(u32::from(code)).unwrap_or('\u{FFFD}'));
        cursor += 2;
    }
    text
}

fn read_ascii(buf: &[u8], offset: usize) -> String {
    buf[offset..].iter().take_while(|byte| **byte != 0).map(|byte| *byte as char).collect()
}
