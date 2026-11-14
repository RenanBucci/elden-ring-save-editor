use crate::constants::*;
use crate::error::{SaveError, SaveResult};
use crate::flags::{read_flag, write_flag};

#[derive(Debug, Clone)]
pub struct Player {
    pub stats: [u32; 8],
    pub level: u32,
    pub runes: u32,
    pub soul_memory: u32,
    pub name: String,
    pub gender: u8,
    pub class_id: u8,
    pub voice: u8,
    pub talisman_slots: u8,
    pub scadutree: u8,
    pub shadow_blessing: u8,
}

#[derive(Debug, Clone)]
pub struct Layout {
    pub pgd: usize,
    pub item_ids: usize,
    pub handles: usize,
    pub inventory: usize,
    pub spells: usize,
    pub face: usize,
    pub storage: usize,
    pub regions: usize,
    pub region_count: u32,
    pub event_flags: usize,
}

#[derive(Debug, Clone)]
pub struct InvItem {
    pub index: usize,
    pub offset: usize,
    pub handle: u32,
    pub quantity: u32,
    pub order: u32,
}

#[derive(Debug, Clone, Default)]
pub struct ItemList {
    pub header_offset: usize,
    pub common: Vec<InvItem>,
    pub key: Vec<InvItem>,
}

#[derive(Debug, Clone)]
pub struct Record {
    pub index: usize,
    pub offset: usize,
    pub size: usize,
    pub handle: u32,
    pub item_id: u32,
}

#[derive(Debug, Clone)]
pub struct CharacterSlot {
    pub index: usize,
    pub version: u32,
    pub empty: bool,
    pub read_only: bool,
    pub warning: Option<String>,
    pub magic: usize,
    pub layout: Option<Layout>,
    pub player: Option<Player>,
    pub consistent: bool,
    pub expected_level: u32,
    pub records: Vec<Record>,
    pub inventory: ItemList,
    pub storage: ItemList,
    pub event_flags: usize,
}

#[derive(Debug, Clone, Default)]
pub struct CharacterPatch {
    pub name: Option<String>,
    pub stats: Option<[u32; 8]>,
    pub runes: Option<u32>,
    pub class_id: Option<u8>,
    pub gender: Option<u8>,
    pub voice: Option<u8>,
    pub talisman_slots: Option<u8>,
    pub scadutree: Option<u8>,
    pub shadow_blessing: Option<u8>,
    pub fix_level: bool,
}

pub fn occupied(item: &InvItem) -> bool {
    item.handle != 0 && item.handle != 0xFFFF_FFFF
}

fn ru32(data: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(data[at..at + 4].try_into().unwrap())
}

fn wu32(data: &mut [u8], at: usize, value: u32) {
    data[at..at + 4].copy_from_slice(&value.to_le_bytes());
}

pub fn decode_name(data: &[u8], offset: usize) -> String {
    crate::container::read_utf16(data, offset, 32)
}

pub fn encode_name(text: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (index, ch) in text.chars().take(16).enumerate() {
        let code = ch as u32;
        let value = if code <= 0xFFFF { code as u16 } else { 0xFFFD };
        out[index * 2..index * 2 + 2].copy_from_slice(&value.to_le_bytes());
    }
    out
}

fn at_signed(base: usize, delta: isize) -> usize {
    base.wrapping_add(delta as usize)
}

fn record_size(handle: u32) -> usize {
    if handle == 0 {
        return 8;
    }
    match handle >> 28 {
        0x8 => 21,
        0x9 => 16,
        _ => 8,
    }
}

fn ga_count_for(version: u32) -> usize {
    if version <= GA_VERSION_BREAK { GA_COUNT_OLD } else { GA_COUNT_NEW }
}

fn read_records(data: &[u8], version: u32) -> (Vec<Record>, usize) {
    let count = ga_count_for(version);
    let mut records = Vec::with_capacity(count);
    let mut cursor = GA_START;
    for index in 0..count {
        if cursor + 8 > data.len() {
            break;
        }
        let handle = ru32(data, cursor);
        let item_id = ru32(data, cursor + 4);
        let size = record_size(handle);
        records.push(Record { index, offset: cursor, size, handle, item_id });
        cursor += size;
    }
    (records, cursor)
}

