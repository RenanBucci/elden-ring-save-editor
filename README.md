# Elden Ring Save Editor

An open-source, offline Windows save editor for **Elden Ring**, built with React, Tauri and Rust.

> **Use at your own risk.** Editing a save can corrupt it, erase progress or result in an account ban, especially if you go online afterward. No edit is guaranteed to be safe. Close the game, work offline and keep an independent backup. This tool does not bypass anti-cheat or make edited saves safe for online play.

## Download

Download the Windows executable or installer from [GitHub Releases](https://github.com/RenanBucci/elden-ring-save-editor/releases). You do not need Node.js or Rust to run a release. Windows 10/11 x64 and the Microsoft Edge WebView2 Runtime are required. The installer can help install WebView2 if it is missing; that step may require internet access.

The first release is a **public preview**, not a guarantee of compatibility with every game version or save. The executable is not code-signed. Only use files from this repository's Releases page. Source code and release downloads are free.

## Getting started

1. Close Elden Ring and make a separate copy of your entire save folder.
2. Start the editor. It looks for local saves under `%APPDATA%\EldenRing\<SteamID>`.
3. Choose a save, or paste the path to a copy of an `.sl2` or `.co2` file.
4. Select a character. In **Editor**, change fields and click **Save** or **Save changes**. Other screens apply changes using their own controls; inventory quantity changes are applied when you leave the field.
5. Use **Save copy** to export the complete, already-saved file to `_editor_exports` next to the original. Save pending character fields before exporting.

Automatic backups are stored in `_editor_backups` next to the save. Named backups, restore and a bounded in-session undo history are available. These are recovery aids, not a substitute for your independent backup.

## Features

- Character name, class, body type, attributes, runes and level synchronization.
- Inventory and storage browsing, quantities, supported weapon upgrades and affinities, and item addition.
- Build presets and character-to-character copying.
- Sites of Grace, boss and map progress flags.
- Appearance data editing and copying; the preview is schematic, not an in-game render.
- Character slot operations and import/export.
- Backup, restore, undo and complete save-copy export.
- English and Brazilian Portuguese UI.
- Experimental game regulation presets, written separately from the original `regulation.bin`.

Internal empty-equipment records are hidden. Items equipped by a character are protected from removal in the inventory screen.

## Local game data and icons

Item icons are included in the Windows executable and installer. All 3,064 PNGs are bundled; no icon extraction, game-file build step or separate cache is required. Ashes of War include 116 numeric icon mappings. PNG optimization preserves every RGBA pixel.

Localized item names and world-map data still come from your installed game. Without accessible game data, names may use category/ID fallbacks. Personal saves, game DLLs and raw game archives are not included.

The build verifies the icon manifest before and after Vite packaging and refuses missing or altered files. The Tauri custom-protocol feature embeds the frontend assets in the executable.

## Build from source

Install Node.js 22+, a current stable Rust toolchain, the Microsoft C++ Build Tools with Windows SDK, and WebView2. Run these commands in the repository root:

```powershell
npm ci
npm run tauri:dev
```

To build a release executable:

```powershell
npx tauri build --no-bundle
```

To build the executable and Windows NSIS installer:

```powershell
npm run tauri:build
```

The executable is written to `target/release/elden-ring-save-editor.exe`; the installer is under `target/release/bundle/nsis`. Building may download dependencies and NSIS. The Electron dependency is used only for isolated UI tests; this repository does not ship an Electron version of the editor.

## Tests

```powershell
npm run lint
npm test
npm run build
npm run test:ui
cargo test --workspace
npm run check:release
```

The UI suite uses simulated sessions and never writes to real saves. It checks ten screens at four sizes, layout modes, localization and editing regressions. Rust public-input tests reject malformed data. Some integration tests are opt-in and require a locally supplied game installation or private save fixtures; those files are deliberately excluded. Passing the public suite does not establish in-game compatibility.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/` | React UI, localization and Tauri command adapter |
| `src-tauri/` | Windows shell, session commands and file I/O |
| `crates/er-save/` | Save parsing, edits, checksums and character hashes |
| `crates/er-gamedata/` | Local archive, text, regulation and world-map readers |
| `data/` | Progress-flag identifiers and world mappings used by the editor |
| `public/data/` | Numeric item metadata; localized names come from the local game |
| `test/` | Public regression tests and simulated UI data |
| `tools/` | Release checks and optional local icon extraction |

## Limitations and reporting bugs

Game updates, DLC ownership, cut items and unsupported save layouts can affect results. `.co2` recognition and byte-copy support do not establish compatibility with every Seamless Co-op workflow. World flags can have quest dependencies. Appearance, cross-account imports and regulation presets require careful in-game validation on disposable copies.

Open an [issue](https://github.com/RenanBucci/elden-ring-save-editor/issues) with the app version, game version, reproduction steps and the exact error. **Do not post your full save, Steam ID, account identifiers or local cache.** See [CONTRIBUTING.md](CONTRIBUTING.md).

## Support and license

The code and public builds are free. Any future support links are for optional donations, not exclusive builds, features, paid assistance or a promise to implement requests.

Original project code is available under the [MIT License](LICENSE). Dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Elden Ring and its game content belong to their respective owners. This is an independent community tool, not an official Bandai Namco or FromSoftware product. The project's license does not grant rights to the game or its assets.

A GitHub Actions template is provided at tools/check-workflow.yml.example. To enable CI, copy it to .github/workflows/check.yml using a GitHub credential with workflow permissions.

