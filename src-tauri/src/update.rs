use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::ipc::Channel;

static BUSY: AtomicBool = AtomicBool::new(false);
struct Guard;
impl Drop for Guard {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::SeqCst);
    }
}
fn lock() -> Result<Guard, String> {
    BUSY.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map(|_| Guard)
        .map_err(|_| "update_busy".to_string())
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    downloaded: u64,
    total: Option<u64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    current_version: String,
    version: Option<String>,
    notes: String,
    channel: &'static str,
}

#[cfg(target_os = "android")]
pub struct AndroidUpdater(pub tauri::plugin::PluginHandle<tauri::Wry>);

#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let _guard = lock()?;
    #[cfg(windows)]
    {
        use tauri_plugin_updater::UpdaterExt;
        let update = app
            .updater_builder()
            .configure_client(|client| client.https_only(true))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|_| "update_configuration")?
            .check()
            .await
            .map_err(|_| "update_network")?;
        if let Some(ref value) = update {
            validate_url(&value.download_url.to_string())?;
        }
        return serde_json::to_value(Info {
            current_version: app.package_info().version.to_string(),
            version: update.as_ref().map(|v| v.version.clone()),
            notes: update.and_then(|v| v.body).unwrap_or_default(),
            channel: "stable",
        })
        .map_err(|_| "update_metadata".into());
    }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        return app
            .state::<AndroidUpdater>()
            .0
            .run_mobile_plugin("check", ())
            .map_err(|_| "update_network".into());
    }
    #[cfg(not(any(windows, target_os = "android")))]
    Err("update_unsupported".into())
}

#[tauri::command]
pub async fn install_app_update(
    app: tauri::AppHandle,
    version: String,
    progress: Channel<Progress>,
) -> Result<(), String> {
    let _guard = lock()?;
    #[cfg(windows)]
    {
        use tauri_plugin_updater::UpdaterExt;
        let update = app
            .updater_builder()
            .configure_client(|client| client.https_only(true))
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .map_err(|_| "update_configuration")?
            .check()
            .await
            .map_err(|_| "update_network")?
            .ok_or("update_unavailable")?;
        if update.version != version {
            return Err("update_changed".into());
        }
        validate_url(&update.download_url.to_string())?;
        let mut downloaded = 0;
        update
            .download_and_install(
                |size, total| {
                    downloaded += size as u64;
                    let _ = progress.send(Progress { downloaded, total });
                },
                || {},
            )
            .await
            .map_err(|_| "update_install_failed")?;
        return Ok(());
    }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let _ = progress;
        return app
            .state::<AndroidUpdater>()
            .0
            .run_mobile_plugin("install", serde_json::json!({ "version": version }))
            .map_err(|_| "update_install_failed".into());
    }
    #[cfg(not(any(windows, target_os = "android")))]
    Err("update_unsupported".into())
}

fn validate_url(value: &str) -> Result<(), String> {
    let prefix = "https://github.com/LiangzhengZhou/OrivaneAtlas/releases/download/";
    let valid = value
        .strip_prefix(prefix)
        .map(|tail| {
            let parts: Vec<_> = tail.split('/').collect();
            parts.len() == 2
                && parts.iter().all(|part| {
                    !part.is_empty()
                        && *part != "."
                        && *part != ".."
                        && part
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
                })
        })
        .unwrap_or(false);
    if valid {
        Ok(())
    } else {
        Err("update_source_rejected".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_project_release_assets() {
        assert!(validate_url(
            "https://github.com/LiangzhengZhou/OrivaneAtlas/releases/download/v1/app.exe"
        )
        .is_ok());
        for url in [
            "http://github.com/LiangzhengZhou/OrivaneAtlas/releases/download/x",
            "https://evil.test/x",
            "https://github.com/other/repo/releases/download/x",
        ] {
            assert!(validate_url(url).is_err());
        }
    }
}