fn read_list(data: &[u8], start: usize, count: usize) -> Vec<InvItem> {
    let mut items = Vec::with_capacity(count);
    for index in 0..count {
        let at = start + index * RECORD_LEN;
        items.push(InvItem {
            index,
            offset: at,
            handle: ru32(data, at),
            quantity: ru32(data, at + 4),
            order: ru32(data, at + 8),
        });
    }
    items
}

fn chain_from(data: &[u8], magic: usize) -> Option<Layout> {
    if magic < MAGIC_BEFORE_PGD {
        return None;
    }
    let pgd = magic - MAGIC_BEFORE_PGD;
    if pgd < GA_START {
        return None;
    }
    let mut cursor = pgd + PLAYER_DATA_SIZE;
    cursor += SP_EFFECT + EQUIP_INDEX + ACTIVE_SLOTS;
    let item_ids = cursor;
    cursor += ITEM_IDS;
    let handles = cursor;
    cursor += HANDLES;
    let inventory = cursor;
    cursor += INVENTORY;
    let spells = cursor;
    cursor += SPELLS + QUICK_ITEMS + EQUIP_GESTURES;
    if cursor + 4 > data.len() {
        return None;
    }
    let projectiles = ru32(data, cursor);
    if projectiles > 200_000 {
        return None;
    }
    cursor += 4 + projectiles as usize * 8;
    cursor += ARMAMENTS + PHYSICS;
    let face = cursor;
    cursor += FACE;
    let storage = cursor;
    cursor += STORAGE + GESTURE_LIST;
    let regions = cursor;
    if regions + 4 > data.len() {
        return None;
    }
    let region_count = ru32(data, regions);
    if region_count > 20_000 {
        return None;
    }
    let mut after = regions + 4 + region_count as usize * 4;
    after += HORSE + BLOOD_GAP + MENU_PROFILE + GA_ITEM_DATA;
    after += TUTORIAL + PRE_FLAGS;
    Some(Layout {
        pgd,
        item_ids,
        handles,
        inventory,
        spells,
        face,
        storage,
        regions,
        region_count,
        event_flags: after,
    })
}

fn read_player(data: &[u8], magic: usize) -> Player {
    let mut stats = [0u32; 8];
    for (index, delta) in STAT_DELTA.iter().enumerate() {
        stats[index] = ru32(data, at_signed(magic, *delta));
    }
    Player {
        stats,
        level: ru32(data, at_signed(magic, OFF_LEVEL)),
        runes: ru32(data, at_signed(magic, OFF_RUNES)),
        soul_memory: ru32(data, at_signed(magic, OFF_SOUL_MEMORY)),
        name: decode_name(data, at_signed(magic, OFF_NAME)),
        gender: data[at_signed(magic, OFF_GENDER)],
        class_id: data[at_signed(magic, OFF_CLASS)],
        voice: data[at_signed(magic, OFF_VOICE)],
        talisman_slots: data[at_signed(magic, OFF_TALISMAN_SLOTS)],
        scadutree: data[at_signed(magic, OFF_SCADUTREE)],
        shadow_blessing: data[at_signed(magic, OFF_SHADOW)],
    }
}

pub fn find_magic(data: &[u8]) -> Option<usize> {
    let pattern = magic_pattern();
    data.windows(pattern.len()).position(|window| window == pattern)
}

