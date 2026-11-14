#![cfg(feature = "private-fixtures")]
use std::path::PathBuf;

use er_save::{hash::{compute_hash, find_hash_offset}, open_bytes};

#[test]
fn game_written_hash_matches_the_formula() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../Save/ER0000.sl2");
    let bytes = std::fs::read(&path).expect("save de exemplo");
    let opened = open_bytes(&bytes).unwrap();
    let entry = &opened.save.entries[0];
    let data = &opened.save.buffer[entry.payload_offset..entry.payload_offset + entry.payload_size];
    let slot = &opened.slots[0];
    let offset = find_hash_offset(data, slot).expect("hash do personagem");
    let layout = slot.layout.as_ref().unwrap();
    let words = compute_hash(data, layout, layout.pgd);
    for index in [0, 1, 2, 3, 5, 6, 7, 8, 10] {
        let at = offset + index * 4;
        let stored = u32::from_le_bytes(data[at..at + 4].try_into().unwrap());
        assert_eq!(stored, words[index], "entrada {index} em 0x{offset:x}");
    }
}
