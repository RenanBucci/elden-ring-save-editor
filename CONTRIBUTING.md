# Contributing

Use the setup and test commands in the README. Keep changes focused, preserve both UI languages, and describe what changed and how it was tested.

Never commit real saves, Steam IDs, credentials, extracted game images, game DLLs, local profiles or build outputs. Keep tests independent of personal files. UI fixtures must be synthetic. Tests needing private saves belong behind the `private-fixtures` feature and must not be required by public CI.

Before proposing a save-format change, explain the offsets, validation rules and failure behavior. Use disposable copies and verify untouched characters and checksums. Do not describe an operation as ban-safe.

Game-install integration tests use `ER_GAME_DIR`. Private save tests additionally require the maintainer's local sample in `Save/ER0000.sl2` and can be run with `cargo test --workspace --features private-fixtures`. They are supplementary, not portable public tests.

Opening an issue or supporting the project does not guarantee implementation or a response deadline.