pub fn parse_slot(data: &[u8], index: usize) -> CharacterSlot {
    let version = if data.len() >= 4 { ru32(data, 0) } else { 0 };
    let base = CharacterSlot {
        index,
        version,
        empty: version == 0,
        read_only: false,
        warning: None,
        magic: 0,
        layout: None,
        player: None,
        consistent: false,
        expected_level: 0,
        records: Vec::new(),
        inventory: ItemList::default(),
        storage: ItemList::default(),
        event_flags: 0,
    };
    if version == 0 {
        return base;
    }
    if version > MAX_VERSION {
        return CharacterSlot {
            read_only: true,
            warning: Some(format!("Versão de slot 0x{version:x} não é reconhecida.")),
            ..base
        };
    }
    let Some(magic) = find_magic(data) else {
        return CharacterSlot {
            read_only: true,
            warning: Some("Assinatura do personagem não encontrada.".into()),
            ..base
        };
    };
    let (records, _) = read_records(data, version);
    let Some(layout) = chain_from(data, magic) else {
        return CharacterSlot {
            read_only: true,
            magic,
            warning: Some("A cadeia interna do personagem não fechou.".into()),
            ..base
        };
    };
    let face_ok = data.get(layout.face + 4..layout.face + 8) == Some(b"FACE");
    if !face_ok {
        return CharacterSlot {
            read_only: true,
            magic,
            warning: Some("A cadeia interna do personagem não fechou.".into()),
            ..base
        };
    }
    let player = read_player(data, magic);
    let stat_sum: u64 = player.stats.iter().map(|value| u64::from(*value)).sum();
    let valid_stats = player.stats.iter().all(|value| (1..=99).contains(value)) && stat_sum >= 80;
    let expected = stat_sum.saturating_sub(79).min(u64::from(u32::MAX)) as u32;
    let inventory_start = at_signed(magic, INV_FROM_MAGIC);
    let inventory = ItemList {
        header_offset: inventory_start - 4,
        common: read_list(data, inventory_start, COMMON_SLOTS),
        key: read_list(data, inventory_start + COMMON_SLOTS * RECORD_LEN + 4, KEY_SLOTS),
    };
    let storage_start = layout.storage + 4;
    let storage = ItemList {
        header_offset: layout.storage,
        common: read_list(data, storage_start, STORAGE_COMMON),
        key: read_list(data, storage_start + STORAGE_COMMON * RECORD_LEN + 4, STORAGE_KEY),
    };
    CharacterSlot {
        magic,
        layout: Some(layout.clone()),
        records,
        player: Some(player.clone()),
        consistent: valid_stats && player.level == expected,
        expected_level: expected,
        inventory,
        storage,
        event_flags: layout.event_flags,
        ..base
    }
}

pub fn face_ok(data: &[u8], slot: &CharacterSlot) -> bool {
    slot.layout.as_ref().is_some_and(|layout| data.get(layout.face + 4..layout.face + 8) == Some(b"FACE"))
}

fn write_name(data: &mut [u8], offset: usize, text: &str) {
    data[offset..offset + 32].copy_from_slice(&encode_name(text));
}

pub fn apply_character(data: &mut [u8], slot: &CharacterSlot, patch: &CharacterPatch) -> SaveResult<()> {
    if slot.empty || slot.read_only || slot.player.is_none() {
        return Err(SaveError::msg("Personagem indisponível para edição."));
    }
    let stats = patch.stats.map(|stats| stats.map(|value| value.clamp(1, 99)));
    if let Some(stats) = stats {
        if stats.iter().sum::<u32>() < 80 {
            return Err(SaveError::msg("A soma dos atributos deve ser pelo menos 80 (nível 1)."));
        }
    } else if patch.fix_level {
        let current = &slot.player.as_ref().unwrap().stats;
        if current.iter().any(|value| !(1..=99).contains(value)) || current.iter().map(|value| u64::from(*value)).sum::<u64>() < 80 {
            return Err(SaveError::msg("Corrija os atributos antes de recalcular o nível."));
        }
    }
    let magic = slot.magic;
    if let Some(name) = &patch.name {
        write_name(data, at_signed(magic, OFF_NAME), name);
    }
    if let Some(stats) = stats {
        let mut level = 0u32;
        for (index, value) in stats.iter().enumerate() {
            let stat = (*value).clamp(1, 99);
            wu32(data, at_signed(magic, STAT_DELTA[index]), stat);
            level += stat;
        }
        wu32(data, at_signed(magic, OFF_LEVEL), level - 79);
    } else if patch.fix_level {
        wu32(data, at_signed(magic, OFF_LEVEL), slot.expected_level);
    }
    if let Some(runes) = patch.runes {
        wu32(data, at_signed(magic, OFF_RUNES), runes);
    }
    if let Some(class_id) = patch.class_id {
        data[at_signed(magic, OFF_CLASS)] = class_id;
    }
    if let Some(gender) = patch.gender {
        data[at_signed(magic, OFF_GENDER)] = gender & 1;
    }
    if let Some(voice) = patch.voice {
        data[at_signed(magic, OFF_VOICE)] = voice;
    }
    if let Some(slots) = patch.talisman_slots {
        data[at_signed(magic, OFF_TALISMAN_SLOTS)] = slots.min(3);
    }
    if let Some(value) = patch.scadutree {
        data[at_signed(magic, OFF_SCADUTREE)] = value.min(20);
    }
    if let Some(value) = patch.shadow_blessing {
        data[at_signed(magic, OFF_SHADOW)] = value.min(10);
    }
    Ok(())
}

