use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Intent {
    pub id: String,
    pub scope: String,
    pub title: String,
    pub deliver_at_ms: i64,
}

fn schedule_id(id: &str) -> String {
    let digest = Sha256::digest(id.as_bytes());
    format!(
        "oa{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        digest[0], digest[1], digest[2], digest[3], digest[4], digest[5]
    )
}

fn validate(intents: &[Intent]) -> Result<(), String> {
    if intents.len() > 256 {
        return Err("notification_limit".into());
    }
    let mut ids = std::collections::HashSet::new();
    let mut keys = std::collections::HashSet::new();
    let scope = intents.first().map(|intent| &intent.scope);
    for intent in intents {
        if intent.id.is_empty()
            || intent.id.len() > 2048
            || intent.scope.len() > 1024
            || Some(&intent.scope) != scope
            || intent.title.is_empty()
            || intent.title.chars().count() > 120
            || !(0..=253402300799999).contains(&intent.deliver_at_ms)
            || !ids.insert(&intent.id)
            || !keys.insert(schedule_id(&intent.id))
        {
            return Err("notification_invalid".into());
        }
    }
    Ok(())
}

#[cfg(windows)]
mod windows;
#[cfg(target_os = "android")]
pub struct AndroidNotifications(pub tauri::plugin::PluginHandle<tauri::Wry>);

#[tauri::command]
pub async fn notification_permission(app: tauri::AppHandle) -> Result<String, String> {
    permission(app, false).await
}
#[tauri::command]
pub async fn notification_request_permission(app: tauri::AppHandle) -> Result<String, String> {
    permission(app, true).await
}
async fn permission(_app: tauri::AppHandle, request: bool) -> Result<String, String> {
    #[cfg(windows)]
    {
        return tauri::async_runtime::spawn_blocking(move || windows::permission(request))
            .await
            .map_err(|_| "notification_worker")?;
    }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let result: serde_json::Value = _app
            .state::<AndroidNotifications>()
            .0
            .run_mobile_plugin(
                if request {
                    "requestNotificationPermission"
                } else {
                    "notificationPermission"
                },
                (),
            )
            .map_err(|_| "notification_permission")?;
        return result
            .get("permission")
            .and_then(|value| value.as_str())
            .map(str::to_owned)
            .ok_or_else(|| "notification_permission".into());
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        let _ = request;
        Ok("unavailable".into())
    }
}

#[tauri::command]
pub async fn notification_reconcile(
    _app: tauri::AppHandle,
    intents: Vec<Intent>,
) -> Result<(), String> {
    validate(&intents)?;
    #[cfg(windows)]
    {
        return tauri::async_runtime::spawn_blocking(move || windows::reconcile(&intents))
            .await
            .map_err(|_| "notification_worker")?;
    }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let _: serde_json::Value = _app
            .state::<AndroidNotifications>()
            .0
            .run_mobile_plugin("reconcile", serde_json::json!({"intents":intents}))
            .map_err(|_| "notification_reconcile")?;
        return Ok(());
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        Err("notification_unsupported".into())
    }
}
#[tauri::command]
pub async fn notification_cancel(_app: tauri::AppHandle, ids: Vec<String>) -> Result<(), String> {
    if ids.len() > 256 || ids.iter().any(|id| id.len() > 2048) {
        return Err("notification_invalid".into());
    }
    #[cfg(windows)]
    {
        return tauri::async_runtime::spawn_blocking(move || windows::cancel(&ids))
            .await
            .map_err(|_| "notification_worker")?;
    }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let _: serde_json::Value = _app
            .state::<AndroidNotifications>()
            .0
            .run_mobile_plugin("cancel", serde_json::json!({"ids":ids}))
            .map_err(|_| "notification_cancel")?;
        return Ok(());
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        Err("notification_unsupported".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opaque_schedule_keys_are_stable_and_scoped() {
        assert_eq!(schedule_id("scope-a:task"), schedule_id("scope-a:task"));
        assert_ne!(schedule_id("scope-a:task"), schedule_id("scope-b:task"));
        assert_eq!(schedule_id("task").len(), 14);
    }
    #[test]
    fn rejects_duplicates_mixed_accounts_and_invalid_deadlines() {
        let a = Intent {
            id: "a".into(),
            scope: "scope-a".into(),
            title: "Task due".into(),
            deliver_at_ms: 1,
        };
        assert!(validate(&[a.clone()]).is_ok());
        assert!(validate(&[a.clone(), a.clone()]).is_err());
        assert!(validate(&[
            a.clone(),
            Intent {
                id: "b".into(),
                scope: "scope-b".into(),
                ..a.clone()
            }
        ])
        .is_err());
        assert!(validate(&[Intent {
            deliver_at_ms: -1,
            ..a
        }])
        .is_err());
    }
}
