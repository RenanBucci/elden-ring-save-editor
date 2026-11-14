use aes::Aes128;
use cbc::cipher::{block_padding::NoPadding, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use cbc::{Decryptor, Encryptor};
use md5::{Digest, Md5};

use crate::constants::{
    AES_KEY, ENTRY_COUNT, ENTRY_SIZE, HEADER_SIZE, SLOT_COUNT, SLOT_PAYLOAD, UD10_PAYLOAD,
};
use crate::error::{SaveError, SaveResult};

type Aes128CbcDec = Decryptor<Aes128>;
type Aes128CbcEnc = Encryptor<Aes128>;

#[derive(Debug, Clone)]
pub struct Entry {
    pub index: usize,
    pub name: String,
    pub offset: usize,
    pub size: usize,
    pub payload_offset: usize,
    pub payload_size: usize,
}

#[derive(Debug, Clone)]
pub struct SaveFile {
    pub buffer: Vec<u8>,
    pub entries: Vec<Entry>,
    pub encrypted: bool,
    pub iv: [u8; 16],
}

pub fn read_utf16(buf: &[u8], offset: usize, byte_length: usize) -> String {
    let end = buf.len().min(offset.saturating_add(byte_length));
    let mut text = String::new();
    let mut index = offset;
    while index + 1 < end {
        let code = u16::from_le_bytes([buf[index], buf[index + 1]]);
        if code == 0 {
            break;
        }
        text.push(char::from_u32(code as u32).unwrap_or('\u{FFFD}'));
        index += 2;
    }
    text
}

fn md5_of(data: &[u8]) -> [u8; 16] {
    let mut hasher = Md5::new();
    hasher.update(data);
    hasher.finalize().into()
}

fn decrypt_steam(buffer: &[u8]) -> Option<(Vec<u8>, [u8; 16])> {
    if buffer.len() < 32 || buffer.len() % 16 != 0 {
        return None;
    }
    let mut iv = [0u8; 16];
    iv.copy_from_slice(&buffer[..16]);
    let mut body = buffer[16..].to_vec();
    let decryptor = Aes128CbcDec::new_from_slices(&AES_KEY, &iv).ok()?;
    decryptor.decrypt_padded_mut::<NoPadding>(&mut body).ok()?;
    if &body[..4] != b"BND4" {
        return None;
    }
    Some((body, iv))
}

fn encrypt_steam(plain: &[u8], iv: &[u8; 16]) -> SaveResult<Vec<u8>> {
    let mut padded = plain.to_vec();
    if padded.len() % 16 != 0 {
        padded.resize(padded.len() + (16 - padded.len() % 16), 0);
    }
    let encryptor = Aes128CbcEnc::new_from_slices(&AES_KEY, iv)
        .map_err(|error| SaveError::msg(error.to_string()))?;
    let encrypted = encryptor
        .encrypt_padded_mut::<NoPadding>(&mut padded, plain.len().div_ceil(16) * 16)
        .map_err(|error| SaveError::msg(error.to_string()))?
        .to_vec();
    let mut out = Vec::with_capacity(16 + encrypted.len());
    out.extend_from_slice(iv);
    out.extend_from_slice(&encrypted);
    Ok(out)
}

pub fn parse_container(input: &[u8]) -> SaveResult<SaveFile> {
    let mut encrypted = false;
    let mut iv = [0u8; 16];
    let source = if input.len() >= 4 && &input[..4] == b"BND4" {
        input.to_vec()
    } else {
        let (plain, found_iv) = decrypt_steam(input).ok_or_else(|| {
            SaveError::code("ERE-04", "Arquivo não é um save de PC do Elden Ring.")
        })?;
        encrypted = true;
        iv = found_iv;
        plain
    };

    if source.len() < HEADER_SIZE + 4 || &source[..4] != b"BND4" {
        return Err(SaveError::code("ERE-04", "Arquivo não é um save de PC do Elden Ring."));
    }
    let count = u32::from_le_bytes(source[0x0C..0x10].try_into().unwrap()) as usize;
    if count != ENTRY_COUNT || source.len() < HEADER_SIZE + count * ENTRY_SIZE {
        return Err(SaveError::code(
            "ERE-04",
            "Cabeçalho do save não tem as 12 entradas esperadas.",
        ));
    }

    let mut entries = Vec::with_capacity(count);
    for index in 0..count {
        let at = HEADER_SIZE + index * ENTRY_SIZE;
        let size = u64::from_le_bytes(source[at + 8..at + 16].try_into().unwrap()) as usize;
        let offset = u32::from_le_bytes(source[at + 0x10..at + 0x14].try_into().unwrap()) as usize;
        let name_at = u32::from_le_bytes(source[at + 0x14..at + 0x18].try_into().unwrap()) as usize;
        if offset + size > source.len() {
            return Err(SaveError::code(
                "ERE-04",
                format!("Entrada {index} aponta para fora do arquivo."),
            ));
        }
        entries.push(Entry {
            index,
            name: read_utf16(&source, name_at, 64),
            offset,
            size,
            payload_offset: offset + 16,
            payload_size: size.saturating_sub(16),
        });
    }

    for entry in entries.iter().take(SLOT_COUNT) {
        if entry.payload_size != SLOT_PAYLOAD {
            return Err(SaveError::code(
                "ERE-04",
                format!("{} não tem o tamanho de um personagem.", entry.name),
            ));
        }
    }
    let user_data_10 = entries.get(10).ok_or_else(|| {
        SaveError::code("ERE-04", "Bloco global do save (USER_DATA010) está ausente.")
    })?;
    if user_data_10.payload_size != UD10_PAYLOAD {
        return Err(SaveError::code(
            "ERE-04",
            "Bloco global do save (USER_DATA010) está ausente ou com tamanho inesperado.",
        ));
    }

    Ok(SaveFile { buffer: source, entries, encrypted, iv })
}

pub fn checksum_ok(save: &SaveFile, entry: &Entry) -> bool {
    let got = &save.buffer[entry.offset..entry.offset + 16];
    let expect = md5_of(&save.buffer[entry.payload_offset..entry.payload_offset + entry.payload_size]);
    got == expect
}

pub fn recalculate_checksums(save: &mut SaveFile) {
    for entry in &save.entries {
        let digest = md5_of(&save.buffer[entry.payload_offset..entry.payload_offset + entry.payload_size]);
        save.buffer[entry.offset..entry.offset + 16].copy_from_slice(&digest);
    }
}

pub fn to_file_buffer(save: &mut SaveFile) -> SaveResult<Vec<u8>> {
    recalculate_checksums(save);
    if !save.encrypted {
        return Ok(save.buffer.clone());
    }
    encrypt_steam(&save.buffer, &save.iv)
}

pub fn payload_range(entry: &Entry) -> std::ops::Range<usize> {
    entry.payload_offset..entry.payload_offset + entry.payload_size
}
