use std::path::PathBuf;
use std::sync::Mutex;

use er_gamedata::{all_names, build_catalog, cache_root, search as search_catalog};
use er_save::{
    apply_with, open_bytes,
    session::QuantityChange,
    slot::{active_flag, flag_is_on, read_profile_level, read_profile_name, read_profile_play, steam_id},
    AddedItem, ApplyRequest, CharacterPatch, OpenedSave, SlotOp, WritePolicy,
};
use serde_json::{json, Value};
use sysinfo::System;
use tauri::State;

const CATALOG_FILE: &str = "catalog-v2.sqlite";

struct Editor {
    file: Mutex<Option<String>>,
    opened: Mutex<Option<OpenedSave>>,
    history: Mutex<Vec<Vec<u8>>>,
}

fn summaries(opened: &OpenedSave) -> Vec<Value> {
    let ud10_range = {
        let entry = &opened.save.entries[10];
        entry.payload_offset..entry.payload_offset + entry.payload_size
    };
    let ud10 = &opened.save.buffer[ud10_range];
    let steam = steam_id(ud10).to_string();
    opened.slots.iter().map(|slot| {
        let profile_name = read_profile_name(ud10, slot.index);
        let profile_level = read_profile_level(ud10, slot.index);
        if slot.empty {
            json!({
                "index": slot.index,
                "empty": true,
                "active": active_flag(ud10, slot.index),
                "name": if profile_name.is_empty() { Value::Null } else { json!(profile_name) },
                "level": 0,
                "playSeconds": 0,
                "readOnly": false,
                "steamId": steam,
            })
        } else {
            let player = slot.player.as_ref();
            json!({
                "index": slot.index,
                "empty": false,
                "active": active_flag(ud10, slot.index),
                "name": player.map(|player| player.name.clone()).unwrap_or(profile_name),
                "level": player.map(|player| player.level).unwrap_or(profile_level),
                "playSeconds": read_profile_play(ud10, slot.index),
                "classId": player.map(|player| player.class_id),
                "consistent": slot.consistent,
                "expectedLevel": slot.expected_level,
                "readOnly": slot.read_only,
                "warning": slot.warning,
                "version": slot.version,
                "steamId": steam,
            })
        }
    }).collect()
}

fn list_saves() -> Vec<Value> {
    let Some(appdata) = std::env::var_os("APPDATA") else { return Vec::new() };
    let root = PathBuf::from(appdata).join("EldenRing");
    let Ok(entries) = std::fs::read_dir(&root) else { return Vec::new() };
    let mut saves = Vec::new();
    for entry in entries.flatten() {
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let steam_id = entry.file_name().to_string_lossy().to_string();
        if !steam_id.chars().all(|ch| ch.is_ascii_digit()) {
            continue;
        }
        for name in ["ER0000.sl2", "ER0000.co2"] {
            let path = entry.path().join(name);
            let Ok(meta) = std::fs::metadata(&path) else { continue };
            saves.push(json!({
                "path": path.display().to_string(),
                "fileName": name,
                "steamId": steam_id,
                "bytes": meta.len(),
                "modifiedAt": meta.modified().ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map(|time| time.as_millis() as u64).unwrap_or(0),
                "kind": if name.ends_with(".co2") { "seamless" } else { "steam" },
            }));
        }
    }
    saves.sort_by(|a, b| b["modifiedAt"].as_u64().cmp(&a["modifiedAt"].as_u64()));
    saves
}

fn game_running() -> bool {
    let mut system = System::new();
    system.refresh_processes();
    system.processes().values().any(|process| {
        let name = process.name().to_ascii_lowercase();
        name == "eldenring.exe" || name == "start_protected_game.exe"
    })
}

fn find_game_dir() -> Option<String> {
    if let Some(game) = std::env::var_os("ER_GAME_DIR").map(PathBuf::from) {
        if game.join("regulation.bin").is_file() { return Some(game.display().to_string()); }
    }
    let mut libraries = Vec::new();
    for root in [
        std::env::var_os("ProgramFiles(x86)").map(PathBuf::from),
        std::env::var_os("ER_GAME_DIR").map(PathBuf::from),
        Some(PathBuf::from(r"C:\Program Files\Steam")),
    ].into_iter().flatten() {
        let vdf = root.join("steamapps").join("libraryfolders.vdf");
        if vdf.exists() {
            if let Ok(text) = std::fs::read_to_string(&vdf) {
                for line in text.lines() {
                    let line = line.trim();
                    if let Some(rest) = line.strip_prefix("\"path\"") {
                        let path = rest.trim().trim_matches('"').replace("\\\\", "\\");
                        libraries.push(PathBuf::from(path));
                    }
                }
            }
        }
        libraries.push(root);
    }
    for library in libraries {
        let game = library.join("steamapps").join("common").join("ELDEN RING").join("Game");
        if game.join("eldenring.exe").exists() || game.join("regulation.bin").exists() {
            return Some(game.display().to_string());
        }
    }
    None
}

#[tauri::command]
fn detect() -> Value {
    let saves = list_saves();
    let game_dir = find_game_dir();
    if game_dir.is_none() && saves.is_empty() {
        return json!({ "ok": false, "code": "ERE-01", "error": "Elden Ring não está instalado ou a pasta do jogo não foi encontrada.", "gameRunning": game_running(), "gameDir": null, "saves": saves });
    }
    if saves.is_empty() {
        return json!({ "ok": false, "code": "ERE-02", "error": "Nenhum save ER0000.sl2 ou ER0000.co2 foi encontrado nas contas desta máquina.", "gameRunning": game_running(), "gameDir": game_dir, "saves": saves });
    }
    json!({ "ok": true, "gameRunning": game_running(), "gameDir": game_dir, "saves": saves })
}

