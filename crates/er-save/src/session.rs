use crate::constants::{EVENT_FLAG_BYTES, FACE, KEY_SLOTS, SLOT_PAYLOAD, SPELLS, UD10_PROFILE_STRIDE};
use crate::container::{checksum_ok, parse_container, payload_range, to_file_buffer, SaveFile};
use crate::error::{SaveError, SaveResult};
use crate::hash::refresh_hash;
use crate::slot::{
    active_flag, add_physical, add_stackable, apply_character, clear_payload, face_ok, parse_slot,
    active_slots_range, occupied, profile_offset, read_equipped, remove_physical, set_active, set_flag, set_quantity,
    sync_profile, transform_record, write_equipped, write_face, CharacterPatch, CharacterSlot, Equipped,
};

#[derive(Debug, Clone)]
pub enum SlotOp {
    Delete { slot: usize },
    Clone { from: usize, to: usize },
    Move { from: usize, to: usize },
    Swap { a: usize, b: usize },
    /// `bytes` is either one exported slot or a whole save; for a save, `from`
    /// picks the character (first occupied when `None`).
    Import { to: usize, from: Option<usize>, bytes: Vec<u8> },
}

const STEAM_IDS: std::ops::RangeInclusive<u64> = 76_561_197_960_265_728..=76_561_202_255_233_023;

fn replace_u64(data: &mut [u8], from: u64, to: u64) {
    let (from, to) = (from.to_le_bytes(), to.to_le_bytes());
    let mut cursor = 0;
    while cursor + 8 <= data.len() {
        if data[cursor..cursor + 8] == from {
            data[cursor..cursor + 8].copy_from_slice(&to);
            cursor += 8;
        } else {
            cursor += 1;
        }
    }
}

fn foreign_steam_id(data: &[u8], local: u64) -> Option<u64> {
    (0..data.len().saturating_sub(8))
        .map(|at| u64::from_le_bytes(data[at..at + 8].try_into().unwrap()))
        .find(|value| *value != local && STEAM_IDS.contains(value))
}

#[derive(Debug, Clone)]
pub struct AddedItem {
    pub kind: String,
    pub param_id: u32,
    pub quantity: u32,
    pub max_num: u32,
}

#[derive(Debug, Clone)]
pub struct QuantityChange {
    pub container: String,
    pub index: usize,
    pub quantity: u32,
}

#[derive(Debug, Clone)]
pub struct ItemTransform {
    pub handle: u32,
    pub param_id: u32,
}

/// Puts a bag item into one of the 22 equipment positions. Handle 0 clears it.
#[derive(Debug, Clone)]
pub struct EquipChange {
    pub index: usize,
    pub handle: u32,
}

/// Copies a loadout from another character into the request slot. Items the
/// target lacks are created; ashes attached to source weapons are not copied.
#[derive(Debug, Clone, Default)]
pub struct CopyBuild {
    pub from: usize,
    pub stats: bool,
    pub appearance: bool,
    pub equipment: bool,
    pub spells: bool,
}

#[derive(Debug, Clone, Default)]
pub struct ApplyRequest {
    pub copy_build: Option<CopyBuild>,
    pub slot: usize,
    pub character: Option<CharacterPatch>,
    pub flags: Vec<(u32, bool)>,
    pub slot_ops: Vec<SlotOp>,
    pub add: Vec<AddedItem>,
    pub quantities: Vec<QuantityChange>,
    pub face: Option<Vec<u8>>,
    pub transforms: Vec<ItemTransform>,
    pub remove: Vec<u32>,
    pub equip: Vec<EquipChange>,
    pub copy_face_from: Option<usize>,
}

#[derive(Debug, Clone, Copy)]
pub struct WritePolicy {
    pub sync_profile: bool,
    pub refresh_hash: bool,
}

impl Default for WritePolicy {
    fn default() -> Self {
        Self { sync_profile: false, refresh_hash: false }
    }
}

pub struct OpenedSave {
    pub save: SaveFile,
    pub slots: Vec<CharacterSlot>,
}

fn ud10_at(save: &SaveFile) -> std::ops::Range<usize> {
    payload_range(&save.entries[10])
}

pub fn open_bytes(bytes: &[u8]) -> SaveResult<OpenedSave> {
    let save = parse_container(bytes)?;
    let slots = (0..10)
        .map(|index| {
            let range = payload_range(&save.entries[index]);
            parse_slot(&save.buffer[range], index)
        })
        .collect();
    Ok(OpenedSave { save, slots })
}

