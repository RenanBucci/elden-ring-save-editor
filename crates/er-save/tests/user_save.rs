//! Runs only when ER_USER_SAVE points at a real save. Nothing is written to disk.

use er_save::slot::{flag_is_on, slack};
use er_save::{apply_with, open_bytes, AddedItem, ApplyRequest, WritePolicy};

#[test]
fn every_kit_applies_to_a_real_character() {
    let (Ok(path), Ok(kits)) = (std::env::var("ER_USER_SAVE"), std::env::var("ER_KITS")) else { return };
    let original = std::fs::read(path).unwrap();
    let kits: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(kits).unwrap()).unwrap();
    let opened = open_bytes(&original).unwrap();
    let slot = &opened.slots[0];
    let has = |handle: u32| slot.inventory.common.iter().chain(slot.storage.common.iter()).any(|item| item.handle == handle);
    for kit in kits.as_array().unwrap() {
        let add: Vec<AddedItem> = kit["add"].as_array().unwrap().iter().filter_map(|item| {
            let kind = item["kind"].as_str().unwrap().to_string();
            let param_id = item["paramId"].as_u64().unwrap() as u32;
            if kind == "talisman" && has(0xA000_0000 | param_id) {
                return None;
            }
            Some(AddedItem { kind, param_id, quantity: item["quantity"].as_u64().unwrap() as u32, max_num: item["maxNum"].as_u64().unwrap() as u32 })
        }).collect();
        let count = add.len();
        let next = apply_with(&original, &ApplyRequest { slot: 0, add, ..Default::default() }, WritePolicy { sync_profile: true, refresh_hash: true })
            .unwrap_or_else(|error| panic!("kit {}: {error}", kit["id"]));
        let after = open_bytes(&next).unwrap();
        assert!(!after.slots[0].read_only, "kit {}", kit["id"]);
        println!("kit {} ok ({count} itens)", kit["id"]);
    }
}

#[test]
fn adds_every_item_kind_to_a_real_character() {
    let Ok(path) = std::env::var("ER_USER_SAVE") else { return };
    let original = std::fs::read(path).unwrap();
    let before = open_bytes(&original).unwrap();
    let slot = &before.slots[0];
    let entry = &before.save.entries[0];
    let data = &before.save.buffer[entry.payload_offset..entry.payload_offset + entry.payload_size];
    let room = slack(data, slot);
    println!("folga do slot: {room} bytes");
    assert!(room >= 21);
    let graces_before = flag_is_on(data, slot, 71000);

    let request = ApplyRequest {
        slot: 0,
        add: vec![
            AddedItem { kind: "weapon".into(), param_id: 2_000_000, quantity: 1, max_num: 1 },
            AddedItem { kind: "armor".into(), param_id: 140_000, quantity: 1, max_num: 1 },
            AddedItem { kind: "ash".into(), param_id: 10_000, quantity: 1, max_num: 1 },
            AddedItem { kind: "goods".into(), param_id: 2_130, quantity: 5, max_num: 99 },
        ],
        ..Default::default()
    };
    let next = apply_with(&original, &request, WritePolicy { sync_profile: true, refresh_hash: true }).unwrap();
    let after = open_bytes(&next).unwrap();
    let slot = &after.slots[0];
    assert!(!slot.read_only, "{:?}", slot.warning);
    assert_eq!(slot.player.as_ref().unwrap().name, before.slots[0].player.as_ref().unwrap().name);
    let entry = &after.save.entries[0];
    let data = &after.save.buffer[entry.payload_offset..entry.payload_offset + entry.payload_size];
    assert_eq!(flag_is_on(data, slot, 71000), graces_before);
    assert!(slot.records.iter().any(|record| record.handle >> 28 == 0x8 && record.item_id == 2_000_000));
    assert!(slot.records.iter().any(|record| record.handle >> 28 == 0x9 && record.item_id == 0x1000_0000 | 140_000));
    assert!(slot.records.iter().any(|record| record.handle >> 28 == 0xC && record.item_id == 0x8000_0000 | 10_000));
    assert!(slot.inventory.common.iter().chain(slot.inventory.key.iter()).any(|item| item.handle == 0xB000_0000 | 2_130));
    let added = slot.inventory.common.iter().filter(|item| item.handle >> 28 == 0x8 || item.handle >> 28 == 0x9 || item.handle >> 28 == 0xC).count();
    let had = before.slots[0].inventory.common.iter().filter(|item| item.handle >> 28 == 0x8 || item.handle >> 28 == 0x9 || item.handle >> 28 == 0xC).count();
    assert_eq!(added, had + 3);
    for other in 1..10 {
        assert_eq!(after.slots[other].player.as_ref().map(|p| p.name.clone()), before.slots[other].player.as_ref().map(|p| p.name.clone()));
    }
}