#[tauri::command]
fn open_save(file: String, state: State<Editor>) -> Value {
    match std::fs::read(&file).map_err(|error| error.to_string()).and_then(|bytes| open_bytes(&bytes).map_err(|error| error.to_string())) {
        Ok(opened) => {
            let slots = summaries(&opened);
            let mut current = state.file.lock().unwrap();
            if current.as_deref() != Some(file.as_str()) {
                state.history.lock().unwrap().clear();
            }
            *current = Some(file.clone());
            *state.opened.lock().unwrap() = Some(opened);
            json!({ "ok": true, "file": file, "slots": slots })
        }
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

#[tauri::command]
fn slots(state: State<Editor>) -> Value {
    let file = state.file.lock().unwrap().clone().unwrap_or_default();
    let opened = state.opened.lock().unwrap();
    let Some(opened) = opened.as_ref() else {
        return json!({ "ok": false, "code": "ERE-02", "error": "Nenhum save aberto." });
    };
    json!({ "ok": true, "file": file, "slots": summaries(opened) })
}

#[tauri::command]
fn character(slot: usize, state: State<Editor>) -> Value {
    let opened = state.opened.lock().unwrap();
    let Some(opened) = opened.as_ref() else {
        return json!({ "ok": false, "error": "Nenhum save aberto." });
    };
    let Some(parsed) = opened.slots.get(slot) else {
        return json!({ "ok": false, "error": "Slot inexistente." });
    };
    let Some(player) = parsed.player.as_ref() else {
        return json!({ "ok": true, "character": null });
    };
    json!({
        "ok": true,
        "character": {
            "stats": player.stats,
            "level": player.level,
            "runes": player.runes,
            "soulMemory": player.soul_memory,
            "name": player.name,
            "gender": player.gender,
            "classId": player.class_id,
            "voice": player.voice,
            "talismanSlots": player.talisman_slots,
            "scadutree": player.scadutree,
            "shadowBlessing": player.shadow_blessing,
            "consistent": parsed.consistent,
            "expectedLevel": parsed.expected_level,
            "readOnly": parsed.read_only,
            "warning": parsed.warning,
            "version": parsed.version,
        }
    })
}

#[tauri::command]
fn operations() -> Value {
    json!({
        "ok": true,
        "operations": [
            { "id": "set_runes", "category": "Personagem", "risk": "safe", "supportsAmount": true, "amountMax": 999999999, "amountDefault": 999999999, "name": "Definir runas", "description": "Troca as runas que o personagem carrega agora." },
            { "id": "fix_level", "category": "Personagem", "risk": "safe", "name": "Corrigir nível", "description": "Regrava o nível para a soma dos oito atributos menos 79." },
            { "id": "max_blessings", "category": "Personagem", "risk": "moderate", "name": "Bênçãos no máximo", "description": "Sobe a bênção da Árvore Umbral para 20 e a do Reino das Sombras para 10." },
            { "id": "unlock_graces", "category": "Mundo", "risk": "moderate", "name": "Ativar todas as Graças", "description": "Marca as Graças conhecidas como descobertas no mapa." },
            { "id": "unlock_maps", "category": "Mundo", "risk": "moderate", "name": "Revelar fragmentos de mapa", "description": "Marca os fragmentos de mapa listados como obtidos." },
            { "id": "unlock_bosses", "category": "Mundo", "risk": "moderate", "name": "Marcar chefes derrotados", "description": "Liga a flag de cada chefe. Algumas missões usam flags extras e podem não fechar." }
        ]
    })
}

fn world_file() -> Value {
    serde_json::from_str(include_str!("../../data/world.json")).unwrap_or_else(|_| json!({ "graces": [], "bosses": [], "maps": [] }))
}

#[tauri::command]
fn world() -> Value {
    let mut data = world_file();
    data["ok"] = json!(true);
    data
}

fn slot_payload<'a>(opened: &'a OpenedSave, slot: usize) -> &'a [u8] {
    let entry = &opened.save.entries[slot];
    &opened.save.buffer[entry.payload_offset..entry.payload_offset + entry.payload_size]
}

fn item_of(handle: u32, records: &[er_save::slot::Record]) -> (&'static str, u32) {
    match handle >> 28 {
        0x8 => ("weapon", records.iter().find(|record| record.handle == handle).map(|record| record.item_id).unwrap_or(0)),
        0x9 => ("armor", records.iter().find(|record| record.handle == handle).map(|record| record.item_id & 0x0FFF_FFFF).unwrap_or(0)),
        0xA => ("talisman", handle & 0x0FFF_FFFF),
        0xC => ("ash", records.iter().find(|record| record.handle == handle).map(|record| record.item_id & 0x00FF_FFFF).unwrap_or(0)),
        _ => ("goods", handle & 0x0FFF_FFFF),
    }
}

#[tauri::command]
fn inventory(slot: usize, container: Option<String>, state: State<Editor>) -> Value {
    let opened = state.opened.lock().unwrap();
    let Some(opened) = opened.as_ref() else {
        return json!({ "ok": false, "error": "Nenhum save aberto." });
    };
    let Some(parsed) = opened.slots.get(slot) else {
        return json!({ "ok": false, "error": "Slot inexistente." });
    };
    let storage = container.as_deref() == Some("storage");
    let lists: Vec<(&str, &Vec<er_save::slot::InvItem>)> = if storage {
        vec![("storage", &parsed.storage.common)]
    } else {
        vec![("inventory", &parsed.inventory.common), ("key", &parsed.inventory.key)]
    };
    let mut items = Vec::new();
    for (name, list) in lists {
        for item in list.iter().filter(|item| item.handle != 0 && item.handle != 0xFFFF_FFFF) {
            let (kind, param_id) = item_of(item.handle, &parsed.records);
            items.push(json!({
                "container": name,
                "index": item.index,
                "handle": item.handle,
                "quantity": item.quantity,
                "kind": kind,
                "paramId": param_id,
                "name": format!("{kind} {param_id}"),
            }));
        }
    }
    json!({ "ok": true, "items": items })
}

