use super::{schedule_id, Intent};
use std::collections::HashMap;
use windows::core::{w, Interface, GUID, HSTRING, PCWSTR, PWSTR};
use windows::Data::Xml::Dom::XmlDocument;
use windows::Foundation::{DateTime, IReference, PropertyValue};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::System::Com::StructuredStorage::{
    PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
    COINIT_MULTITHREADED,
};
use windows::Win32::System::Variant::{VT_CLSID, VT_LPWSTR};
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{IShellLinkW, SetCurrentProcessExplicitAppUserModelID, ShellLink};
use windows::UI::Notifications::{
    NotificationSetting, ScheduledToastNotification, ToastNotification, ToastNotificationManager,
};

const APP_ID: &str = "app.orivane.atlas";
#[path = "activation.rs"]
mod activation;
pub fn start_activation(app: tauri::AppHandle) -> Result<std::sync::mpsc::Sender<()>, String> {
    activation::start(app)
}
struct Apartment;
impl Apartment {
    fn enter() -> Result<Self, String> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(|_| "notification_com")?;
        }
        Ok(Self)
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}
fn shortcut() -> Result<std::path::PathBuf, String> {
    Ok(
        std::path::PathBuf::from(std::env::var_os("APPDATA").ok_or("notification_registration")?)
            .join("Microsoft/Windows/Start Menu/Programs/Orivane Atlas Notifications.lnk"),
    )
}
fn register(path: &std::path::Path, app_id: &str) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|_| "notification_registration")?;
    let target: Vec<u16> = executable
        .to_string_lossy()
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let file: Vec<u16> = path
        .to_string_lossy()
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let mut identity: Vec<u16> = app_id.encode_utf16().chain(Some(0)).collect();
    std::fs::create_dir_all(path.parent().ok_or("notification_registration")?)
        .map_err(|_| "notification_registration")?;
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            .map_err(|_| "notification_registration")?;
        link.SetPath(PCWSTR(target.as_ptr()))
            .map_err(|_| "notification_registration")?;
        link.SetDescription(w!("Orivane Atlas notifications"))
            .map_err(|_| "notification_registration")?;
        let properties: IPropertyStore = link.cast().map_err(|_| "notification_registration")?;
        let key = PROPERTYKEY {
            fmtid: GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3),
            pid: 5,
        };
        // SetValue copies the borrowed UTF-16 string synchronously; the outer ManuallyDrop prevents PropVariantClear from freeing the borrowed Vec.
        let value = std::mem::ManuallyDrop::new(PROPVARIANT {
            Anonymous: PROPVARIANT_0 {
                Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                    vt: VT_LPWSTR,
                    wReserved1: 0,
                    wReserved2: 0,
                    wReserved3: 0,
                    Anonymous: PROPVARIANT_0_0_0 {
                        pwszVal: PWSTR(identity.as_mut_ptr()),
                    },
                }),
            },
        });
        properties
            .SetValue(&key, &*value)
            .map_err(|_| "notification_registration")?;
        {
            let mut clsid = activation::CLSID;
            let activator = std::mem::ManuallyDrop::new(PROPVARIANT {
                Anonymous: PROPVARIANT_0 {
                    Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                        vt: VT_CLSID,
                        wReserved1: 0,
                        wReserved2: 0,
                        wReserved3: 0,
                        Anonymous: PROPVARIANT_0_0_0 { puuid: &mut clsid },
                    }),
                },
            });
            properties
                .SetValue(
                    &PROPERTYKEY {
                        fmtid: key.fmtid,
                        pid: 26,
                    },
                    &*activator,
                )
                .map_err(|_| "notification_registration")?;
            if app_id == APP_ID {
                activation::register_executable()?;
            }
        }
        properties
            .Commit()
            .map_err(|_| "notification_registration")?;
        let persist: IPersistFile = link.cast().map_err(|_| "notification_registration")?;
        persist
            .Save(PCWSTR(file.as_ptr()), true)
            .map_err(|_| "notification_registration")?;
        SetCurrentProcessExplicitAppUserModelID(PCWSTR(identity.as_ptr()))
            .map_err(|_| "notification_registration")?;
    }
    activation::register_identity(app_id)?;
    prime_identity(app_id)?;
    Ok(())
}
fn prime_identity(app_id: &str) -> Result<(), String> {
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))
        .map_err(|_| "notification_registration")?;
    match notifier.Setting() {
        Ok(_) => return Ok(()),
        Err(error) if error.code().0 == 0x80070490u32 as i32 => {}
        Err(error) => return Err(format!("notification_permission:{:08x}", error.code().0)),
    }
    // Windows cannot query settings for a never-used unpackaged identity.
    // Register with a silent, expiring toast, then remove ONLY this private tag.
    // This does not alter the user's notification permissions or show a popup.
    let content = XmlDocument::new().map_err(|_| "notification_registration")?;
    content.LoadXml(&HSTRING::from("<toast><visual><binding template=\"ToastGeneric\"><text>Orivane Atlas</text></binding></visual><audio silent=\"true\"/></toast>"))
        .map_err(|_| "notification_registration")?;
    let toast = ToastNotification::CreateToastNotification(&content)
        .map_err(|_| "notification_registration")?;
    let tag = HSTRING::from("atlas-register");
    let group = HSTRING::from("registration");
    toast
        .SetTag(&tag)
        .map_err(|_| "notification_registration")?;
    toast
        .SetGroup(&group)
        .map_err(|_| "notification_registration")?;
    toast
        .SetSuppressPopup(true)
        .map_err(|_| "notification_registration")?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "notification_clock")?
        .as_millis() as i64;
    let expiry: IReference<DateTime> = PropertyValue::CreateDateTime(DateTime {
        UniversalTime: ticks(now + 15000),
    })
    .and_then(|value| value.cast())
    .map_err(|_| "notification_registration")?;
    toast
        .SetExpirationTime(&expiry)
        .map_err(|_| "notification_registration")?;
    notifier
        .Show(&toast)
        .map_err(|error| format!("notification_registration:{:08x}", error.code().0))?;
    ToastNotificationManager::History()
        .and_then(|history| history.RemoveGroupedTagWithId(&tag, &group, &HSTRING::from(app_id)))
        .map_err(|_| "notification_registration_cleanup".to_owned())
}
pub fn permission(request: bool) -> Result<String, String> {
    let _apartment = Apartment::enter()?;
    let path = shortcut()?;
    if request {
        register(&path, APP_ID)?;
    } else if !path.exists() {
        return Ok("prompt".into());
    }
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP_ID))
        .map_err(|_| "notification_registration")?;
    Ok(if notifier
        .Setting()
        .map_err(|error| format!("notification_permission:{:08x}", error.code().0))?
        == NotificationSetting::Enabled
    {
        "granted"
    } else {
        "denied"
    }
    .into())
}
fn xml(title: &str) -> String {
    let escaped = title
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;");
    format!("<toast><visual><binding template=\"ToastGeneric\"><text>Orivane Atlas</text><text>{escaped}</text></binding></visual></toast>")
}
fn ticks(milliseconds: i64) -> i64 {
    (milliseconds + 11644473600000) * 10000
}
fn scheduled_xml(intent: &Intent) -> String {
    if intent.route.is_empty() {
        return xml(&intent.title);
    }
    present_xml(&super::Present {
        id: intent.id.clone(),
        title: intent.title.clone(),
        body: intent.body.clone(),
        route: intent.route.clone(),
        urgency: intent.urgency.clone(),
    })
}
pub fn reconcile(intents: &[Intent], receipts: &std::path::Path) -> Result<(), String> {
    let _apartment = Apartment::enter()?;
    if !shortcut()?.exists() {
        return if intents.is_empty() {
            Ok(())
        } else {
            Err("notification_permission".into())
        };
    }
    reconcile_receipted(APP_ID, intents, Some(receipts))
}
fn reconcile_with_id(app_id: &str, intents: &[Intent]) -> Result<(), String> {
    reconcile_receipted(app_id, intents, None)
}
fn reconcile_receipted(app_id: &str, intents: &[Intent], receipts: Option<&std::path::Path>) -> Result<(), String> {
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))
        .map_err(|_| "notification_registration")?;
    let desired: HashMap<_, _> = intents
        .iter()
        .map(|intent| (schedule_id(&intent.id), intent))
        .collect();
    let mut retained = std::collections::HashSet::new();
    let scheduled = notifier
        .GetScheduledToastNotifications()
        .map_err(|error| format!("notification_schedule:{:08x}", error.code().0))?;
    for existing in scheduled {
        let id = existing
            .Id()
            .map_err(|error| format!("notification_schedule:{:08x}", error.code().0))?
            .to_string();
        if !id.starts_with("oa") {
            continue;
        }
        if let Some(intent) = desired.get(&id) {
            if existing
                .DeliveryTime()
                .map_err(|error| format!("notification_schedule:{:08x}", error.code().0))?
                .UniversalTime
                == ticks(intent.deliver_at_ms)
                && existing
                    .Content()
                    .and_then(|value| value.GetXml())
                    .map_err(|error| format!("notification_schedule:{:08x}", error.code().0))?
                    .to_string()
                    == scheduled_xml(intent)
            {
                if let Some(root) = receipts { super::receipts::accept(root, intent)?; }
                retained.insert(id);
                continue;
            }
        }
        notifier
            .RemoveFromSchedule(&existing)
            .map_err(|error| format!("notification_schedule:{:08x}", error.code().0))?;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "notification_clock")?
        .as_millis() as i64;
    for (id, intent) in desired {
        if retained.contains(&id) || intent.deliver_at_ms <= now {
            continue;
        }
        let content = XmlDocument::new().map_err(|_| "notification_content")?;
        content
            .LoadXml(&HSTRING::from(scheduled_xml(intent)))
            .map_err(|_| "notification_content")?;
        let notification = ScheduledToastNotification::CreateScheduledToastNotification(
            &content,
            DateTime {
                UniversalTime: ticks(intent.deliver_at_ms),
            },
        )
        .map_err(|error| format!("notification_schedule:{:08x}", error.code().0))?;
        notification
            .SetId(&HSTRING::from(id))
            .map_err(|error| format!("notification_schedule:{:08x}", error.code().0))?;
        notifier
            .AddToSchedule(&notification)
            .map_err(|error| format!("notification_schedule:{:08x}", error.code().0))?;
        if let Some(root) = receipts { super::receipts::accept(root, intent)?; }
    }
    Ok(())
}
fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
/// Immediate toast for an already-persisted NotificationRecord. The `launch`
/// attribute carries only the validated in-app route. Activation routing into
/// the running window is NOT verified here: it needs a manual Windows pass.
fn present_xml(payload: &super::Present) -> String {
    let body = if payload.body.is_empty() {
        String::new()
    } else {
        format!("<text>{}</text>", escape(&payload.body))
    };
    format!(
        "<toast launch=\"{}\"><visual><binding template=\"ToastGeneric\"><text>{}</text>{body}</binding></visual></toast>",
        escape(&format!("orivane-route:{}", payload.route)),
        escape(&payload.title),
    )
}
pub fn present(_app: &tauri::AppHandle, payload: &super::Present) -> Result<(), String> {
    let _apartment = Apartment::enter()?;
    if !shortcut()?.exists() {
        return Err("notification_permission".into());
    }
    show_with_id(APP_ID, payload)
}
fn show_with_id(app_id: &str, payload: &super::Present) -> Result<(), String> {
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))
        .map_err(|_| "notification_registration")?;
    let setting = notifier
        .Setting()
        .map_err(|error| format!("notification_permission:{:08x}", error.code().0))?;
    if setting != NotificationSetting::Enabled {
        return Err(format!("notification_permission:{}", setting.0));
    }
    let content = XmlDocument::new().map_err(|_| "notification_content")?;
    content
        .LoadXml(&HSTRING::from(present_xml(payload)))
        .map_err(|_| "notification_content")?;
    let toast =
        ToastNotification::CreateToastNotification(&content).map_err(|_| "notification_content")?;
    // Warm and cold clicks are both handled by the registered COM activator.
    // Stable tag: re-presenting the same record replaces instead of stacking.
    toast
        .SetTag(&HSTRING::from(schedule_id(&payload.id)))
        .map_err(|_| "notification_content")?;
    notifier
        .Show(&toast)
        .map_err(|error| format!("notification_show:{:08x}", error.code().0))
}