fn payload_mut(save: &mut SaveFile, index: usize) -> &mut [u8] {
    let range = payload_range(&save.entries[index]);
    &mut save.buffer[range]
}

fn reload(opened: &mut OpenedSave, index: usize) {
    let range = payload_range(&opened.save.entries[index]);
    opened.slots[index] = parse_slot(&opened.save.buffer[range], index);
}

fn assert_editable(slot: &CharacterSlot) -> SaveResult<()> {
    if slot.empty {
        return Err(SaveError::msg("Slot vazio."));
    }
    if slot.read_only {
        return Err(SaveError::code(
            "ERE-05",
            slot.warning.clone().unwrap_or_else(|| "Personagem somente leitura.".into()),
        ));
    }
    Ok(())
}

fn import_slot(opened: &mut OpenedSave, to: usize, from: Option<usize>, bytes: &[u8]) -> SaveResult<()> {
    if to >= 10 {
        return Err(SaveError::msg("Slot de destino inexistente."));
    }
    let ud10_range = ud10_at(&opened.save);
    let local = crate::slot::steam_id(&opened.save.buffer[ud10_range.clone()]);
    let (mut payload, foreign, profile) = if bytes.len() == SLOT_PAYLOAD {
        (bytes.to_vec(), None, None)
    } else {
        let other = open_bytes(bytes).map_err(|_| SaveError::msg("O arquivo não é um personagem exportado nem um save do Elden Ring."))?;
        let index = match from {
            Some(index) if other.slots.get(index).is_some_and(|slot| !slot.empty) => index,
            Some(_) => return Err(SaveError::msg("O slot escolhido nesse save está vazio.")),
            None => other.slots.iter().position(|slot| !slot.empty).ok_or_else(|| SaveError::msg("Esse save não tem personagem."))?,
        };
        let other_ud10 = &other.save.buffer[ud10_at(&other.save)];
        let profile = other_ud10[profile_offset(index)..profile_offset(index) + UD10_PROFILE_STRIDE].to_vec();
        (slot_bytes(&other, index).to_vec(), Some(crate::slot::steam_id(other_ud10)), Some(profile))
    };
    if parse_slot(&payload, to).empty {
        return Err(SaveError::msg("O arquivo não tem um personagem legível."));
    }
    if let Some(old) = foreign.filter(|id| *id != local && *id != 0).or_else(|| foreign_steam_id(&payload, local)) {
        replace_u64(&mut payload, old, local);
    }
    let dst = payload_range(&opened.save.entries[to]);
    opened.save.buffer[dst].copy_from_slice(&payload);
    let ud10 = &mut opened.save.buffer[ud10_range];
    if let Some(profile) = profile {
        let at = profile_offset(to);
        ud10[at..at + UD10_PROFILE_STRIDE].copy_from_slice(&profile);
    }
    set_active(ud10, to, true);
    reload(opened, to);
    Ok(())
}

