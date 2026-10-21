use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[path = "notifications/receipts.rs"]
mod receipts;
static SCHEDULE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleReceipt {
    id: String,
    deliver_at_ms: i64,
}
fn accepted_schedules(root: &std::path::Path, intents: &[Intent]) -> Result<Vec<ScheduleReceipt>, String> {
    let mut accepted = Vec::new();
    for intent in intents {
        if receipts::contains(root, intent)? {
            accepted.push(ScheduleReceipt { id: intent.id.clone(), deliver_at_ms: intent.deliver_at_ms });
        }
    }
    Ok(accepted)
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Intent {
    pub id: String,
    pub scope: String,
    pub title: String,
    pub deliver_at_ms: i64,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub route: String,
    #[serde(default)]
    pub urgency: String,
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
            || intent.body.chars().count() > 400
            || (!intent.route.is_empty() && !route_is_in_app(&intent.route))
            || (!intent.urgency.is_empty()
                && !["LOW", "NORMAL", "HIGH"].contains(&intent.urgency.as_str()))
            || !(0..=253402300799999).contains(&intent.deliver_at_ms)
            || !ids.insert(&intent.id)
            || !keys.insert(schedule_id(&intent.id))
        {
            return Err("notification_invalid".into());
        }
    }
    Ok(())
}

/// One already-persisted NotificationRecord handed to the system channel.
/// The record itself lives in the local store; this is delivery only.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Present {
    pub id: String,
    pub title: String,
    pub body: String,
    /// In-app route only, e.g. "/tasks/<id>". Never an absolute URL.
    pub route: String,
    pub urgency: String,
}

/// In-app routes only. Shared by presentation and by toast activation, so a
/// forged activation argument can never navigate anywhere outside the app.
fn route_is_in_app(route: &str) -> bool {
    route.starts_with('/')
        && !route.starts_with("//")
        && !route.contains("://")
        && !route.contains('\\')
        && route.len() <= 512
        && route.chars().all(|c| !c.is_control())
}

