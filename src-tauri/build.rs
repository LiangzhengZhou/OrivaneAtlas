fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["check_app_update", "install_app_update"]),
    ))
    .expect("Tauri build failed");
}