fn apply_slot_op(opened: &mut OpenedSave, op: &SlotOp) -> SaveResult<()> {
    if let SlotOp::Import { to, from, bytes } = op {
        return import_slot(opened, *to, *from, bytes);
    }
    match *op {
        SlotOp::Import { .. } => {}
        SlotOp::Delete { slot } => {
            clear_payload(payload_mut(&mut opened.save, slot));
            let start = profile_offset(slot);
            let range = ud10_at(&opened.save);
            let ud10_start = range.start;
            opened.save.buffer[ud10_start + start..ud10_start + start + UD10_PROFILE_STRIDE].fill(0);
            let ud10_range = ud10_at(&opened.save);
            set_active(&mut opened.save.buffer[ud10_range], slot, false);
        }
        SlotOp::Clone { from, to } | SlotOp::Move { from, to } => {
            let moving = matches!(op, SlotOp::Move { .. });
            let src = opened.save.buffer[payload_range(&opened.save.entries[from])].to_vec();
            let dst = payload_range(&opened.save.entries[to]);
            opened.save.buffer[dst].copy_from_slice(&src);
            let ud10_range = ud10_at(&opened.save);
            let profile = opened.save.buffer[ud10_range.clone()]
                [profile_offset(from)..profile_offset(from) + UD10_PROFILE_STRIDE]
                .to_vec();
            let ud10 = &mut opened.save.buffer[ud10_range];
            let at = profile_offset(to);
            ud10[at..at + UD10_PROFILE_STRIDE].copy_from_slice(&profile);
            set_active(ud10, to, true);
            if moving {
                clear_payload(payload_mut(&mut opened.save, from));
                let start = profile_offset(from);
                let range = ud10_at(&opened.save);
                opened.save.buffer[range.start + start..range.start + start + UD10_PROFILE_STRIDE].fill(0);
                let ud10_range = ud10_at(&opened.save);
                set_active(&mut opened.save.buffer[ud10_range], from, false);
            }
        }
        SlotOp::Swap { a, b } => {
            let left = opened.save.buffer[payload_range(&opened.save.entries[a])].to_vec();
            let right = opened.save.buffer[payload_range(&opened.save.entries[b])].to_vec();
            let dst_a = payload_range(&opened.save.entries[a]);
            opened.save.buffer[dst_a].copy_from_slice(&right);
            let dst_b = payload_range(&opened.save.entries[b]);
            opened.save.buffer[dst_b].copy_from_slice(&left);
            let ud10_range = ud10_at(&opened.save);
            let pa = opened.save.buffer[ud10_range.clone()][profile_offset(a)..profile_offset(a) + UD10_PROFILE_STRIDE].to_vec();
            let pb = opened.save.buffer[ud10_range][profile_offset(b)..profile_offset(b) + UD10_PROFILE_STRIDE].to_vec();
            let ud10_range = ud10_at(&opened.save);
            let ud10 = &mut opened.save.buffer[ud10_range];
            let at_a = profile_offset(a);
            let at_b = profile_offset(b);
            ud10[at_a..at_a + UD10_PROFILE_STRIDE].copy_from_slice(&pb);
            ud10[at_b..at_b + UD10_PROFILE_STRIDE].copy_from_slice(&pa);
            let flag_a = active_flag(ud10, a);
            let flag_b = active_flag(ud10, b);
            set_active(ud10, a, flag_b);
            set_active(ud10, b, flag_a);
        }
    }
    for index in 0..10 {
        reload(opened, index);
    }
    Ok(())
}

pub fn apply_to_bytes(bytes: &[u8], request: &ApplyRequest) -> SaveResult<Vec<u8>> {
    apply_with(bytes, request, WritePolicy::default())
}

fn slot_bytes(opened: &OpenedSave, index: usize) -> &[u8] {
    &opened.save.buffer[payload_range(&opened.save.entries[index])]
}

fn inventory_position(slot: &CharacterSlot, handle: u32) -> Option<usize> {
    slot.inventory.common.iter().position(|item| item.handle == handle)
}

fn record_item(slot: &CharacterSlot, handle: u32) -> Option<u32> {
    slot.records.iter().find(|record| record.handle == handle).map(|record| record.item_id)
}

/// Finds or creates the target copy of one equipped source item and returns its handle.
fn target_handle(opened: &mut OpenedSave, to: usize, source: &CharacterSlot, item: Equipped, used: &[u32]) -> SaveResult<u32> {
    let kind = item.handle >> 28;
    if kind == 0xA || kind == 0xB {
        let target = &opened.slots[to];
        if inventory_position(target, item.handle).is_none() {
            let range = payload_range(&opened.save.entries[to]);
            add_stackable(&mut opened.save.buffer[range], &mut opened.slots[to], item.handle, 1, kind == 0xB, 1)?;
        }
        return Ok(item.handle);
    }
    let wanted = record_item(source, item.handle).unwrap_or(item.item_id);
    let target = &opened.slots[to];
    let existing = target.records.iter()
        .filter(|record| record.handle >> 28 == kind && record.item_id == wanted && !used.contains(&record.handle))
        .find(|record| inventory_position(target, record.handle).is_some())
        .map(|record| record.handle);
    if let Some(handle) = existing {
        return Ok(handle);
    }
    let quantity = source.inventory.common.iter().find(|entry| entry.handle == item.handle).map(|entry| entry.quantity).unwrap_or(1).max(1);
    let name = match kind { 0x9 => "armor", 0xC => "ash", _ => "weapon" };
    let parsed = opened.slots[to].clone();
    let range = payload_range(&opened.save.entries[to]);
    let handle = add_physical(&mut opened.save.buffer[range], &parsed, name, wanted)?;
    reload(opened, to);
    let range = payload_range(&opened.save.entries[to]);
    add_stackable(&mut opened.save.buffer[range], &mut opened.slots[to], handle, quantity.min(99), true, quantity.clamp(1, 99))?;
    Ok(handle)
}