const EQUIP_SLOTS: &[(usize, &str, &str)] = &[
    (1, "right", "Mão direita 1"), (3, "right", "Mão direita 2"), (5, "right", "Mão direita 3"),
    (0, "left", "Mão esquerda 1"), (2, "left", "Mão esquerda 2"), (4, "left", "Mão esquerda 3"),
    (6, "ammo", "Flecha 1"), (8, "ammo", "Flecha 2"), (7, "ammo", "Virote 1"), (9, "ammo", "Virote 2"),
    (12, "armor", "Cabeça"), (13, "armor", "Peito"), (14, "armor", "Braços"), (15, "armor", "Pernas"),
    (17, "talisman", "Talismã 1"), (18, "talisman", "Talismã 2"), (19, "talisman", "Talismã 3"), (20, "talisman", "Talismã 4"),
];

#[tauri::command]
fn equipment(slot: usize, state: State<Editor>) -> Value {
    let opened = state.opened.lock().unwrap();
    let Some(opened) = opened.as_ref() else {
        return json!({ "ok": false, "error": "Nenhum save aberto." });
    };
    let Some(parsed) = opened.slots.get(slot) else {
        return json!({ "ok": false, "error": "Slot inexistente." });
    };
    let Some(layout) = &parsed.layout else {
        return json!({ "ok": false, "error": "Equipamento indisponível." });
    };
    let data = slot_payload(opened, slot);
    let read = |at: usize| u32::from_le_bytes(data[at..at + 4].try_into().unwrap());
    let items: Vec<Value> = EQUIP_SLOTS.iter().map(|(index, group, label)| {
        let handle = read(layout.handles + index * 4);
        let raw = read(layout.item_ids + index * 4);
        let empty = handle == 0 || handle == 0xFFFF_FFFF || raw == 0xFFFF_FFFF;
        let kind = match handle >> 28 { 0x8 => "weapon", 0x9 => "armor", 0xA => "talisman", _ => "goods" };
        let param_id = if kind == "weapon" { raw } else { raw & 0x0FFF_FFFF };
        json!({ "slot": index, "group": group, "label": label, "empty": empty, "kind": kind, "handle": handle, "paramId": if empty { Value::Null } else { json!(param_id) } })
    }).collect();
    json!({ "ok": true, "items": items })
}

#[tauri::command]
fn appearance(slot: usize, state: State<Editor>) -> Value {
    let opened = state.opened.lock().unwrap();
    let Some(opened) = opened.as_ref() else {
        return json!({ "ok": false, "error": "Nenhum save aberto." });
    };
    let Some(parsed) = opened.slots.get(slot) else {
        return json!({ "ok": false, "error": "Slot inexistente." });
    };
    let Some(layout) = &parsed.layout else {
        return json!({ "ok": false, "error": "Aparência indisponível." });
    };
    let data = slot_payload(opened, slot);
    if layout.face + 0x12F > data.len() {
        return json!({ "ok": false, "error": "Aparência fora do personagem." });
    }
    json!({
        "ok": true,
        "gender": parsed.player.as_ref().map(|player| player.gender).unwrap_or(0),
        "bytes": data[layout.face..layout.face + 0x12F],
    })
}

#[tauri::command]
fn flags(slot: usize, ids: Vec<u32>, state: State<Editor>) -> Value {
    let opened = state.opened.lock().unwrap();
    let Some(opened) = opened.as_ref() else {
        return json!({ "ok": true, "flags": [] });
    };
    let Some(parsed) = opened.slots.get(slot) else {
        return json!({ "ok": true, "flags": [] });
    };
    let data = slot_payload(opened, slot);
    let rows: Vec<Value> = ids.into_iter().map(|id| json!({ "id": id, "on": flag_is_on(data, parsed, id) })).collect();
    json!({ "ok": true, "flags": rows })
}

fn number(value: &Value) -> Option<u32> {
    value.as_u64().map(|item| item as u32).or_else(|| value.as_i64().map(|item| item as u32))
}

