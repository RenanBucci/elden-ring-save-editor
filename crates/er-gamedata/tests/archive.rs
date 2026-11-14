use std::path::PathBuf;

use er_gamedata::{decrypt_header, find_entry, parse_bhd5, public_keys_from_exe, read_entry_bytes, decompress_dcx, find_oodle};

fn game() -> Option<PathBuf> {
    let path = match std::env::var_os("ER_GAME_DIR") { Some(path) => PathBuf::from(path), None => return None };
    if path.join("eldenring.exe").exists() { Some(path) } else { None }
}

#[test]
fn data0_header_opens_with_the_exe_key_and_a_known_file_decompresses() {
    let Some(game) = game() else { return };
    let exe = std::fs::read(game.join("eldenring.exe")).unwrap();
    let keys = public_keys_from_exe(&exe);
    assert!(keys.len() >= 4, "o executável não tem as chaves RSA");
    let header = std::fs::read(game.join("Data0.bhd")).unwrap();
    let plain = decrypt_header(&header, &keys).expect("Data0.bhd");
    let entries = parse_bhd5(&plain).unwrap();
    assert!(entries.len() > 100, "poucas entradas: {}", entries.len());
    let entry = find_entry(&entries, "/menu/hi/01_common.tpf.dcx")
        .or_else(|| find_entry(&entries, "/msg/engus/item.msgbnd.dcx"))
        .expect("arquivo conhecido ausente do índice");
    let bytes = read_entry_bytes(&game.join("Data0.bdt"), entry).unwrap();
    assert!(bytes.len() > 32);
    if bytes.starts_with(b"DCX\0") {
        let opened = decompress_dcx(&bytes, find_oodle(&game).as_deref()).unwrap();
        assert!(opened.len() > bytes.len() / 4);
    }
}

