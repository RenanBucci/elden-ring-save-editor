fn main() {
    // Windows resources must be regenerated when the application icon changes.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