/// Toast click: restore and focus the main window, then hand it the route.
/// The route is re-validated and JSON-encoded, never concatenated raw.
#[cfg(windows)]
fn activate(app: &tauri::AppHandle, route: &str) {
    use tauri::Manager;
    if !route_is_in_app(route) {
        return;
    }
    if let Ok(mut pending) = PENDING_ROUTE.lock() {
        *pending = Some(route.to_owned());
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    let _ = window.eval("window.dispatchEvent(new Event('orivane-notification-open'))");
}

#[cfg(windows)]
static PENDING_ROUTE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[cfg(windows)]
pub fn start_activation(app: tauri::AppHandle) -> Result<std::sync::mpsc::Sender<()>, String> {
    windows::start_activation(app)
}

#[cfg(windows)]
pub fn presentation_probe() -> Result<String, String> {
    windows::presentation_probe()
}

fn validate_present(payload: &Present) -> Result<(), String> {
    let route_ok = route_is_in_app(&payload.route);
    if payload.id.is_empty()
        || payload.id.len() > 2048
        || payload.title.is_empty()
        || payload.title.chars().count() > 120
        || payload.body.chars().count() > 400
        || !route_ok
        || !["LOW", "NORMAL", "HIGH"].contains(&payload.urgency.as_str())
    {
        return Err("notification_invalid".into());
    }
    Ok(())
}

#[cfg(windows)]
#[path = "notifications/windows.rs"]
mod windows;
#[cfg(target_os = "android")]
pub struct AndroidNotifications(pub tauri::plugin::PluginHandle<tauri::Wry>);

#[tauri::command]
pub async fn notification_present(_app: tauri::AppHandle, payload: Present) -> Result<(), String> {
    validate_present(&payload)?;
    #[cfg(windows)]
    {
        use tauri::Manager;
        if _app.try_state::<std::sync::mpsc::Sender<()>>().is_none() {
            return Err("notification_activation_unavailable".into());
        }
        let app = _app.clone();
        return tauri::async_runtime::spawn_blocking(move || windows::present(&app, &payload))
            .await
            .map_err(|_| "notification_worker")?;
    }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let _: serde_json::Value = _app
            .state::<AndroidNotifications>()
            .0
            .run_mobile_plugin("present", serde_json::json!({"payload":payload}))
            .map_err(|_| "notification_present")?;
        return Ok(());
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        Err("notification_unsupported".into())
    }
}

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
        use tauri::Manager;
        if _app.try_state::<std::sync::mpsc::Sender<()>>().is_none() {
            return Err("notification_activation_unavailable".into());
        }
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
) -> Result<Vec<ScheduleReceipt>, String> {
    validate(&intents)?;
    use tauri::Manager;
    let root = _app.path().app_local_data_dir().map_err(|_| "notification_receipt_directory")?.join("notification-schedule-receipts");
    #[cfg(windows)]
    {
        return tauri::async_runtime::spawn_blocking(move || {
            let _guard = SCHEDULE_LOCK.lock().map_err(|_| "notification_schedule_lock")?;
            windows::reconcile(&intents, &root)?;
            accepted_schedules(&root, &intents)
        })
            .await
            .map_err(|_| "notification_worker")?;
    }
    #[cfg(target_os = "android")]
    {
        let _guard = SCHEDULE_LOCK.lock().map_err(|_| "notification_schedule_lock")?;
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "notification_clock")?.as_millis() as i64;
        let future: Vec<_> = intents.iter().filter(|intent| intent.deliver_at_ms > now).cloned().collect();
        let _: serde_json::Value = _app
            .state::<AndroidNotifications>()
            .0
            .run_mobile_plugin("reconcile", serde_json::json!({"intents":future}))
            .map_err(|_| "notification_reconcile")?;
        for intent in &future { receipts::accept(&root, intent)?; }
        return accepted_schedules(&root, &intents);
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        Err("notification_unsupported".into())
    }
}
/// Android notification tap: returns the in-app route carried by the launch
/// intent exactly once. Desktop activation is pushed as a window event instead.
#[tauri::command]
pub async fn notification_take_route(_app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        return PENDING_ROUTE
            .lock()
            .map(|mut route| route.take())
            .map_err(|_| "notification_take_route".into());
    }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let result: serde_json::Value = _app
            .state::<AndroidNotifications>()
            .0
            .run_mobile_plugin("takeRoute", ())
            .map_err(|_| "notification_take_route")?;
        return Ok(result
            .get("route")
            .and_then(|value| value.as_str())
            .filter(|route| route_is_in_app(route))
            .map(str::to_owned));
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        Ok(None)
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
    fn present(route: &str) -> Present {
        Present {
            id: "n1".into(),
            title: "Task due".into(),
            body: "".into(),
            route: route.into(),
            urgency: "HIGH".into(),
        }
    }
    #[test]
    fn present_accepts_only_in_app_routes() {
        assert!(validate_present(&present("/tasks/abc")).is_ok());
        for bad in [
            "https://evil.test/x",
            "//evil.test",
            "tasks/abc",
            "/a\\b",
            "/a\nb",
            "",
        ] {
            assert!(validate_present(&present(bad)).is_err(), "{bad}");
        }
        let mut long = present("/x");
        long.title = "t".repeat(121);
        assert!(validate_present(&long).is_err());
        let mut urgency = present("/x");
        urgency.urgency = "CRITICAL".into();
        assert!(validate_present(&urgency).is_err());
    }
    #[test]
    fn rejects_duplicates_mixed_accounts_and_invalid_deadlines() {
        let a = Intent {
            id: "a".into(),
            scope: "scope-a".into(),
            title: "Task due".into(),
            deliver_at_ms: 1,
            body: String::new(),
            route: String::new(),
            urgency: String::new(),
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