fn equip_into(opened: &mut OpenedSave, index: usize, change: &EquipChange) -> SaveResult<()> {
    assert_editable(&opened.slots[index])?;
    if change.index >= 22 {
        return Err(SaveError::msg("Espaço de equipamento inexistente."));
    }
    let layout = opened.slots[index].layout.clone().ok_or_else(|| SaveError::msg("Equipamento indisponível."))?;
    let range = payload_range(&opened.save.entries[index]);
    if change.handle == 0 {
        write_equipped(&mut opened.save.buffer[range], &layout, change.index, Equipped::EMPTY);
        return Ok(());
    }
    let position = inventory_position(&opened.slots[index], change.handle)
        .ok_or_else(|| SaveError::msg("Esse item não está na bolsa."))?;
    let kind = change.handle >> 28;
    let item_id = if kind == 0xA || kind == 0xB {
        change.handle & 0x0FFF_FFFF
    } else {
        record_item(&opened.slots[index], change.handle).ok_or_else(|| SaveError::msg("Registro do item não encontrado."))?
    };
    let equipped = read_equipped(slot_bytes(opened, index), &layout);
    for (slot, item) in equipped.iter().enumerate() {
        if slot != change.index && item.handle == change.handle {
            let range = payload_range(&opened.save.entries[index]);
            write_equipped(&mut opened.save.buffer[range], &layout, slot, Equipped::EMPTY);
        }
    }
    let range = payload_range(&opened.save.entries[index]);
    write_equipped(&mut opened.save.buffer[range], &layout, change.index, Equipped {
        handle: change.handle,
        item_id,
        index: (position + KEY_SLOTS) as u32,
    });
    Ok(())
}

fn copy_build(opened: &mut OpenedSave, to: usize, copy: &CopyBuild) -> SaveResult<()> {
    if copy.from == to {
        return Err(SaveError::msg("Escolha outro personagem como origem."));
    }
    assert_editable(&opened.slots[copy.from])?;
    assert_editable(&opened.slots[to])?;
    let source = opened.slots[copy.from].clone();
    let source_data = slot_bytes(opened, copy.from).to_vec();
    let source_layout = source.layout.clone().ok_or_else(|| SaveError::msg("Personagem de origem ilegível."))?;
    let player = source.player.clone().ok_or_else(|| SaveError::msg("Personagem de origem ilegível."))?;

    if copy.stats {
        let patch = CharacterPatch {
            stats: Some(player.stats),
            class_id: Some(player.class_id),
            gender: Some(player.gender),
            talisman_slots: Some(player.talisman_slots),
            ..Default::default()
        };
        let range = payload_range(&opened.save.entries[to]);
        let target = opened.slots[to].clone();
        apply_character(&mut opened.save.buffer[range], &target, &patch)?;
        reload(opened, to);
    }
    if copy.appearance {
        let face = source_data[source_layout.face..source_layout.face + FACE].to_vec();
        let target = opened.slots[to].clone();
        let range = payload_range(&opened.save.entries[to]);
        write_face(&mut opened.save.buffer[range], &target, &face)?;
    }
    if copy.equipment {
        let equipped = read_equipped(&source_data, &source_layout);
        let mut used = Vec::new();
        for (slot, item) in equipped.iter().enumerate() {
            let value = if item.is_empty() {
                Equipped::EMPTY
            } else {
                let handle = target_handle(opened, to, &source, *item, &used)?;
                reload(opened, to);
                used.push(handle);
                let position = inventory_position(&opened.slots[to], handle)
                    .ok_or_else(|| SaveError::msg("Item copiado não entrou no inventário."))?;
                Equipped { handle, item_id: item.item_id, index: (position + KEY_SLOTS) as u32 }
            };
            let layout = opened.slots[to].layout.clone().ok_or_else(|| SaveError::msg("Personagem de destino ilegível."))?;
            let range = payload_range(&opened.save.entries[to]);
            write_equipped(&mut opened.save.buffer[range], &layout, slot, value);
        }
        let active = source_data[active_slots_range(&source_layout)].to_vec();
        let layout = opened.slots[to].layout.clone().ok_or_else(|| SaveError::msg("Personagem de destino ilegível."))?;
        let range = payload_range(&opened.save.entries[to]);
        opened.save.buffer[range][active_slots_range(&layout)].copy_from_slice(&active);
    }
    if copy.spells {
        let table = source_data[source_layout.spells..source_layout.spells + SPELLS].to_vec();
        for entry in 0..14 {
            let id = u32::from_le_bytes(table[entry * 8..entry * 8 + 4].try_into().unwrap());
            if id == u32::MAX {
                continue;
            }
            let handle = 0xB000_0000 | (id & 0x0FFF_FFFF);
            let target = &opened.slots[to];
            let owned = target.inventory.common.iter().chain(target.inventory.key.iter()).any(|item| item.handle == handle && occupied(item));
            if !owned {
                let range = payload_range(&opened.save.entries[to]);
                add_stackable(&mut opened.save.buffer[range], &mut opened.slots[to], handle, 1, true, 1)?;
            }
        }
        let layout = opened.slots[to].layout.clone().ok_or_else(|| SaveError::msg("Personagem de destino ilegível."))?;
        let range = payload_range(&opened.save.entries[to]);
        opened.save.buffer[range][layout.spells..layout.spells + SPELLS].copy_from_slice(&table);
    }
    reload(opened, to);
    Ok(())
}