pub const EQUIP_COUNT: usize = 22;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Equipped {
    pub handle: u32,
    pub item_id: u32,
    /// Inventory position plus `KEY_SLOTS`, or `u32::MAX` when the slot is empty.
    pub index: u32,
}

impl Equipped {
    pub const EMPTY: Equipped = Equipped { handle: 0, item_id: u32::MAX, index: u32::MAX };

    pub fn is_empty(&self) -> bool {
        self.handle == 0 || self.handle == u32::MAX
    }
}

fn equip_index_at(layout: &Layout) -> usize {
    layout.item_ids - ACTIVE_SLOTS - EQUIP_INDEX
}

pub fn active_slots_range(layout: &Layout) -> std::ops::Range<usize> {
    layout.item_ids - ACTIVE_SLOTS..layout.item_ids
}

pub fn read_equipped(data: &[u8], layout: &Layout) -> Vec<Equipped> {
    let indices = equip_index_at(layout);
    (0..EQUIP_COUNT).map(|slot| Equipped {
        handle: ru32(data, layout.handles + slot * 4),
        item_id: ru32(data, layout.item_ids + slot * 4),
        index: ru32(data, indices + slot * 4),
    }).collect()
}

pub fn write_equipped(data: &mut [u8], layout: &Layout, slot: usize, value: Equipped) {
    wu32(data, layout.handles + slot * 4, value.handle);
    wu32(data, layout.item_ids + slot * 4, value.item_id);
    wu32(data, equip_index_at(layout) + slot * 4, value.index);
}

pub fn profile_offset(index: usize) -> usize {
    UD10_PROFILES + index * UD10_PROFILE_STRIDE
}

pub fn write_profile(ud10: &mut [u8], index: usize, name: Option<&str>, level: Option<u32>) {
    let at = profile_offset(index);
    if let Some(name) = name {
        write_name(ud10, at, name);
    }
    if let Some(level) = level {
        wu32(ud10, at + UD10_PROFILE_LEVEL, level);
    }
}

pub fn set_active(ud10: &mut [u8], index: usize, on: bool) {
    ud10[UD10_ACTIVE + index] = u8::from(on);
}

pub fn active_flag(ud10: &[u8], index: usize) -> bool {
    ud10[UD10_ACTIVE + index] != 0
}

pub fn read_profile_name(ud10: &[u8], index: usize) -> String {
    decode_name(ud10, profile_offset(index))
}

pub fn read_profile_level(ud10: &[u8], index: usize) -> u32 {
    ru32(ud10, profile_offset(index) + UD10_PROFILE_LEVEL)
}

pub fn read_profile_play(ud10: &[u8], index: usize) -> u32 {
    ru32(ud10, profile_offset(index) + 38)
}

pub fn steam_id(ud10: &[u8]) -> u64 {
    u64::from_le_bytes(ud10[UD10_STEAM_ID..UD10_STEAM_ID + 8].try_into().unwrap())
}

pub fn sync_profile(slot_data: &[u8], ud10: &mut [u8], slot: &CharacterSlot) {
    let Some(player) = &slot.player else { return };
    write_profile(ud10, slot.index, Some(&player.name), Some(player.level));
    let at = profile_offset(slot.index);
    if at + 0x244 > ud10.len() {
        return;
    }
    ud10[at + 0x242] = player.gender;
    ud10[at + 0x243] = player.class_id;
    wu32(ud10, at + 0x2A, player.soul_memory);
    if let Some(layout) = &slot.layout {
        let face_end = layout.face + 0x124;
        let dest_end = at + 0x36 + 0x124;
        if face_end <= slot_data.len() && dest_end <= ud10.len() {
            ud10[at + 0x36..dest_end].copy_from_slice(&slot_data[layout.face..face_end]);
        }
    }
}

