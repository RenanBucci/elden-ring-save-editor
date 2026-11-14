#![cfg(feature = "private-fixtures")]
use std::path::PathBuf;

use er_save::slot::{read_equipped, Equipped};
use er_save::{apply_with, open_bytes, ApplyRequest, CopyBuild, WritePolicy};

fn sample() -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../Save/ER0000.sl2");
    std::fs::read(&path).unwrap_or_else(|_| panic!("save de exemplo ausente em {}", path.display()))
}

fn equipped(opened: &er_save::OpenedSave, index: usize) -> Vec<Equipped> {
    let entry = &opened.save.entries[index];
    let data = &opened.save.buffer[entry.payload_offset..entry.payload_offset + entry.payload_size];
    read_equipped(data, opened.slots[index].layout.as_ref().unwrap())
}

#[test]
fn copies_stats_look_gear_and_spells_between_characters() {
    let original = sample();
    let before = open_bytes(&original).unwrap();
    let playable: Vec<usize> = (0..10).filter(|index| before.slots[*index].player.is_some() && !before.slots[*index].read_only).collect();
    assert!(playable.len() >= 2, "o save de exemplo precisa de dois personagens editáveis");
    let (from, to) = (playable[0], playable[1]);

    let request = ApplyRequest {
        slot: to,
        copy_build: Some(CopyBuild { from, stats: true, appearance: true, equipment: true, spells: true }),
        ..Default::default()
    };
    let next = apply_with(&original, &request, WritePolicy { sync_profile: true, refresh_hash: true }).unwrap();
    let after = open_bytes(&next).unwrap();

    let source = before.slots[from].player.as_ref().unwrap();
    let target = after.slots[to].player.as_ref().unwrap();
    assert_eq!(target.stats, source.stats);
    assert_eq!(target.class_id, source.class_id);
    assert_eq!(target.name, before.slots[to].player.as_ref().unwrap().name);
    assert!(after.slots[to].consistent);

    let source_gear = equipped(&before, from);
    let target_gear = equipped(&after, to);
    let slot = &after.slots[to];
    for (index, (wanted, got)) in source_gear.iter().zip(target_gear.iter()).enumerate() {
        assert_eq!(wanted.is_empty(), got.is_empty(), "posição {index}");
        if wanted.is_empty() {
            continue;
        }
        assert_eq!(got.item_id, wanted.item_id, "posição {index}");
        let position = got.index as usize - 0x180;
        assert_eq!(slot.inventory.common[position].handle, got.handle, "posição {index} aponta para a bolsa errada");
    }

    let entry = &after.save.entries[to];
    let data = &after.save.buffer[entry.payload_offset..entry.payload_offset + entry.payload_size];
    let source_entry = &before.save.entries[from];
    let source_data = &before.save.buffer[source_entry.payload_offset..source_entry.payload_offset + source_entry.payload_size];
    let source_layout = before.slots[from].layout.as_ref().unwrap();
    let layout = slot.layout.as_ref().unwrap();
    assert_eq!(&data[layout.spells..layout.spells + 0x74], &source_data[source_layout.spells..source_layout.spells + 0x74]);
    assert_eq!(&data[layout.face..layout.face + 0x12F], &source_data[source_layout.face..source_layout.face + 0x12F]);

    assert_eq!(after.slots[from].player.as_ref().unwrap().name, source.name);
    for other in (0..10).filter(|index| *index != to) {
        assert_eq!(
            after.save.buffer[after.save.entries[other].payload_offset..after.save.entries[other].payload_offset + after.save.entries[other].payload_size],
            before.save.buffer[before.save.entries[other].payload_offset..before.save.entries[other].payload_offset + before.save.entries[other].payload_size],
            "slot {other} mudou"
        );
    }
}