pub fn apply_with(bytes: &[u8], request: &ApplyRequest, policy: WritePolicy) -> SaveResult<Vec<u8>> {
    let mut opened = open_bytes(bytes)?;
    let index = request.slot;
    // Validate every character reference before indexing slots or mutating bytes.
    let valid = |slot: usize| -> SaveResult<()> {
        if slot >= opened.slots.len() { return Err(SaveError::msg("Slot inexistente.")); }
        Ok(())
    };
    valid(index)?;
    if let Some(copy) = &request.copy_build { valid(copy.from)?; }
    if let Some(from) = request.copy_face_from { valid(from)?; }
    for op in &request.slot_ops {
        match op {
            SlotOp::Delete { slot } => valid(*slot)?,
            SlotOp::Clone { from, to } | SlotOp::Move { from, to } => { valid(*from)?; valid(*to)?; }
            SlotOp::Swap { a, b } => { valid(*a)?; valid(*b)?; }
            // Import's source belongs to the incoming save, validated by import_slot.
            SlotOp::Import { to, .. } => valid(*to)?,
        }
    }
    if let Some(copy) = &request.copy_build {
        copy_build(&mut opened, index, copy)?;
    }
    if let Some(patch) = &request.character {
        assert_editable(&opened.slots[index])?;
        let range = payload_range(&opened.save.entries[index]);
        apply_character(&mut opened.save.buffer[range], &opened.slots[index], patch)?;
        reload(&mut opened, index);
    }
    for change in &request.quantities {
        assert_editable(&opened.slots[index])?;
        let range = payload_range(&opened.save.entries[index]);
        set_quantity(&mut opened.save.buffer[range], &mut opened.slots[index], &change.container, change.index, change.quantity, 999)?;
    }
    if let Some(face) = &request.face {
        assert_editable(&opened.slots[index])?;
        let parsed = opened.slots[index].clone();
        let range = payload_range(&opened.save.entries[index]);
        write_face(&mut opened.save.buffer[range], &parsed, face)?;
    }
    if let Some(from) = request.copy_face_from {
        assert_editable(&opened.slots[index])?;
        assert_editable(&opened.slots[from])?;
        let source = opened.slots[from].clone();
        let source_range = payload_range(&opened.save.entries[from]);
        let layout = source.layout.as_ref().ok_or_else(|| SaveError::msg("Aparência indisponível."))?;
        let end = layout.face + crate::constants::FACE;
        if end > source_range.len() {
            return Err(SaveError::msg("Aparência fora do personagem."));
        }
        let bytes = opened.save.buffer[source_range][layout.face..end].to_vec();
        let parsed = opened.slots[index].clone();
        let range = payload_range(&opened.save.entries[index]);
        write_face(&mut opened.save.buffer[range], &parsed, &bytes)?;
    }
    for change in &request.transforms {
        assert_editable(&opened.slots[index])?;
        let parsed = opened.slots[index].clone();
        let range = payload_range(&opened.save.entries[index]);
        transform_record(&mut opened.save.buffer[range], &parsed, change.handle, change.param_id)?;
    }
    for handle in &request.remove {
        assert_editable(&opened.slots[index])?;
        let parsed = opened.slots[index].clone();
        let range = payload_range(&opened.save.entries[index]);
        remove_physical(&mut opened.save.buffer[range], &parsed, *handle)?;
        reload(&mut opened, index);
    }
    for item in &request.add {
        assert_editable(&opened.slots[index])?;
        let qty = item.quantity.max(1);
        if item.kind == "weapon" || item.kind == "armor" || item.kind == "ash" {
            let item_id = match item.kind.as_str() {
                "armor" => 0x1000_0000 | (item.param_id & 0x0FFF_FFFF),
                "ash" => 0x8000_0000 | (item.param_id & 0x0FFF_FFFF),
                _ => item.param_id,
            };
            let cap = item.max_num.max(1);
            let parsed = opened.slots[index].clone();
            let range = payload_range(&opened.save.entries[index]);
            let handle = add_physical(&mut opened.save.buffer[range], &parsed, &item.kind, item_id)?;
            reload(&mut opened, index);
            let range = payload_range(&opened.save.entries[index]);
            add_stackable(&mut opened.save.buffer[range], &mut opened.slots[index], handle, qty.min(cap), true, cap)?;
        } else if item.kind == "talisman" {
            let handle = 0xA000_0000 | (item.param_id & 0x0FFF_FFFF);
            let range = payload_range(&opened.save.entries[index]);
            add_stackable(&mut opened.save.buffer[range], &mut opened.slots[index], handle, 1, false, 1)?;
        } else {
            let handle = 0xB000_0000 | (item.param_id & 0x0FFF_FFFF);
            let cap = if item.max_num == 0 { 999 } else { item.max_num };
            let range = payload_range(&opened.save.entries[index]);
            add_stackable(&mut opened.save.buffer[range], &mut opened.slots[index], handle, qty, true, cap)?;
        }
    }
    for change in &request.equip {
        equip_into(&mut opened, index, change)?;
    }
    if !request.flags.is_empty() {
        assert_editable(&opened.slots[index])?;
        for (id, on) in &request.flags {
            let range = payload_range(&opened.save.entries[index]);
            let slot = opened.slots[index].clone();
            set_flag(&mut opened.save.buffer[range], &slot, *id, *on)?;
        }
    }
    let ops = request.slot_ops.clone();
    for op in &ops {
        apply_slot_op(&mut opened, op)?;
    }
    if policy.sync_profile || policy.refresh_hash {
        reload(&mut opened, index);
        if policy.sync_profile && opened.slots[index].player.is_some() {
            let range = payload_range(&opened.save.entries[index]);
            let slot_data = opened.save.buffer[range].to_vec();
            let ud10_range = ud10_at(&opened.save);
            sync_profile(&slot_data, &mut opened.save.buffer[ud10_range], &opened.slots[index]);
        }
        if policy.refresh_hash {
            let range = payload_range(&opened.save.entries[index]);
            let slot = opened.slots[index].clone();
            refresh_hash(&mut opened.save.buffer[range], &slot);
        }
    }
    crate::container::recalculate_checksums(&mut opened.save);
    verify(&opened, request)?;
    to_file_buffer(&mut opened.save)
}

