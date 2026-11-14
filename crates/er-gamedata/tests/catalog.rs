use std::path::PathBuf;

use er_gamedata::{build_catalog, search};

#[test]
fn installed_game_catalog_has_base_and_dlc_names() {
    let game = match std::env::var_os("ER_GAME_DIR") { Some(path) => PathBuf::from(path), None => return };
    if !game.join("eldenring.exe").exists() {
        return;
    }
    let database = std::env::temp_dir().join("elden-ring-catalog-test.sqlite");
    let _ = std::fs::remove_file(&database);
    let stats = build_catalog(&game, &database).expect("catálogo");
    assert!(stats.weapons > 300, "{stats:?}");
    assert!(stats.goods > 100, "{stats:?}");
    assert!(stats.dlc_rows > 0, "DLC sem nomes: {stats:?}");
    let english = search(&database, "engus", "Messmer", 8).unwrap();
    let portuguese = search(&database, "porbr", "Messmer", 8).unwrap();
    assert!(!english.is_empty() || !portuguese.is_empty(), "nenhum item do Messmer");
}