fn request_from_json(value: &Value) -> ApplyRequest {
    let slot = value.get("slot").and_then(number).unwrap_or(0) as usize;
    let character = value.get("character").and_then(|item| item.as_object()).map(|object| {
        let stats = object.get("stats").and_then(|item| item.as_array()).map(|list| {
            let mut stats = [1u32; 8];
            for (index, value) in list.iter().take(8).enumerate() {
                stats[index] = number(value).unwrap_or(1);
            }
            stats
        });
        CharacterPatch {
            name: object.get("name").and_then(|item| item.as_str()).map(str::to_string),
            stats,
            runes: object.get("runes").and_then(number),
            class_id: object.get("classId").and_then(number).map(|item| item as u8),
            gender: object.get("gender").and_then(number).map(|item| item as u8),
            fix_level: object.get("fixLevel").and_then(|item| item.as_bool()).unwrap_or(false),
            scadutree: object.get("scadutree").and_then(number).map(|item| item as u8),
            shadow_blessing: object.get("shadowBlessing").and_then(number).map(|item| item as u8),
            ..Default::default()
        }
    });
    let mut flags = value.get("flags").and_then(|item| item.as_array()).map(|list| {
        list.iter().filter_map(|flag| {
            let id = flag.get("id").and_then(number)?;
            let on = flag.get("on").and_then(|item| item.as_bool()).unwrap_or(true);
            Some((id, on))
        }).collect::<Vec<(u32, bool)>>()
    }).unwrap_or_default();
    let add = value.get("add").and_then(|item| item.as_array()).map(|list| {
        list.iter().filter_map(|item| {
            Some(AddedItem {
                kind: item.get("kind")?.as_str()?.to_string(),
                param_id: item.get("paramId").and_then(number)?,
                quantity: item.get("quantity").and_then(number).unwrap_or(1),
                max_num: item.get("maxNum").and_then(number).unwrap_or(0),
            })
        }).collect()
    }).unwrap_or_default();
    let slot_ops = value.get("slotOps").and_then(|item| item.as_array()).map(|list| {
        list.iter().filter_map(|op| {
            let kind = op.get("type").and_then(|item| item.as_str())?;
            let index = |key: &str| op.get(key).and_then(number).unwrap_or(0) as usize;
            Some(match kind {
                "delete" => SlotOp::Delete { slot: index("slot") },
                "clone" => SlotOp::Clone { from: index("from"), to: index("to") },
                "move" => SlotOp::Move { from: index("from"), to: index("to") },
                "swap" => SlotOp::Swap { a: index("a"), b: index("b") },
                _ => return None,
            })
        }).collect()
    }).unwrap_or_default();
    if let Some(ids) = value.get("opIds").and_then(|item| item.as_array()) {
        let amounts = value.get("amounts").cloned().unwrap_or_else(|| json!({}));
        let mut patch = character.unwrap_or_default();
        for id in ids.iter().filter_map(|item| item.as_str()) {
            match id {
                "set_runes" => patch.runes = amounts.get(id).and_then(number).or(Some(999_999_999)),
                "fix_level" => patch.fix_level = true,
                "max_blessings" => {
                    patch.scadutree = Some(20);
                    patch.shadow_blessing = Some(10);
                }
                "unlock_graces" | "unlock_maps" | "unlock_bosses" => {
                    let key = match id {
                        "unlock_graces" => "graces",
                        "unlock_maps" => "maps",
                        _ => "bosses",
                    };
                    if let Some(rows) = world_file().get(key).and_then(|item| item.as_array()) {
                        for row in rows {
                            if let Some(flag) = row.get("flag").and_then(number).or_else(|| row.get("id").and_then(number)) {
                                flags.push((flag, true));
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        let has_character = patch.runes.is_some() || patch.fix_level || patch.scadutree.is_some() || patch.shadow_blessing.is_some()
            || patch.name.is_some() || patch.stats.is_some() || patch.class_id.is_some() || patch.gender.is_some();
        return ApplyRequest {
            copy_build: copy_build(value),
            slot,
            character: if has_character { Some(patch) } else { None },
            flags,
            add,
            slot_ops,
            quantities: quantity_changes(value),
            face: face_bytes(value),
            transforms: transforms(value),
            remove: removed(value),
            equip: equipped(value),
            copy_face_from: value.get("copyFaceFrom").and_then(number).map(|item| item as usize),
        };
    }
    ApplyRequest {
        copy_build: copy_build(value),
        slot,
        character,
        flags,
        add,
        slot_ops,
        quantities: quantity_changes(value),
        face: face_bytes(value),
        transforms: transforms(value),
        remove: removed(value),
        equip: equipped(value),
        copy_face_from: value.get("copyFaceFrom").and_then(number).map(|item| item as usize),
    }
}

fn equipped(value: &Value) -> Vec<er_save::session::EquipChange> {
    value.get("equip").and_then(|item| item.as_array()).map(|list| {
        list.iter().filter_map(|change| Some(er_save::session::EquipChange {
            index: number(change.get("index")?)? as usize,
            handle: number(change.get("handle")?)?,
        })).collect()
    }).unwrap_or_default()
}

fn transforms(value: &Value) -> Vec<er_save::session::ItemTransform> {
    value.get("transform").and_then(|item| item.as_array()).map(|list| {
        list.iter().filter_map(|change| {
            let handle = change.get("handle").and_then(number)?;
            let current = change.get("paramId").and_then(number).unwrap_or(0);
            let base = current / 10_000 * 10_000;
            let rest = current % 10_000;
            let infusion = change.get("infusion").and_then(number).unwrap_or(rest / 100);
            let level = change.get("level").and_then(number).unwrap_or(rest % 100);
            Some(er_save::session::ItemTransform { handle, param_id: base + infusion * 100 + level })
        }).collect()
    }).unwrap_or_default()
}

fn copy_build(value: &Value) -> Option<er_save::CopyBuild> {
    let copy = value.get("copyBuild")?;
    let flag = |key: &str| copy.get(key).and_then(|item| item.as_bool()).unwrap_or(false);
    Some(er_save::CopyBuild {
        from: copy.get("from").and_then(number)? as usize,
        stats: flag("stats"),
        appearance: flag("appearance"),
        equipment: flag("equipment"),
        spells: flag("spells"),
    })
}

fn removed(value: &Value) -> Vec<u32> {
    value.get("remove").and_then(|item| item.as_array()).map(|list| list.iter().filter_map(number).collect()).unwrap_or_default()
}

fn quantity_changes(value: &Value) -> Vec<QuantityChange> {
    value.get("quantities").and_then(|item| item.as_array()).map(|list| {
        list.iter().filter_map(|change| Some(QuantityChange {
            container: change.get("container").and_then(|item| item.as_str()).unwrap_or("inventory").to_string(),
            index: number(change.get("index")?)? as usize,
            quantity: number(change.get("quantity")?)?,
        })).collect()
    }).unwrap_or_default()
}

fn face_bytes(value: &Value) -> Option<Vec<u8>> {
    value.get("face").and_then(|item| item.as_array()).map(|list| list.iter().filter_map(|byte| number(byte).map(|value| value as u8)).collect())
}

#[tauri::command]
fn apply(request: Value, state: State<Editor>) -> Value {
    if game_running() {
        return json!({ "ok": false, "code": "ERE-03", "error": "O jogo está aberto. Feche o Elden Ring antes de gravar o save." });
    }
    let file = state.file.lock().unwrap().clone();
    let Some(file) = file else {
        return json!({ "ok": false, "error": "Nenhum save aberto." });
    };
    let bytes = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(error) => return json!({ "ok": false, "error": error.to_string() }),
    };
    let backup = match write_backup(&file, "auto", &bytes) {
        Ok(backup) => backup,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    let parsed = request_from_json(&request);
    match apply_with(&bytes, &parsed, WritePolicy { sync_profile: true, refresh_hash: true }) {
        Ok(next) => {
            match replace_save(&file, &next, &state) {
                Ok(slots) => {
                    remember(&state, bytes);
                    json!({ "ok": true, "backup": backup.display().to_string(), "slots": slots })
                },
                Err(error) => json!({ "ok": false, "error": error }),
            }
        }
        Err(error) => json!({ "ok": false, "error": error.to_string(), "reverted": true }),
    }
}

fn backup_dir(file: &str) -> PathBuf {
    PathBuf::from(file).parent().unwrap_or(std::path::Path::new(".")).join("_editor_backups")
}

fn write_backup(file: &str, label: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let dir = backup_dir(file);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|time| time.as_millis()).unwrap_or(0);
    let label: String = label.chars().map(|ch| if ch.is_alphanumeric() || ch == '-' || ch == '.' { ch } else { '-' }).take(40).collect();
    let label = if label.trim_matches('-').is_empty() { "manual".to_string() } else { label };
    let name = PathBuf::from(file).file_name().and_then(|name| name.to_str()).unwrap_or("ER0000.sl2").to_string();
    let mut path = dir.join(format!("{stamp}__{label}__{name}"));
    let mut extra = 1;
    while path.exists() {
        path = dir.join(format!("{stamp}-{extra}__{label}__{name}"));
        extra += 1;
    }
    std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path)
}

fn remember(state: &Editor, bytes: Vec<u8>) {
    let mut history = state.history.lock().unwrap();
    history.push(bytes);
    if history.len() > 8 {
        history.remove(0);
    }
}

fn replace_save(file: &str, next: &[u8], state: &Editor) -> Result<Vec<Value>, String> {
    let opened = open_bytes(next).map_err(|error| error.to_string())?;
    let temp = format!("{file}.tmp");
    std::fs::write(&temp, next).map_err(|error| error.to_string())?;
    std::fs::rename(&temp, file).map_err(|error| error.to_string())?;
    let slots = summaries(&opened);
    *state.opened.lock().unwrap() = Some(opened);
    Ok(slots)
}

fn open_file(state: &State<Editor>) -> Result<String, Value> {
    state.file.lock().unwrap().clone().ok_or_else(|| json!({ "ok": false, "error": "Nenhum save aberto." }))
}

fn closed_game() -> Result<(), Value> {
    if game_running() {
        return Err(json!({ "ok": false, "code": "ERE-03", "error": "O jogo está aberto. Feche o Elden Ring antes de gravar o save." }));
    }
    Ok(())
}

#[tauri::command]
fn backups(state: State<Editor>) -> Value {
    let file = match open_file(&state) { Ok(file) => file, Err(error) => return error };
    let save_name = PathBuf::from(&file).file_name().and_then(|name| name.to_str()).unwrap_or("").to_string();
    let Ok(entries) = std::fs::read_dir(backup_dir(&file)) else { return json!({ "ok": true, "backups": [] }) };
    let mut rows: Vec<Value> = entries.flatten().filter_map(|entry| {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(&save_name) || name.ends_with(".json") {
            return None;
        }
        let meta = entry.metadata().ok()?;
        let parts: Vec<&str> = name.splitn(3, "__").collect();
        let label = if parts.len() == 3 { parts[1].to_string() } else { name.clone() };
        let side: Option<Value> = std::fs::read_to_string(entry.path().with_file_name(format!("{name}.json"))).ok().and_then(|text| serde_json::from_str(&text).ok());
        let stamp = parts.first().and_then(|stamp| stamp.split('-').next()).and_then(|stamp| stamp.parse::<u64>().ok()).filter(|stamp| *stamp > 1_000_000_000_000);
        let modified = meta.modified().ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map(|time| time.as_millis() as u64).unwrap_or(0);
        let created = side.as_ref().and_then(|side| side["createdAt"].as_u64()).or(stamp).unwrap_or(modified);
        Some(json!({
            "path": entry.path().display().to_string(),
            "file": name,
            "label": label,
            "automatic": label == "auto",
            "createdAt": created,
            "bytes": meta.len(),
        }))
    }).collect();
    rows.sort_by(|a, b| b["createdAt"].as_u64().cmp(&a["createdAt"].as_u64()));
    json!({ "ok": true, "backups": rows })
}

#[tauri::command]
fn backup_now(label: Option<String>, state: State<Editor>) -> Value {
    let file = match open_file(&state) { Ok(file) => file, Err(error) => return error };
    match std::fs::read(&file).map_err(|error| error.to_string()).and_then(|bytes| write_backup(&file, label.as_deref().unwrap_or("manual"), &bytes)) {
        Ok(path) => json!({ "ok": true, "backup": path.display().to_string() }),
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

#[tauri::command]
fn restore(file: String, state: State<Editor>) -> Value {
    if let Err(error) = closed_game() { return error; }
    let save = match open_file(&state) { Ok(save) => save, Err(error) => return error };
    let dir = backup_dir(&save).canonicalize().ok();
    let chosen = PathBuf::from(&file).canonicalize().ok();
    if dir.is_none() || chosen.as_ref().and_then(|path| path.parent().map(PathBuf::from)) != dir {
        return json!({ "ok": false, "error": "O backup não está na pasta deste save." });
    }
    let result = (|| {
        let incoming = std::fs::read(&file).map_err(|error| error.to_string())?;
        open_bytes(&incoming).map_err(|_| "Esse backup não é um save legível.".to_string())?;
        let current = std::fs::read(&save).map_err(|error| error.to_string())?;
        write_backup(&save, "antes-de-restaurar", &current)?;
        let slots = replace_save(&save, &incoming, &state)?;
        remember(&state, current);
        Ok::<_, String>(slots)
    })();
    match result {
        Ok(slots) => json!({ "ok": true, "slots": slots }),
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

#[tauri::command]
fn prune(dry_run: Option<bool>, state: State<Editor>) -> Value {
    const KEEP: usize = 10;
    let listed = backups(state);
    let automatic: Vec<&Value> = listed["backups"].as_array().map(|rows| rows.iter().filter(|row| row["automatic"] == true).collect()).unwrap_or_default();
    let extra: Vec<&Value> = automatic.iter().skip(KEEP).copied().collect();
    if dry_run != Some(false) {
        return json!({ "ok": true, "removed": extra.len(), "kept": automatic.len().min(KEEP), "dryRun": true });
    }
    let mut removed = 0;
    for row in extra {
        if let Some(path) = row["path"].as_str() {
            if std::fs::remove_file(path).is_ok() {
                removed += 1;
            }
            let _ = std::fs::remove_file(format!("{path}.json"));
        }
    }
    json!({ "ok": true, "removed": removed, "dryRun": false })
}

#[tauri::command]
fn delete_save(state: State<Editor>) -> Value {
    if let Err(error) = closed_game() { return error; }
    let file = match open_file(&state) { Ok(file) => file, Err(error) => return error };
    let result = std::fs::read(&file).map_err(|error| error.to_string())
        .and_then(|bytes| write_backup(&file, "antes-de-apagar", &bytes))
        .and_then(|backup| std::fs::remove_file(&file).map(|_| backup).map_err(|error| error.to_string()));
    match result {
        Ok(backup) => {
            *state.file.lock().unwrap() = None;
            *state.opened.lock().unwrap() = None;
            state.history.lock().unwrap().clear();
            json!({ "ok": true, "backup": backup.display().to_string() })
        }
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

// Export exact on-disk bytes, preserving .sl2/.co2 and never overwriting a save.
fn copy_save_file(file: &str) -> Result<PathBuf, String> {
    use std::io::Write;
    let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
    open_bytes(&bytes).map_err(|e| e.to_string())?;
    let source = PathBuf::from(file);
    let dir = source.parent().unwrap_or(std::path::Path::new(".")).join("_editor_exports");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let name = source.file_name().and_then(|s| s.to_str()).unwrap_or("ER0000.sl2");
    let path = dir.join(format!("copy-{stamp}-{name}"));
    let mut output = std::fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| e.to_string())?;
    if let Err(error) = output.write_all(&bytes).and_then(|_| output.sync_all()) {
        drop(output);
        let _ = std::fs::remove_file(&path);
        return Err(error.to_string());
    }
    Ok(path)
}

#[tauri::command]
fn save_copy(state: State<Editor>) -> Value {
    if let Err(error) = closed_game() { return error; }
    let file = match open_file(&state) { Ok(file) => file, Err(error) => return error };
    match copy_save_file(&file) {
        Ok(path) => {
            let _ = tauri_plugin_opener::reveal_item_in_dir(&path);
            json!({ "ok": true, "path": path.display().to_string() })
        }
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

fn exports_dir() -> PathBuf {
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    home.join("Documents").join("Elden Ring Save Editor")
}

fn safe_name(name: &str) -> String {
    let cleaned: String = name.chars().map(|ch| if ch.is_alphanumeric() || " -_.".contains(ch) { ch } else { '_' }).collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() { "personagem".into() } else { cleaned }
}

fn write_export(name: &str, bytes: &[u8]) -> Value {
    let dir = exports_dir();
    if let Err(error) = std::fs::create_dir_all(&dir) {
        return json!({ "ok": false, "error": error.to_string() });
    }
    let path = dir.join(safe_name(name));
    match std::fs::write(&path, bytes) {
        Ok(()) => {
            let _ = tauri_plugin_opener::reveal_item_in_dir(&path);
            json!({ "ok": true, "path": path.display().to_string() })
        }
        Err(error) => json!({ "ok": false, "error": error.to_string() }),
    }
}

#[tauri::command]
fn export_slot(slot: usize, state: State<Editor>) -> Value {
    let opened = state.opened.lock().unwrap();
    let Some(opened) = opened.as_ref() else { return json!({ "ok": false, "error": "Nenhum save aberto." }) };
    let Some(parsed) = opened.slots.get(slot).filter(|parsed| !parsed.empty) else {
        return json!({ "ok": false, "error": "Slot vazio." });
    };
    let name = parsed.player.as_ref().map(|player| player.name.clone()).unwrap_or_else(|| format!("slot-{}", slot + 1));
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|time| time.as_secs()).unwrap_or(0);
    write_export(&format!("{name}-{stamp}.slot"), slot_payload(opened, slot))
}

#[tauri::command]
fn save_text(name: String, text: String) -> Value {
    write_export(&name, text.as_bytes())
}

#[tauri::command]
fn import_character(data: String, to: usize, from: Option<usize>, state: State<Editor>) -> Value {
    use base64::Engine;
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()) else {
        return json!({ "ok": false, "error": "Arquivo ilegível." });
    };
    let request = json!({ "slot": to });
    let mut parsed = request_from_json(&request);
    parsed.slot_ops = vec![SlotOp::Import { to, from, bytes }];
    if let Err(error) = closed_game() { return error; }
    let file = match open_file(&state) { Ok(file) => file, Err(error) => return error };
    let current = match std::fs::read(&file) { Ok(bytes) => bytes, Err(error) => return json!({ "ok": false, "error": error.to_string() }) };
    if let Err(error) = write_backup(&file, "antes-de-importar", &current) {
        return json!({ "ok": false, "error": error });
    }
    match apply_with(&current, &parsed, WritePolicy { sync_profile: true, refresh_hash: true }) {
        Ok(next) => {
            match replace_save(&file, &next, &state) {
                Ok(slots) => {
                    remember(&state, current);
                    json!({ "ok": true, "slots": slots })
                },
                Err(error) => json!({ "ok": false, "error": error }),
            }
        }
        Err(error) => json!({ "ok": false, "error": error.to_string() }),
    }
}

#[tauri::command]
fn mods_status(game_dir: Option<String>) -> Value {
    let Some(game) = game_dir.or_else(find_game_dir) else {
        return json!({ "ok": false, "error": "Pasta do Elden Ring não encontrada." });
    };
    let status = er_gamedata::mods::status(std::path::Path::new(&game));
    json!({ "ok": status.has_original, "status": status, "usingMod": status.using_mod, "ours": status.ours, "canRevert": status.can_revert, "preset": status.preset })
}

#[tauri::command]
async fn mods_apply(game_dir: Option<String>, preset: Value) -> Value {
    if let Err(error) = closed_game() { return error; }
    let Some(game) = game_dir.or_else(find_game_dir) else {
        return json!({ "ok": false, "error": "Pasta do Elden Ring não encontrada." });
    };
    let preset: er_gamedata::mods::Preset = serde_json::from_value(preset).unwrap_or_default();
    match er_gamedata::mods::apply(std::path::Path::new(&game), &preset) {
        Ok(counts) => json!({ "ok": true, "counts": counts }),
        Err(error) => json!({ "ok": false, "error": error.to_string() }),
    }
}

#[tauri::command]
fn mods_revert(game_dir: Option<String>) -> Value {
    if let Err(error) = closed_game() { return error; }
    let Some(game) = game_dir.or_else(find_game_dir) else {
        return json!({ "ok": false, "error": "Pasta do Elden Ring não encontrada." });
    };
    match er_gamedata::mods::revert(std::path::Path::new(&game)) {
        Ok(()) => json!({ "ok": true }),
        Err(error) => json!({ "ok": false, "error": error.to_string() }),
    }
}

#[tauri::command]
fn item_icon(id: u32) -> Value {
    use base64::Engine;
    let file = cache_root().join("icons").join(format!("icon_{id:05}.png"));
    match std::fs::read(file) {
        Ok(bytes) if bytes.len() <= 2_000_000 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") => json!({"ok":true,"image":format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(bytes))}),
        _ => json!({"ok":false}),
    }
}

#[tauri::command]
fn catalog_all(lang: String) -> Value {
    let database = cache_root().join(CATALOG_FILE);
    if !database.exists() {
        return json!({ "ok": false, "missing": true, "gameDir": find_game_dir() });
    }
    let language = if lang.starts_with("pt") { "porbr" } else { "engus" };
    match all_names(&database, language) {
        Ok(rows) if !rows.is_empty() => json!({ "ok": true, "rows": rows }),
        Ok(_) => json!({ "ok": false, "missing": true, "gameDir": find_game_dir() }),
        Err(error) => json!({ "ok": false, "error": error.to_string() }),
    }
}

static WORLD_MAP: std::sync::OnceLock<Value> = std::sync::OnceLock::new();

fn build_world_map() -> Value {
    let Some(game) = find_game_dir() else {
        return json!({ "ok": false, "error": "Pasta do Elden Ring não encontrada." });
    };
    let game = PathBuf::from(game);
    let mut maps = Vec::new();
    let mut images = Vec::new();
    for spec in er_gamedata::worldmap::MAPS.iter() {
        let cached = match er_gamedata::worldmap::cached(&game, spec) {
            Ok(cached) => cached,
            Err(error) => return json!({ "ok": false, "error": error.to_string() }),
        };
        let label = if spec.id == "M10" { "Terra das Sombras" } else { "Terras Intermédias" };
        images.push(json!({
            "id": spec.id,
            "label": label,
            "width": cached.width,
            "height": cached.height,
            "file": cached.file.display().to_string(),
        }));
        maps.push(cached);
    }
    match er_gamedata::worldmap::grace_points(&game, &maps) {
        Ok(points) => json!({ "ok": true, "maps": images, "points": points }),
        Err(error) => json!({ "ok": false, "error": error.to_string() }),
    }
}

#[tauri::command]
async fn world_map() -> Value {
    if let Some(value) = WORLD_MAP.get() {
        return value.clone();
    }
    let value = build_world_map();
    if value["ok"].as_bool() == Some(true) {
        let _ = WORLD_MAP.set(value.clone());
    }
    value
}

#[tauri::command]
fn world_map_image(file: String) -> Value {
    use base64::Engine;
    let root = match cache_root().canonicalize() {
        Ok(path) => path,
        Err(error) => return json!({ "ok": false, "error": error.to_string() }),
    };
    let path = match PathBuf::from(&file).canonicalize() {
        Ok(path) => path,
        Err(_) => return json!({ "ok": false, "error": "Imagem do mapa ausente." }),
    };
    if !path.starts_with(&root) || path.extension().and_then(|ext| ext.to_str()) != Some("jpg") {
        return json!({ "ok": false, "error": "Caminho do mapa recusado." });
    }
    match std::fs::read(&path) {
        Ok(bytes) => json!({
            "ok": true,
            "image": format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)),
        }),
        Err(error) => json!({ "ok": false, "error": error.to_string() }),
    }
}

#[tauri::command]
async fn catalog_build() -> Value {
    let Some(game) = find_game_dir() else {
        return json!({ "ok": false, "error": "Pasta do Elden Ring não encontrada." });
    };
    let database = cache_root().join(CATALOG_FILE);
    match build_catalog(std::path::Path::new(&game), &database) {
        Ok(stats) => json!({ "ok": true, "stats": stats }),
        Err(error) => json!({ "ok": false, "error": error.to_string() }),
    }
}

#[tauri::command]
fn catalog_search(lang: String, query: String) -> Value {
    let database = cache_root().join(CATALOG_FILE);
    if !database.exists() {
        return json!({ "ok": false, "error": "Catálogo ainda não foi lido do jogo." });
    }
    let language = if lang.starts_with("pt") { "porbr" } else { "engus" };
    match search_catalog(&database, language, &query, 80) {
        Ok(items) => json!({ "ok": true, "items": items }),
        Err(error) => json!({ "ok": false, "error": error.to_string() }),
    }
}

#[tauri::command]
fn undo(state: State<Editor>) -> Value {
    if game_running() {
        return json!({ "ok": false, "code": "ERE-03", "error": "O jogo está aberto. Feche o Elden Ring antes de gravar o save." });
    }
    undo_saved(&state)
}

fn undo_saved(state: &Editor) -> Value {
    let Some(previous) = state.history.lock().unwrap().last().cloned() else {
        return json!({ "ok": false, "error": "Nada para desfazer." });
    };
    let file = state.file.lock().unwrap().clone();
    let Some(file) = file else {
        return json!({ "ok": false, "error": "Nenhum save aberto." });
    };
    // Undo must back up the current save and keep its history entry on failure.
    let current = match std::fs::read(&file) {
        Ok(bytes) => bytes,
        Err(error) => return json!({ "ok": false, "error": error.to_string() }),
    };
    let backup = match write_backup(&file, "antes-de-desfazer", &current) {
        Ok(backup) => backup,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    match replace_save(&file, &previous, state) {
        Ok(slots) => {
            state.history.lock().unwrap().pop();
            json!({ "ok": true, "slots": slots, "backup": backup.display().to_string() })
        },
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

#[cfg(all(test, feature = "private-fixtures"))]
mod undo_tests {
    use super::*;

    #[test]
    fn copies_whole_save_without_overwriting_source_or_previous_exports() {
        let bytes = std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../Save/ER0000.sl2")).unwrap();
        let dir = std::env::temp_dir().join(format!("er-copy-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("ER0000.co2");
        std::fs::write(&source, &bytes).unwrap();
        let a = copy_save_file(source.to_str().unwrap()).unwrap();
        let b = copy_save_file(source.to_str().unwrap()).unwrap();
        assert_ne!(a, b);
        assert_eq!(a.extension().unwrap(), "co2");
        for file in [&source, &a, &b] { assert_eq!(std::fs::read(file).unwrap(), bytes); }
        let invalid = dir.join("invalid.sl2");
        std::fs::write(&invalid, b"invalid").unwrap();
        assert!(copy_save_file(invalid.to_str().unwrap()).is_err());
        assert_eq!(std::fs::read_dir(dir.join("_editor_exports")).unwrap().count(), 2);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn undo_backs_up_current_bytes_and_retains_history_after_io_failure() {
        let original = std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../Save/ER0000.sl2")).unwrap();
        let changed = apply_with(&original, &ApplyRequest {
            slot: 0,
            character: Some(CharacterPatch { name: Some("Undo test".into()), ..Default::default() }),
            ..Default::default()
        }, WritePolicy { sync_profile: true, refresh_hash: true }).unwrap();
        let dir = std::env::temp_dir().join(format!("er-undo-test-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("test.sl2");
        std::fs::write(&file, &changed).unwrap();
        let editor = Editor {
            file: Mutex::new(Some(file.display().to_string())),
            opened: Mutex::new(Some(open_bytes(&changed).unwrap())),
            history: Mutex::new(vec![original.clone()]),
        };
        // A directory at the temporary-file path forces a replacement failure.
        let blocked = dir.join("test.sl2.tmp");
        std::fs::create_dir(&blocked).unwrap();
        assert_eq!(undo_saved(&editor)["ok"], false);
        assert_eq!(editor.history.lock().unwrap().len(), 1);
        assert_eq!(std::fs::read(&file).unwrap(), changed);
        std::fs::remove_dir(&blocked).unwrap();
        let result = undo_saved(&editor);
        assert_eq!(result["ok"], true);
        assert_eq!(std::fs::read(result["backup"].as_str().unwrap()).unwrap(), changed);
        assert_eq!(std::fs::read(&file).unwrap(), original);
        assert!(editor.history.lock().unwrap().is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Editor { file: Mutex::new(None), opened: Mutex::new(None), history: Mutex::new(Vec::new()) })
        .invoke_handler(tauri::generate_handler![detect, open_save, slots, character, operations, world, inventory, equipment, appearance, flags, apply, undo, catalog_build, catalog_search, catalog_all, world_map, world_map_image,
            item_icon, backups, backup_now, save_copy, restore, prune, delete_save, export_slot, save_text, import_character, mods_status, mods_apply, mods_revert])
        .run(tauri::generate_context!())
        .expect("erro ao abrir o Elden Ring Save Editor");
}

#[cfg(all(test, feature = "custom-protocol"))]
mod bundled_assets_tests {
    #[test]
    fn every_manifest_icon_is_embedded_in_the_native_application() {
        let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        let manifest: serde_json::Value = serde_json::from_str(include_str!("../../src/icon-manifest.json")).unwrap();
        for file in manifest["files"].as_object().unwrap().keys() {
            let key = format!("/icons/{file}");
            let bytes = context.assets().get(&key.into()).unwrap_or_else(|| panic!("Missing embedded icon: {file}"));
            assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"), "Invalid embedded PNG: {file}");
        }
    }
}
