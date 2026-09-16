mod update;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry>::new("atlas-update")
            .setup(|app, api| {
                use tauri::Manager;
                let handle =
                    api.register_android_plugin("dev.arclattice.app", "AtlasUpdatePlugin")?;
                app.manage(update::AndroidUpdater(handle));
                Ok(())
            })
            .build(),
    );
    builder
        .invoke_handler(tauri::generate_handler![
            update::check_app_update,
            update::install_app_update
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Orivane Atlas");
}