pub fn write_face(data: &mut [u8], slot: &CharacterSlot, bytes: &[u8]) -> SaveResult<()> {
    let layout = slot.layout.as_ref().ok_or_else(|| SaveError::msg("Aparência indisponível."))?;
    if bytes.len() < FACE {
        return Err(SaveError::msg("Aparência incompleta."));
    }
    data[layout.face..layout.face + FACE].copy_from_slice(&bytes[..FACE]);
    Ok(())
}

pub fn set_flag(data: &mut [u8], slot: &CharacterSlot, id: u32, on: bool) -> SaveResult<()> {
    let start = slot.event_flags;
    if start == 0 || start + EVENT_FLAG_BYTES > data.len() {
        return Err(SaveError::msg("Área de progresso não encontrada."));
    }
    write_flag(&mut data[start..start + EVENT_FLAG_BYTES], id, on)
}

pub fn flag_is_on(data: &[u8], slot: &CharacterSlot, id: u32) -> bool {
    let start = slot.event_flags;
    if start + EVENT_FLAG_BYTES > data.len() {
        return false;
    }
    read_flag(&data[start..start + EVENT_FLAG_BYTES], id)
}

pub fn clear_payload(data: &mut [u8]) {
    data.fill(0);
}

fn list_mut<'a>(slot: &'a mut CharacterSlot, container: &str) -> &'a mut Vec<InvItem> {
    if container == "storage" {
        &mut slot.storage.common
    } else if container == "key" {
        &mut slot.inventory.key
    } else {
        &mut slot.inventory.common
    }
}

pub fn set_quantity(data: &mut [u8], slot: &mut CharacterSlot, container: &str, index: usize, quantity: u32, max: u32) -> SaveResult<()> {
    let list = list_mut(slot, container);
    let item = list.get(index).ok_or_else(|| SaveError::msg("Espaço de inventário vazio."))?;
    if !occupied(item) {
        return Err(SaveError::msg("Espaço de inventário vazio."));
    }
    let cap = max.clamp(1, 9999);
    let amount = quantity.clamp(1, cap);
    wu32(data, item.offset + 4, amount);
    list[index].quantity = amount;
    Ok(())
}

pub fn add_stackable(data: &mut [u8], slot: &mut CharacterSlot, handle: u32, quantity: u32, stack: bool, max: u32) -> SaveResult<()> {
    let cap = max.clamp(1, 9999);
    let existing = slot.inventory.common.iter().position(|item| item.handle == handle)
        .map(|index| (false, index))
        .or_else(|| slot.inventory.key.iter().position(|item| item.handle == handle).map(|index| (true, index)));
    if let Some((in_key, index)) = existing {
        if !stack {
            return Err(SaveError::msg("Este item não empilha e já está no inventário."));
        }
        let item = if in_key { &slot.inventory.key[index] } else { &slot.inventory.common[index] };
        let next = item.quantity.saturating_add(quantity).min(cap);
        let offset = item.offset;
        wu32(data, offset + 4, next);
        if in_key { slot.inventory.key[index].quantity = next; } else { slot.inventory.common[index].quantity = next; }
        return Ok(());
    }
    let empty = slot.inventory.common.iter().position(|item| !occupied(item))
        .ok_or_else(|| SaveError::msg("Inventário sem espaço livre."))?;
    let order = next_order(slot);
    let amount = quantity.clamp(1, cap);
    let offset = slot.inventory.common[empty].offset;
    wu32(data, offset, handle);
    wu32(data, offset + 4, amount);
    wu32(data, offset + 8, order);
    slot.inventory.common[empty].handle = handle;
    slot.inventory.common[empty].quantity = amount;
    slot.inventory.common[empty].order = order;
    let count = slot.inventory.common.iter().filter(|item| occupied(item)).count() as u32;
    wu32(data, slot.inventory.header_offset, count);
    Ok(())
}

const WEAPON_HANDLE: u32 = 0x8000_0000;
const ARMOR_HANDLE: u32 = 0x9000_0000;
const ASH_HANDLE: u32 = 0xC000_0000;
const VALID_HANDLE: u32 = 0x0080_0000;

