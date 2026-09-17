mod session_store;
mod transport;
#[cfg(windows)]
mod tray;
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
    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry>::new("atlas-session")
            .setup(|app, api| {
                use tauri::Manager;
                let handle =
                    api.register_android_plugin("dev.arclattice.app", "AtlasSessionPlugin")?;
                app.manage(transport::Transport::with_vault(
                    session_store::AndroidVault(handle),
                ));
                Ok(())
            })
            .build(),
    );
    builder
        .setup(|app| {
            #[cfg(windows)]
            {
                use tauri::Manager;
                let path = app.path().app_local_data_dir()?.join("session.dpapi");
                app.manage(transport::Transport::with_vault(
                    session_store::WindowsVault(path),
                ));
                // If Explorer/tray creation fails, retain ordinary close behaviour.
                if tray::setup(app).is_err() {
                    eprintln!("System tray unavailable");
                }
            }
            #[cfg(not(any(windows, target_os = "android")))]
            {
                use tauri::Manager;
                app.manage(transport::Transport::default());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            update::check_app_update,
            update::install_app_update,
            transport::configure_server,
            transport::server_request
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Orivane Atlas");
}
