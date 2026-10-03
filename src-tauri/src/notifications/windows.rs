use super::{schedule_id, Intent};
use std::collections::HashMap;
use windows::core::{w, Interface, GUID, HSTRING, PCWSTR, PWSTR};
use windows::Data::Xml::Dom::XmlDocument;
use windows::Foundation::DateTime;
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::System::Com::StructuredStorage::{
    PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
    COINIT_MULTITHREADED,
};
use windows::Win32::System::Variant::VT_LPWSTR;
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{IShellLinkW, SetCurrentProcessExplicitAppUserModelID, ShellLink};
use windows::UI::Notifications::{
    NotificationSetting, ScheduledToastNotification, ToastNotificationManager,
};

const APP_ID: &str = "app.orivane.atlas";
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
    Ok(())
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
    Ok(
        if notifier.Setting().map_err(|_| "notification_permission")?
            == NotificationSetting::Enabled
        {
            "granted"
        } else {
            "denied"
        }
        .into(),
    )
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
pub fn reconcile(intents: &[Intent]) -> Result<(), String> {
    let _apartment = Apartment::enter()?;
    if !shortcut()?.exists() {
        return if intents.is_empty() {
            Ok(())
        } else {
            Err("notification_permission".into())
        };
    }
    reconcile_with_id(APP_ID, intents)
}
fn reconcile_with_id(app_id: &str, intents: &[Intent]) -> Result<(), String> {
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
                    == xml(&intent.title)
            {
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
            .LoadXml(&HSTRING::from(xml(&intent.title)))
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
    }
    Ok(())
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
            deliver_at_ms: now + 3600000,
        };
        reconcile_with_id(&app_id, &[intent]).unwrap();
    }
    #[test]
    #[ignore = "Requires an interactive Windows notification service"]
    fn os_schedule_survives_scheduling_process_exit() {
        let app_id = format!("app.orivane.atlas.test.{}", std::process::id());
        let path = shortcut().unwrap().with_file_name(format!("{app_id}.lnk"));
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "notifications::windows::tests::schedule_in_child",
                "--ignored",
            ])
            .env("ATLAS_NOTIFICATION_TEST_ID", &app_id)
            .status()
            .unwrap();
        let _apartment = Apartment::enter().unwrap();
        let observed = (|| -> Result<u32, String> {
            if !status.success() {
                return Err("child scheduling failed".into());
            }
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
        assert_eq!(observed.unwrap(), 1);
    }
}