/// Explicit local acceptance probe. Uses a disposable identity and the actual
/// production XML/tag/presentation helper, never the user's app history.
pub fn presentation_probe() -> Result<String, String> {
    let _apartment = Apartment::enter()?;
    let app_id = format!("app.orivane.atlas.presentation-test.{}", std::process::id());
    let path = shortcut()?.with_file_name(format!("{app_id}.lnk"));
    register(&path, &app_id)?;
    let payload = super::Present {
        id: "presentation-probe".into(),
        title: "Orivane Atlas notification acceptance".into(),
        body: "Disposable local test; no user content.".into(),
        route: "/calendar".into(),
        urgency: "NORMAL".into(),
    };
    let result = (|| {
        show_with_id(&app_id, &payload)?;
        let history = ToastNotificationManager::History().map_err(|_| "notification_history")?;
        let entries = history
            .GetHistoryWithId(&HSTRING::from(&app_id))
            .map_err(|_| "notification_history")?;
        let count = entries.Size().map_err(|_| "notification_history")?;
        history
            .ClearWithId(&HSTRING::from(&app_id))
            .map_err(|_| "notification_history")?;
        if count == 0 {
            return Err("notification_history_empty".into());
        }
        Ok(format!(
            "{{\"presentation\":\"PASS\",\"historyCount\":{count},\"identity\":\"disposable\"}}"
        ))
    })();
    let cleanup = std::fs::remove_file(&path).map_err(|_| "notification_probe_cleanup".to_owned());
    let identity_cleanup = activation::remove_probe_identity(&app_id);
    cleanup?;
    identity_cleanup?;
    result
}
pub fn cancel(ids: &[String]) -> Result<(), String> {
    let _apartment = Apartment::enter()?;
    if !shortcut()?.exists() {
        return Ok(());
    }
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP_ID))
        .map_err(|_| "notification_registration")?;
    let ids: std::collections::HashSet<_> = ids.iter().map(|id| schedule_id(id)).collect();
    for notification in notifier
        .GetScheduledToastNotifications()
        .map_err(|error| format!("notification_schedule:{:08x}", error.code().0))?
    {
        if ids.contains(
            &notification
                .Id()
                .map_err(|error| format!("notification_schedule:{:08x}", error.code().0))?
                .to_string(),
        ) {
            notifier
                .RemoveFromSchedule(&notification)
                .map_err(|error| format!("notification_schedule:{:08x}", error.code().0))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Runs the real Windows scheduler in a disposable desktop identity"]
    fn schedule_in_child() {
        let Ok(app_id) = std::env::var("ATLAS_NOTIFICATION_TEST_ID") else {
            return;
        };
        let _apartment = Apartment::enter().unwrap();
        let path = shortcut().unwrap().with_file_name(format!("{app_id}.lnk"));
        register(&path, &app_id).unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        let intent = Intent {
            id: "disposable-test".into(),
            scope: app_id.clone(),
            title: "Test schedule, canceled before delivery".into(),
            deliver_at_ms: std::env::var("ATLAS_NOTIFICATION_TEST_DEADLINE").ok().and_then(|value| value.parse().ok()).unwrap_or(now + 3600000),
            body: String::new(),
            route: String::new(),
            urgency: String::new(),
        };
        let root = std::env::var_os("ATLAS_NOTIFICATION_TEST_RECEIPTS").map(std::path::PathBuf::from);
        let mut intents = vec![intent.clone()];
        if std::env::var_os("ATLAS_NOTIFICATION_TEST_PARTIAL").is_some() {
            let mut second = intent;
            second.id = "disposable-test-2".into();
            intents.push(second);
        }
        reconcile_receipted(&app_id, &intents, root.as_deref()).unwrap();
        if std::env::var_os("ATLAS_NOTIFICATION_TEST_ACK_EXIT").is_some() { std::process::exit(23); }
    }
    #[test]
    #[ignore = "Requires an interactive Windows notification service"]
    fn os_schedule_survives_scheduling_process_exit() {
        schedule_survives_exit(false);
    }
    #[test]
    #[ignore = "Requires an interactive Windows notification service"]
    fn os_schedule_receipt_survives_ack_process_exit() {
        schedule_survives_exit(true);
    }
    fn schedule_survives_exit(interrupted: bool) {
        let app_id = format!("app.orivane.atlas.test.{}.{interrupted}", std::process::id());
        let path = shortcut().unwrap().with_file_name(format!("{app_id}.lnk"));
        let root = std::env::temp_dir().join(format!("orivane-native-ack-{}-{interrupted}", std::process::id()));
        let deadline = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 + 3600000;
        let mut child = std::process::Command::new(std::env::current_exe().unwrap());
        child.args([
                "--exact",
                "notifications::windows::tests::schedule_in_child",
                "--ignored",
            ])
            .env("ATLAS_NOTIFICATION_TEST_ID", &app_id)
            .env("ATLAS_NOTIFICATION_TEST_DEADLINE", deadline.to_string())
            .env("ATLAS_NOTIFICATION_TEST_RECEIPTS", &root);
        if interrupted { child.env("ATLAS_NOTIFICATION_TEST_ACK_EXIT", "1"); }
        let status = child.status().unwrap();
        let _apartment = Apartment::enter().unwrap();
        let observed = (|| -> Result<u32, String> {
            if if interrupted { status.code() != Some(23) } else { !status.success() } {
                return Err("child scheduling failed".into());
            }
            let intent = Intent { id: "disposable-test".into(), scope: app_id.clone(), title: "Test schedule, canceled before delivery".into(), deliver_at_ms: deadline, body: String::new(), route: String::new(), urgency: String::new() };
            assert!(super::super::receipts::contains(&root, &intent)?);
            reconcile_receipted(&app_id, &[intent], Some(&root))?;
            let notifier =
                ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(&app_id))
                    .map_err(|error| error.to_string())?;
            let scheduled = notifier
                .GetScheduledToastNotifications()
                .map_err(|error| error.to_string())?;
            let count = scheduled.Size().map_err(|error| error.to_string())?;
            reconcile_with_id(&app_id, &[])?;
            assert_eq!(
                notifier
                    .GetScheduledToastNotifications()
                    .unwrap()
                    .Size()
                    .unwrap(),
                0
            );
            Ok(count)
        })();
        if path.exists() {
            std::fs::remove_file(path).unwrap();
        }
        if root.exists() { std::fs::remove_dir_all(root).unwrap(); }
        assert_eq!(observed.unwrap(), 1);
    }
    #[test]
    #[ignore = "Requires interactive Windows scheduler and terminates its disposable child"]
    fn os_schedule_partial_process_kill_recovers_remaining_intents() {
        let app_id = format!("app.orivane.atlas.test.partial.{}", std::process::id());
        let root = std::env::temp_dir().join(format!("orivane-native-partial-{}", std::process::id()));
        let deadline = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 + 3600000;
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "notifications::windows::tests::schedule_in_child", "--ignored"])
            .env("ATLAS_NOTIFICATION_TEST_ID", &app_id)
            .env("ATLAS_NOTIFICATION_TEST_DEADLINE", deadline.to_string())
            .env("ATLAS_NOTIFICATION_TEST_RECEIPTS", &root)
            .env("ATLAS_NOTIFICATION_TEST_PARTIAL", "1")
            .env("ATLAS_NOTIFICATION_TEST_PAUSE_AFTER_RECEIPT", "1")
            .spawn().unwrap();
        let started = std::time::Instant::now();
        while !root.join("test-fsynced-ready").exists() && started.elapsed().as_secs() < 10 {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        child.kill().unwrap();
        let killed = child.wait().unwrap();
        assert!(!killed.success());
        let _apartment = Apartment::enter().unwrap();
        let mut one = Intent { id: "disposable-test".into(), scope: app_id.clone(), title: "Test schedule, canceled before delivery".into(), deliver_at_ms: deadline, body: String::new(), route: String::new(), urgency: String::new() };
        let mut intents = vec![one.clone()];
        one.id = "disposable-test-2".into();
        intents.push(one);
        let partial_receipted = intents.iter().filter(|intent| super::super::receipts::contains(&root, intent).unwrap()).count();
        let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(&app_id)).unwrap();
        let partial_count = notifier.GetScheduledToastNotifications().unwrap().Size().unwrap();
        reconcile_receipted(&app_id, &intents, Some(&root)).unwrap();
        reconcile_receipted(&app_id, &intents, Some(&root)).unwrap();
        let recovered_count = notifier.GetScheduledToastNotifications().unwrap().Size().unwrap();
        let complete = intents.iter().all(|intent| super::super::receipts::contains(&root, intent).unwrap());
        reconcile_with_id(&app_id, &[]).unwrap();
        let shortcut_path = shortcut().unwrap().with_file_name(format!("{app_id}.lnk"));
        if shortcut_path.exists() { std::fs::remove_file(shortcut_path).unwrap(); }
        if root.exists() { std::fs::remove_dir_all(root).unwrap(); }
        assert_eq!(partial_receipted, 1);
        assert_eq!(partial_count, 1);
        assert_eq!(recovered_count, 2);
        assert!(complete);
    }
}
