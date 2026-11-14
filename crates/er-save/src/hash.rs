//! PlayerGameDataHash. The game rewrites these 11 words on every save.
//! Entry 4, entry 9 and the uninitialized tail are left untouched.

use crate::constants::EVENT_FLAG_BYTES;
use crate::slot::{CharacterSlot, Layout};

fn reduce(value: u32) -> u32 {
    let quotient = ((0x8007_8071u128 * u128::from(value)) >> 32) as u32 >> 15;
    value.wrapping_sub(quotient.wrapping_mul(0xFFF1))
}

fn bytes_hash(data: &[u8]) -> u32 {
    let mut lo = 1u32;
    let mut hi = 0u32;
    for byte in data {
        lo = lo.wrapping_add(u32::from(*byte));
        hi = hi.wrapping_add(lo);
    }
    (reduce(lo) | (reduce(hi) << 16)).wrapping_mul(2)
}

fn u32s_hash(values: &[u32]) -> u32 {
    let mut bytes = Vec::with_capacity(values.len() * 4);
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes_hash(&bytes)
}

/// Walks the variable tail and returns the file offset of the 0x80 hash block.
pub fn find_hash_offset(data: &[u8], slot: &CharacterSlot) -> Option<usize> {
    if slot.event_flags == 0 || slot.event_flags + EVENT_FLAG_BYTES + 1 > data.len() {
        return None;
    }
    let mut cursor = slot.event_flags + EVENT_FLAG_BYTES + 1;
    for _ in 0..5 {
        if cursor + 4 > data.len() {
            return None;
        }
        let size = u32::from_le_bytes(data[cursor..cursor + 4].try_into().ok()?) as usize;
        if size > 0x10_0000 {
            return None;
        }
        cursor += 4 + size;
    }
    cursor += 0x3D + 2 + 4 + 4;
    if slot.version >= 65 {
        cursor += 4;
    }
    if slot.version >= 66 {
        cursor += 1;
    }
    cursor += 0x20004 + 0x0C + 0x0C + 0x10 + 8 + 0x20 + 0x32;
    if cursor + 0x80 > data.len() {
        return None;
    }
    Some(cursor)
}

const WEAPON_SLOTS: [usize; 10] = [0, 2, 4, 1, 3, 5, 6, 8, 7, 9];
const ARMOR_SLOTS: [usize; 9] = [12, 13, 14, 15, 17, 18, 19, 20, 21];

fn ru32(data: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(data[at..at + 4].try_into().unwrap())
}

pub fn compute_hash(data: &[u8], layout: &Layout, pgd: usize) -> [u32; 11] {
    let mut words = [0u32; 11];
    words[0] = u32s_hash(&[ru32(data, pgd + 0x60)]);
    words[1] = bytes_hash(&data[pgd + 0x34..pgd + 0x34 + 36]);
    words[2] = u32s_hash(&[u32::from(data[pgd + 0xB7])]);
    words[3] = bytes_hash(&[data[pgd + 0xB8]]);
    words[5] = u32s_hash(&[ru32(data, pgd + 0x64)]);
    words[6] = u32s_hash(&[ru32(data, pgd + 0x68)]);
    let weapons: Vec<u32> = WEAPON_SLOTS.iter().map(|slot| ru32(data, layout.item_ids + slot * 4)).collect();
    words[7] = u32s_hash(&weapons);
    let armor: Vec<u32> = ARMOR_SLOTS.iter().map(|slot| ru32(data, layout.item_ids + slot * 4)).collect();
    words[8] = u32s_hash(&armor);
    let spells: Vec<u32> = (0..14).map(|index| ru32(data, layout.spells + index * 8)).collect();
    words[10] = u32s_hash(&spells);
    words
}

pub fn refresh_hash(data: &mut [u8], slot: &CharacterSlot) -> bool {
    let Some(layout) = &slot.layout else { return false };
    let Some(offset) = find_hash_offset(data, slot) else { return false };
    let words = compute_hash(data, layout, layout.pgd);
    let mut changed = false;
    for (index, word) in words.iter().enumerate() {
        if index == 4 || index == 9 {
            continue;
        }
        let at = offset + index * 4;
        let next = word.to_le_bytes();
        if data[at..at + 4] != next {
            data[at..at + 4].copy_from_slice(&next);
            changed = true;
        }
    }
    changed
}
