use std::collections::HashMap;
use std::sync::OnceLock;

use crate::error::{SaveError, SaveResult};

const BLOCK: u32 = 1000;
const BLOCK_BYTES: usize = 125;

fn table() -> &'static HashMap<u32, u32> {
    static TABLE: OnceLock<HashMap<u32, u32>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut map = HashMap::new();
        for line in include_str!("../../../data/eventflag_bst.txt").lines() {
            let mut parts = line.split(',');
            let Some(block) = parts.next().and_then(|value| value.parse().ok()) else { continue };
            let Some(pos) = parts.next().and_then(|value| value.parse().ok()) else { continue };
            map.insert(block, pos);
        }
        map
    })
}

pub fn locate_flag(id: u32) -> (usize, u8) {
    let block = id / BLOCK;
    if let Some(&known) = table().get(&block) {
        let index = id % BLOCK;
        let byte = known as usize * BLOCK_BYTES + (index as usize / 8);
        let bit = 7 - (index % 8) as u8;
        (byte, bit)
    } else {
        ((id / 8) as usize, 7 - (id % 8) as u8)
    }
}

pub fn read_flag(bytes: &[u8], id: u32) -> bool {
    let (byte, bit) = locate_flag(id);
    if byte >= bytes.len() {
        return false;
    }
    bytes[byte] & (1 << bit) != 0
}

pub fn write_flag(bytes: &mut [u8], id: u32, on: bool) -> SaveResult<()> {
    let (byte, bit) = locate_flag(id);
    if byte >= bytes.len() {
        return Err(SaveError::msg(format!("Flag {id} cai fora da área de progresso.")));
    }
    if on {
        bytes[byte] |= 1 << bit;
    } else {
        bytes[byte] &= !(1 << bit);
    }
    Ok(())
}
