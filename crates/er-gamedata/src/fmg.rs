//! FMG text tables. Elden Ring uses version 2: groups of 16 bytes and 8-byte string offsets.

use std::collections::HashMap;

pub fn parse(buf: &[u8]) -> HashMap<i32, String> {
    let mut names = HashMap::new();
    if buf.len() < 0x1C {
        return names;
    }
    let big_endian = buf[1] != 0;
    let version = buf[2];
    let i32_at = |offset: usize| -> i32 {
        let bytes: [u8; 4] = buf[offset..offset + 4].try_into().unwrap_or([0; 4]);
        if big_endian { i32::from_be_bytes(bytes) } else { i32::from_le_bytes(bytes) }
    };
    let group_count = i32_at(0x0C);
    let string_count = i32_at(0x10);
    if !(1..=100_000).contains(&group_count) || !(1..=500_000).contains(&string_count) {
        return names;
    }
    let (groups_start, group_size, str_off_size, str_offsets_start) = if version >= 2 {
        (0x28usize, 16usize, 8usize, i32_at(0x18))
    } else {
        (0x1C, 12, 4, -1)
    };
    let mut groups = Vec::new();
    let mut cursor = groups_start;
    for _ in 0..group_count {
        if cursor + group_size > buf.len() {
            break;
        }
        let (first_index, first_id, last_id) = if version >= 2 {
            (i32_at(cursor), i32_at(cursor + 4), i32_at(cursor + 8))
        } else {
            (i32_at(cursor + 8), i32_at(cursor), i32_at(cursor + 4))
        };
        groups.push((first_index, first_id, last_id));
        cursor += group_size;
    }
    let mut offset_cursor = if str_offsets_start > 0 { str_offsets_start as usize } else { cursor };
    let mut string_offsets = Vec::with_capacity(string_count as usize);
    for _ in 0..string_count {
        if offset_cursor + str_off_size > buf.len() {
            break;
        }
        let value = if str_off_size == 8 {
            let bytes: [u8; 8] = buf[offset_cursor..offset_cursor + 8].try_into().unwrap();
            if big_endian { i64::from_be_bytes(bytes) } else { i64::from_le_bytes(bytes) }
        } else {
            i64::from(i32_at(offset_cursor))
        };
        string_offsets.push(value);
        offset_cursor += str_off_size;
    }
    for (first_index, first_id, last_id) in groups {
        if first_id < 0 || last_id < first_id || last_id - first_id > 100_000 {
            continue;
        }
        for id in first_id..=last_id {
            let index = first_index + (id - first_id);
            if index < 0 || index as usize >= string_offsets.len() {
                continue;
            }
            let str_off = string_offsets[index as usize];
            if str_off <= 0 || str_off as usize >= buf.len() {
                continue;
            }
            let text = read_utf16(buf, str_off as usize);
            if !text.is_empty() && !text.contains("[ERROR]") {
                names.insert(id, text);
            }
        }
    }
    names
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
        if text.len() > 400 {
            break;
        }
    }
    text
}
