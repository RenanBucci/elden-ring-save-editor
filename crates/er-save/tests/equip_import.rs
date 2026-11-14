#![cfg(feature = "private-fixtures")]
use std::path::PathBuf;

use er_save::session::EquipChange;
use er_save::slot::read_equipped;
use er_save::{apply_with, open_bytes, ApplyRequest, CharacterPatch, SlotOp, WritePolicy};

const POLICY: WritePolicy = WritePolicy { sync_profile: true, refresh_hash: true };

#[test]
fn rejects_stat_underflow_and_round_trips_level_boundaries() {
    let original = sample();
    let request = |stats| ApplyRequest {
        slot: 0,
        character: Some(CharacterPatch { stats: Some(stats), ..Default::default() }),
        ..Default::default()
    };
    let error = apply_with(&original, &request([1; 8]), POLICY).unwrap_err();
    assert!(error.to_string().contains("pelo menos 80"));
    for (stats, level) in [([10; 8], 1), ([99; 8], 713), ([u32::MAX; 8], 713)] {
        let edited = apply_with(&original, &request(stats), POLICY).unwrap();
        let parsed = open_bytes(&edited).unwrap();
        assert_eq!(parsed.slots[0].player.as_ref().unwrap().level, level);
        assert!(parsed.slots[0].consistent);
    }
}

fn sample() -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../Save/ER0000.sl2");
    std::fs::read(&path).unwrap_or_else(|_| panic!("save de exemplo ausente em {}", path.display()))
}

fn payload(opened: &er_save::OpenedSave, index: usize) -> &[u8] {
    let entry = &opened.save.entries[index];
    &opened.save.buffer[entry.payload_offset..entry.payload_offset + entry.payload_size]
}

fn editable(opened: &er_save::OpenedSave) -> Vec<usize> {
    (0..10).filter(|index| opened.slots[*index].player.is_some() && !opened.slots[*index].read_only).collect()
}

#[test]
fn equips_a_bag_weapon_and_clears_the_old_slot() {
    let original = sample();
    let before = open_bytes(&original).unwrap();
    let slot = editable(&before)[0];
    let parsed = &before.slots[slot];
    let layout = parsed.layout.as_ref().unwrap();
    let gear = read_equipped(payload(&before, slot), layout);
    let weapon = parsed.inventory.common.iter()
        .find(|item| item.handle >> 28 == 0x8 && !gear.iter().any(|equipped| equipped.handle == item.handle) && item.handle != 0 && item.handle != u32::MAX)
        .expect("uma arma na bolsa que não esteja equipada");

    let request = ApplyRequest { slot, equip: vec![EquipChange { index: 3, handle: weapon.handle }], ..Default::default() };
    let next = apply_with(&original, &request, POLICY).unwrap();
    let after = open_bytes(&next).unwrap();
    let now = read_equipped(payload(&after, slot), after.slots[slot].layout.as_ref().unwrap());
    assert_eq!(now[3].handle, weapon.handle);
    assert_eq!(after.slots[slot].inventory.common[now[3].index as usize - 0x180].handle, weapon.handle);

    let request = ApplyRequest { slot, equip: vec![EquipChange { index: 5, handle: weapon.handle }], ..Default::default() };
    let moved = open_bytes(&apply_with(&next, &request, POLICY).unwrap()).unwrap();
    let gear = read_equipped(payload(&moved, slot), moved.slots[slot].layout.as_ref().unwrap());
    assert_eq!(gear[5].handle, weapon.handle);
    assert!(gear[3].is_empty(), "o mesmo item não pode ficar em dois espaços");

    let request = ApplyRequest { slot, equip: vec![EquipChange { index: 5, handle: 0 }], ..Default::default() };
    let cleared = open_bytes(&apply_with(&next, &request, POLICY).unwrap()).unwrap();
    assert!(read_equipped(payload(&cleared, slot), cleared.slots[slot].layout.as_ref().unwrap())[5].is_empty());
}

#[test]
fn renaming_does_not_touch_level_or_stats() {
    let original = sample();
    let before = open_bytes(&original).unwrap();
    let slot = editable(&before)[0];
    let player = before.slots[slot].player.clone().unwrap();
    let request = ApplyRequest { slot, character: Some(CharacterPatch { name: Some("Teste".into()), ..Default::default() }), ..Default::default() };
    let after = open_bytes(&apply_with(&original, &request, POLICY).unwrap()).unwrap();
    let now = after.slots[slot].player.as_ref().unwrap();
    assert_eq!(now.name, "Teste");
    assert_eq!(now.level, player.level);
    assert_eq!(now.stats, player.stats);
}

#[test]
fn imports_an_exported_slot_and_a_whole_save() {
    let original = sample();
    let before = open_bytes(&original).unwrap();
    let from = editable(&before)[0];
    let empty = (0..10).find(|index| before.slots[*index].empty).expect("um slot vazio no save de exemplo");
    let exported = payload(&before, from).to_vec();

    for bytes in [exported.clone(), original.clone()] {
        let request = ApplyRequest {
            slot: empty,
            slot_ops: vec![SlotOp::Import { to: empty, from: None, bytes }],
            ..Default::default()
        };
        let after = open_bytes(&apply_with(&original, &request, POLICY).unwrap()).unwrap();
        let imported = after.slots[empty].player.as_ref().expect("personagem importado legível");
        let source = before.slots[from].player.as_ref().unwrap();
        assert_eq!(imported.name, source.name);
        assert_eq!(imported.stats, source.stats);
        for other in (0..10).filter(|index| *index != empty) {
            assert_eq!(payload(&after, other), payload(&before, other), "slot {other} mudou");
        }
    }

    let junk = ApplyRequest { slot: empty, slot_ops: vec![SlotOp::Import { to: empty, from: None, bytes: vec![1, 2, 3] }], ..Default::default() };
    assert!(apply_with(&original, &junk, POLICY).is_err());
}

#[test]
fn rejects_invalid_character_references_without_panicking() {
    let bytes = sample();
    let mut requests = vec![
        ApplyRequest { slot: usize::MAX, ..Default::default() },
        ApplyRequest { copy_face_from: Some(10), ..Default::default() },
        ApplyRequest { copy_build: Some(er_save::CopyBuild { from: 10, ..Default::default() }), ..Default::default() },
    ];
    for op in [SlotOp::Delete { slot: 10 }, SlotOp::Clone { from: 10, to: 0 },
        SlotOp::Move { from: 0, to: 10 }, SlotOp::Swap { a: 0, b: 10 },
        SlotOp::Import { to: 10, from: None, bytes: vec![] }] {
        requests.push(ApplyRequest { slot_ops: vec![op], ..Default::default() });
    }
    for request in requests {
        assert!(apply_with(&bytes, &request, POLICY).unwrap_err().to_string().contains("Slot inexistente"));
    }
}
