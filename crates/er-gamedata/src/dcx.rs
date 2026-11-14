//! DCX. DFLT uses zlib, ZSTD uses zstd, KRAK uses the game's oo2core DLL.

use std::path::Path;

use flate2::read::ZlibDecoder;
use std::io::Read;

use crate::archive::{ArchiveError, ArchiveResult};

pub fn decompress_dcx(buf: &[u8], oodle_dll: Option<&Path>) -> ArchiveResult<Vec<u8>> {
    if buf.len() < 0x30 || &buf[..4] != b"DCX\0" {
        return Err(ArchiveError::Message("não é DCX".into()));
    }
    let name = compression_name(buf);
    match name.as_deref() {
        Some("DFLT") => inflate_zlib(buf),
        Some("ZSTD") => inflate_zstd(buf),
        Some("KRAK") => inflate_krak(buf, oodle_dll),
        _ => inflate_krak(buf, oodle_dll),
    }
}

fn compression_name(buf: &[u8]) -> Option<String> {
    for index in (0x20..0x40.min(buf.len().saturating_sub(4))).step_by(1) {
        if &buf[index..index + 4] == b"DCP\0" && index + 8 < buf.len() {
            let end = buf[index + 4..].iter().position(|byte| *byte == 0).unwrap_or(4);
            return Some(String::from_utf8_lossy(&buf[index + 4..index + 4 + end.min(4)]).to_string());
        }
    }
    let marker = &buf[0x28..0x2C.min(buf.len())];
    if marker == b"KRAK" || marker == b"DFLT" || marker == b"ZSTD" {
        return Some(String::from_utf8_lossy(marker).to_string());
    }
    None
}

fn sizes(buf: &[u8]) -> (usize, usize, usize) {
    let mut uncompressed = u32::from_be_bytes(buf[0x1C..0x20].try_into().unwrap()) as usize;
    let mut compressed = u32::from_be_bytes(buf[0x20..0x24].try_into().unwrap()) as usize;
    if &buf[0x18..0x1C] != b"DCS\0" {
        for index in (0x10..0x30).step_by(4) {
            if index + 12 <= buf.len() && &buf[index..index + 4] == b"DCS\0" {
                uncompressed = u32::from_be_bytes(buf[index + 4..index + 8].try_into().unwrap()) as usize;
                compressed = u32::from_be_bytes(buf[index + 8..index + 12].try_into().unwrap()) as usize;
                break;
            }
        }
    }
    let mut data_start = 0x44;
    for index in (0x30..0x60.min(buf.len().saturating_sub(4))).step_by(4) {
        if &buf[index..index + 4] == b"DCA\0" {
            data_start = index + 8;
            break;
        }
    }
    if buf.len() - data_start < compressed {
        data_start = buf.len().saturating_sub(compressed);
    }
    (uncompressed, compressed, data_start)
}

fn inflate_zlib(buf: &[u8]) -> ArchiveResult<Vec<u8>> {
    let start = buf.iter().skip(0x40).position(|byte| *byte == 0x78).map(|index| index + 0x40).unwrap_or(0x4C);
    let mut decoder = ZlibDecoder::new(&buf[start..]);
    let mut out = Vec::new();
    decoder.read_to_end(&mut out).map_err(|error| ArchiveError::Message(error.to_string()))?;
    Ok(out)
}

fn inflate_zstd(buf: &[u8]) -> ArchiveResult<Vec<u8>> {
    let (uncompressed, compressed, start) = sizes(buf);
    let end = (start + compressed).min(buf.len());
    let out = zstd::decode_all(&buf[start..end]).map_err(|error| ArchiveError::Message(error.to_string()))?;
    if uncompressed > 0 && out.len() != uncompressed {
        return Err(ArchiveError::Message(format!("ZSTD devolveu {} bytes, esperava {uncompressed}", out.len())));
    }
    Ok(out)
}

fn inflate_krak(buf: &[u8], oodle_dll: Option<&Path>) -> ArchiveResult<Vec<u8>> {
    let dll = oodle_dll.ok_or_else(|| ArchiveError::Message("oo2core não encontrado para KRAK".into()))?;
    let (uncompressed, compressed, start) = sizes(buf);
    if uncompressed == 0 || uncompressed > 500_000_000 || compressed == 0 || compressed > uncompressed.saturating_mul(2).max(8_000_000) {
        return Err(ArchiveError::Message("tamanho DCX inválido".into()));
    }
    let end = (start + compressed).min(buf.len());
    unsafe {
        use std::sync::OnceLock;
        static LIBRARY: OnceLock<libloading::Library> = OnceLock::new();
        let library = LIBRARY.get_or_init(|| libloading::Library::new(dll).expect("oo2core"));
        let func: libloading::Symbol<unsafe extern "C" fn(
            *const u8, isize, *mut u8, isize, i32, i32, i32, *mut u8, isize, *mut std::ffi::c_void, *mut std::ffi::c_void, *mut std::ffi::c_void, isize, i32,
        ) -> isize> = library.get(b"OodleLZ_Decompress").map_err(|error| ArchiveError::Message(error.to_string()))?;
        let mut output = vec![0u8; uncompressed];
        let written = func(
            buf[start..end].as_ptr(),
            (end - start) as isize,
            output.as_mut_ptr(),
            uncompressed as isize,
            1, 0, 0,
            std::ptr::null_mut(), 0,
            std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), 0, 0,
        );
        if written != uncompressed as isize {
            return Err(ArchiveError::Message(format!("Oodle devolveu {written}, esperava {uncompressed}")));
        }
        Ok(output)
    }
}
