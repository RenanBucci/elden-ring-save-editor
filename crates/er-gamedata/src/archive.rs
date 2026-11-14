//! Elden Ring BHD5/BDT. The header is raw RSA (no padding): each 256-byte
//! block becomes 255 bytes. Filename hashes are 64-bit with multiplier 0x85.
//! Keys are read from the installed eldenring.exe, next to the archives.

use std::path::{Path, PathBuf};

use rsa::pkcs1::DecodeRsaPublicKey;
use rsa::BigUint;
use rsa::traits::PublicKeyParts;
use rsa::RsaPublicKey;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ArchiveError {
    #[error("{0}")]
    Message(String),
}

pub type ArchiveResult<T> = Result<T, ArchiveError>;

#[derive(Debug, Clone)]
pub struct ArchiveEntry {
    pub hash: u64,
    pub padded: i32,
    pub unpadded: i32,
    pub offset: i64,
    pub aes_key: Option<Vec<u8>>,
    pub aes_ranges: Vec<(i64, i64)>,
}

pub fn path_hash(path: &str) -> u64 {
    let mut text = path.replace('\\', "/").to_lowercase();
    if !text.starts_with('/') {
        text.insert(0, '/');
    }
    let mut hash = 0u64;
    for byte in text.bytes() {
        hash = hash.wrapping_mul(0x85).wrapping_add(u64::from(byte));
    }
    hash
}

pub fn public_keys_from_exe(exe: &[u8]) -> Vec<String> {
    let begin = b"-----BEGIN RSA PUBLIC KEY-----";
    let end = b"-----END RSA PUBLIC KEY-----";
    let mut keys = Vec::new();
    let mut cursor = 0;
    while let Some(found) = exe[cursor..].windows(begin.len()).position(|window| window == begin) {
        let start = cursor + found;
        let Some(stop) = exe[start..].windows(end.len()).position(|window| window == end) else { break };
        let finish = start + stop + end.len();
        keys.push(String::from_utf8_lossy(&exe[start..finish]).to_string());
        cursor = finish;
    }
    keys
}

fn rsa_block(block: &[u8], exponent: &BigUint, modulus: &BigUint) -> Vec<u8> {
    let cipher = BigUint::from_bytes_be(block);
    let plain = cipher.modpow(exponent, modulus);
    let out_size = ((modulus.bits() - 1) / 8) as usize;
    let bytes = plain.to_bytes_be();
    let mut padded = vec![0u8; out_size];
    if bytes.len() >= out_size {
        padded.copy_from_slice(&bytes[bytes.len() - out_size..]);
    } else {
        padded[out_size - bytes.len()..].copy_from_slice(&bytes);
    }
    padded
}

pub fn rsa_decrypt(data: &[u8], pem: &str) -> ArchiveResult<Vec<u8>> {
    let key = RsaPublicKey::from_pkcs1_pem(pem).map_err(|error| ArchiveError::Message(error.to_string()))?;
    let modulus = key.n().clone();
    let exponent = key.e().clone();
    let in_size = ((modulus.bits() + 7) / 8) as usize;
    if in_size == 0 || data.len() < in_size {
        return Err(ArchiveError::Message("bloco RSA curto".into()));
    }
    let mut out = Vec::with_capacity(data.len());
    let mut offset = 0;
    while offset + in_size <= data.len() {
        out.extend(rsa_block(&data[offset..offset + in_size], &exponent, &modulus));
        offset += in_size;
    }
    Ok(out)
}

pub fn decrypt_header(encrypted: &[u8], pems: &[String]) -> ArchiveResult<Vec<u8>> {
    for pem in pems {
        let key = RsaPublicKey::from_pkcs1_pem(pem).map_err(|error| ArchiveError::Message(error.to_string()))?;
        let modulus = key.n().clone();
        let exponent = key.e().clone();
        let in_size = ((modulus.bits() + 7) / 8) as usize;
        if encrypted.len() < in_size {
            continue;
        }
        let first = rsa_block(&encrypted[..in_size], &exponent, &modulus);
        if first.starts_with(b"BHD5") {
            return rsa_decrypt(encrypted, pem);
        }
    }
    Err(ArchiveError::Message("nenhuma chave do executável abriu o .bhd".into()))
}

fn ru32(buf: &[u8], at: usize) -> i32 {
    i32::from_le_bytes(buf[at..at + 4].try_into().unwrap())
}

fn ri64(buf: &[u8], at: usize) -> i64 {
    i64::from_le_bytes(buf[at..at + 8].try_into().unwrap())
}