fn verify(opened: &OpenedSave, request: &ApplyRequest) -> SaveResult<()> {
    for entry in &opened.save.entries {
        if !checksum_ok(&opened.save, entry) {
            return Err(SaveError::msg(format!("Checksum inválido em {}.", entry.name)));
        }
    }
    let touches = request.character.is_some() || !request.flags.is_empty() || !request.add.is_empty() || request.copy_build.is_some();
    if touches {
        let range = payload_range(&opened.save.entries[request.slot]);
        let slot = parse_slot(&opened.save.buffer[range.clone()], request.slot);
        if !slot.empty && !slot.read_only {
            if !face_ok(&opened.save.buffer[range], &slot) {
                return Err(SaveError::msg("A aparência deixou de ser legível depois da edição."));
            }
            if request.character.as_ref().is_some_and(|patch| patch.stats.is_some()) && !slot.consistent {
                return Err(SaveError::msg("O nível não fechou com a soma dos atributos."));
            }
            if slot.event_flags + EVENT_FLAG_BYTES > SLOT_PAYLOAD {
                return Err(SaveError::msg("A área de progresso saiu do personagem."));
            }
        }
    }
    Ok(())
}

pub fn slot_name_level(opened: &OpenedSave, index: usize) -> Option<(String, u32)> {
    opened.slots[index].player.as_ref().map(|player| (player.name.clone(), player.level))
}
