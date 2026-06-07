// Minimal Tauri entrypoint — the game is entirely self-contained in the webview.
// This is a reference; run `npm create tauri-app` / `tauri init` to generate the
// full src-tauri scaffold (Cargo.toml, build.rs, capabilities) around it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Stickman Archers");
}