pub fn parse_bhd5(buf: &[u8]) -> ArchiveResult<Vec<ArchiveEntry>> {
    if buf.len() < 0x30 || &buf[..4] != b"BHD5" {
        return Err(ArchiveError::Message("cabeçalho não é BHD5".into()));
    }
    if ru32(buf, 0x08) != 1 {
        return Err(ArchiveError::Message("versão de BHD5 diferente de 1".into()));
    }
    let bucket_count = ru32(buf, 0x10);
    let buckets_offset = ru32(buf, 0x14) as usize;
    let salt_len = ru32(buf, 0x18);
    let _salt = salt_len;
    let mut entries = Vec::new();
    if bucket_count < 0 {
        return Err(ArchiveError::Message("BHD5 sem buckets".into()));
    }
    for bucket in 0..bucket_count as usize {
        let at = buckets_offset + bucket * 8;
        if at + 8 > buf.len() {
            break;
        }
        let count = ru32(buf, at);
        let offset = ru32(buf, at + 4) as usize;
        if count <= 0 {
            continue;
        }
        for index in 0..count as usize {
            let entry_at = offset + index * 40;
            if entry_at + 40 > buf.len() {
                break;
            }
            let hash = u64::from_le_bytes(buf[entry_at..entry_at + 8].try_into().unwrap());
            let padded = ru32(buf, entry_at + 8);
            let unpadded = ru32(buf, entry_at + 12);
            let data_offset = ri64(buf, entry_at + 16);
            let aes_off = ri64(buf, entry_at + 32);
            let (aes_key, aes_ranges) = if aes_off > 0 {
                read_aes(buf, aes_off as usize).unwrap_or((None, Vec::new()))
            } else {
                (None, Vec::new())
            };
            entries.push(ArchiveEntry { hash, padded, unpadded, offset: data_offset, aes_key, aes_ranges });
        }
    }
    Ok(entries)
}

fn read_aes(buf: &[u8], offset: usize) -> Option<(Option<Vec<u8>>, Vec<(i64, i64)>)> {
    if offset + 20 > buf.len() {
        return None;
    }
    let key = buf[offset..offset + 16].to_vec();
    let count = ru32(buf, offset + 16);
    if count < 0 || count > 64 {
        return None;
    }
    let mut ranges = Vec::new();
    let mut cursor = offset + 20;
    for _ in 0..count {
        if cursor + 16 > buf.len() {
            break;
        }
        let start = ri64(buf, cursor);
        let end = ri64(buf, cursor + 8);
        if start >= 0 && end > start {
            ranges.push((start, end));
        }
        cursor += 16;
    }
    Some((Some(key), ranges))
}

pub fn find_entry<'a>(entries: &'a [ArchiveEntry], path: &str) -> Option<&'a ArchiveEntry> {
    let hash = path_hash(path);
    entries.iter().find(|entry| entry.hash == hash)
}

pub fn game_archives(game_dir: &Path) -> Vec<PathBuf> {
    ["Data0", "Data1", "Data2", "Data3", "DLC"]
        .into_iter()
        .map(|name| game_dir.join(format!("{name}.bhd")))
        .filter(|path| path.exists())
        .collect()
}

pub fn read_entry_bytes(bdt: &Path, entry: &ArchiveEntry) -> ArchiveResult<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(bdt).map_err(|error| ArchiveError::Message(error.to_string()))?;
    let size = if entry.padded > 0 { entry.padded as u64 } else { entry.unpadded.max(0) as u64 };
    file.seek(SeekFrom::Start(entry.offset as u64)).map_err(|error| ArchiveError::Message(error.to_string()))?;
    let mut data = vec![0u8; size as usize];
    file.read_exact(&mut data).map_err(|error| ArchiveError::Message(error.to_string()))?;
    if let Some(key) = &entry.aes_key {
        decrypt_ranges(&mut data, key, &entry.aes_ranges);
    }
    let dcx = data.starts_with(b"DCX\0");
    if !dcx && entry.unpadded > 0 && (entry.unpadded as usize) < data.len() {
        data.truncate(entry.unpadded as usize);
    }
    Ok(data)
}

fn decrypt_ranges(data: &mut [u8], key: &[u8], ranges: &[(i64, i64)]) {
    use aes::cipher::generic_array::GenericArray;
    use aes::cipher::{BlockDecrypt, KeyInit};
    use aes::Aes128;
    if key.len() != 16 {
        return;
    }
    let Ok(cipher) = Aes128::new_from_slice(key) else { return };
    for &(start, end) in ranges {
        if start < 0 || end < start {
            continue;
        }
        let mut cursor = start as usize;
        let stop = (end as usize).min(data.len());
        while cursor + 16 <= stop {
            let mut block = GenericArray::clone_from_slice(&data[cursor..cursor + 16]);
            cipher.decrypt_block(&mut block);
            data[cursor..cursor + 16].copy_from_slice(&block);
            cursor += 16;
        }
    }
}
