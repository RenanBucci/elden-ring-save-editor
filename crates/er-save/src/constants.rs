pub const SLOT_COUNT: usize = 10;
pub const SLOT_PAYLOAD: usize = 0x280000;
pub const UD10_PAYLOAD: usize = 0x60000;
pub const HEADER_SIZE: usize = 0x40;
pub const ENTRY_SIZE: usize = 0x20;
pub const ENTRY_COUNT: usize = 12;

pub const GA_START: usize = 0x20;
pub const GA_COUNT_OLD: usize = 0x13FE;
pub const GA_COUNT_NEW: usize = 0x1400;
pub const GA_VERSION_BREAK: u32 = 81;
pub const MAX_VERSION: u32 = 512;

pub const MAGIC_BEFORE_PGD: usize = 0x1AF;
pub const PLAYER_DATA_SIZE: usize = 0x1B0;

pub const SP_EFFECT: usize = 0xD0;
pub const EQUIP_INDEX: usize = 0x58;
pub const ACTIVE_SLOTS: usize = 0x1C;
pub const ITEM_IDS: usize = 0x58;
pub const HANDLES: usize = 0x58;
pub const INVENTORY: usize = 0x9010;
pub const SPELLS: usize = 0x74;
pub const QUICK_ITEMS: usize = 0x8C;
pub const EQUIP_GESTURES: usize = 0x18;
pub const ARMAMENTS: usize = 0x9C;
pub const PHYSICS: usize = 0x0C;
pub const FACE: usize = 0x12F;
pub const STORAGE: usize = 0x6010;
pub const GESTURE_LIST: usize = 0x100;
pub const HORSE: usize = 0x29;
pub const BLOOD_GAP: usize = 0x4C;
pub const MENU_PROFILE: usize = 0x103C;
pub const GA_ITEM_DATA: usize = 0x1B588;
pub const TUTORIAL: usize = 0x40B;
pub const PRE_FLAGS: usize = 0x1A;

pub const INV_FROM_MAGIC: isize = 505;
pub const COMMON_SLOTS: usize = 0xA80;
pub const KEY_SLOTS: usize = 0x180;
pub const STORAGE_COMMON: usize = 0x780;
pub const STORAGE_KEY: usize = 0x80;
pub const RECORD_LEN: usize = 12;

pub const STAT_DELTA: [isize; 8] = [-379, -375, -371, -367, -363, -359, -355, -351];

pub const OFF_LEVEL: isize = -335;
pub const OFF_RUNES: isize = -331;
pub const OFF_SOUL_MEMORY: isize = -327;
pub const OFF_NAME: isize = -0x11B;
pub const OFF_GENDER: isize = -249;
pub const OFF_CLASS: isize = -248;
pub const OFF_VOICE: isize = -245;
pub const OFF_TALISMAN_SLOTS: isize = -241;
pub const OFF_SCADUTREE: isize = -187;
pub const OFF_SHADOW: isize = -186;

pub const UD10_STEAM_ID: usize = 0x04;
pub const UD10_ACTIVE: usize = 0x1954;
pub const UD10_PROFILES: usize = 0x195E;
pub const UD10_PROFILE_STRIDE: usize = 0x24C;
pub const UD10_PROFILE_LEVEL: usize = 34;

pub const EVENT_FLAG_BYTES: usize = 0x1BF99F;

pub const AES_KEY: [u8; 16] = [
    0x99, 0xAD, 0x2D, 0x50, 0xED, 0xF2, 0xFB, 0x01, 0xC5, 0xF3, 0xEC, 0x3A, 0x2B, 0xCA, 0xB6, 0x9D,
];

pub fn magic_pattern() -> [u8; 64] {
    let mut pattern = [0u8; 64];
    for index in 0..4 {
        let at = index * 16;
        pattern[at + 1..at + 5].copy_from_slice(&u32::MAX.to_le_bytes());
    }
    pattern
}