fn trailing_zeros(data: &[u8]) -> usize {
    data.iter().rev().take_while(|byte| **byte == 0).count()
}

/// Bytes the slot can grow into. The game leaves uninitialized memory after the
/// 0x80 hash block, so that region counts as free even when it is not zero.
pub fn slack(data: &[u8], slot: &CharacterSlot) -> usize {
    let after_hash = crate::hash::find_hash_offset(data, slot)
        .map(|offset| data.len().saturating_sub(offset + 0x80))
        .unwrap_or(0);
    after_hash.max(trailing_zeros(data))
}

fn shift_tail(data: &mut [u8], at: usize, delta: isize, room: usize) -> SaveResult<()> {
    if delta == 0 {
        return Ok(());
    }
    if delta > 0 {
        let delta = delta as usize;
        if room < delta {
            return Err(SaveError::msg("Não há folga no fim do slot para crescer o registro. Transforme um item existente ou apague uma arma."));
        }
        data.copy_within(at..data.len() - delta, at + delta);
    } else {
        let src = (at as isize - delta) as usize;
        data.copy_within(src..data.len(), at);
        let tail = (data.len() as isize + delta) as usize;
        data[tail..].fill(0);
    }
    Ok(())
}

pub fn transform_record(data: &mut [u8], slot: &CharacterSlot, handle: u32, item_id: u32) -> SaveResult<()> {
    let record = slot.records.iter().find(|record| record.handle == handle)
        .ok_or_else(|| SaveError::msg("Item físico não encontrado."))?;
    wu32(data, record.offset + 4, item_id);
    Ok(())
}

pub fn remove_physical(data: &mut [u8], slot: &CharacterSlot, handle: u32) -> SaveResult<()> {
    let Some(record) = slot.records.iter().find(|record| record.handle == handle && record.handle != 0) else {
        return Ok(());
    };
    for list in [&slot.inventory.common, &slot.inventory.key, &slot.storage.common, &slot.storage.key] {
        for item in list {
            if item.handle == handle {
                wu32(data, item.offset, 0);
                wu32(data, item.offset + 4, 0);
                wu32(data, item.offset + 8, 0);
            }
        }
    }
    let shrink = record.size as isize - 8;
    wu32(data, record.offset, 0);
    wu32(data, record.offset + 4, 0xFFFF_FFFF);
    if shrink > 0 {
        shift_tail(data, record.offset + 8, -shrink, 0)?;
    }
    Ok(())
}

pub fn add_physical(data: &mut [u8], slot: &CharacterSlot, kind: &str, item_id: u32) -> SaveResult<u32> {
    let (prefix, size) = match kind {
        "armor" => (ARMOR_HANDLE, 16usize),
        "ash" => (ASH_HANDLE, 8),
        _ => (WEAPON_HANDLE, 21),
    };
    let empty = slot.records.iter().find(|record| record.handle == 0)
        .ok_or_else(|| SaveError::msg("Tabela de itens do personagem está cheia."))?;
    let growth = size as isize - empty.size as isize;
    let handle = prefix | VALID_HANDLE | (empty.index as u32 & 0xFFFF);
    if growth != 0 {
        let room = slack(data, slot);
        shift_tail(data, empty.offset + empty.size, growth, room)?;
    }
    wu32(data, empty.offset, handle);
    wu32(data, empty.offset + 4, item_id);
    if size >= 16 {
        data[empty.offset + 8..empty.offset + 12].copy_from_slice(&(-1i32).to_le_bytes());
        data[empty.offset + 12..empty.offset + 16].copy_from_slice(&(-1i32).to_le_bytes());
    }
    if size >= 21 {
        wu32(data, empty.offset + 16, 0xFFFF_FFFF);
        data[empty.offset + 20] = 0;
    }
    Ok(handle)
}

fn next_order(slot: &CharacterSlot) -> u32 {
    let mut max = 432u32;
    for item in &slot.inventory.common {
        if occupied(item) && item.order > max && item.order < 0x7FFF_FFFF {
            max = item.order;
        }
    }
    max + 2
}
