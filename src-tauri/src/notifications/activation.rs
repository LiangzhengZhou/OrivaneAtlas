//! Per-user COM activation lets Action Center launch the app after exit.
//! Both warm and cold clicks feed the same take-once native route queue.
use std::{ffi::c_void, sync::Arc};
use windows::core::{implement, IUnknown, Interface, Ref, BOOL, GUID, PCWSTR};
use windows::Win32::System::Com::{
    CoRegisterClassObject, CoRevokeClassObject, IClassFactory, IClassFactory_Impl,
    CLSCTX_LOCAL_SERVER, REGCLS_MULTIPLEUSE,
};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
    KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
};
use windows::Win32::UI::Notifications::{
    INotificationActivationCallback, INotificationActivationCallback_Impl,
    NOTIFICATION_USER_INPUT_DATA,
};

pub const CLSID: GUID = GUID::from_u128(0x54bdc20a_78b8_4bf2_a2e8_da3a32561396);
pub const CLSID_TEXT: &str = "{54BDC20A-78B8-4BF2-A2E8-DA3A32561396}";

pub fn remove_probe_identity(app_id: &str) -> Result<(), String> {
    if !app_id.starts_with("app.orivane.atlas.presentation-test.") {
        return Err("notification_probe_identity".into());
    }
    let path: Vec<u16> = format!("Software\\Classes\\AppUserModelId\\{app_id}")
        .encode_utf16()
        .chain(Some(0))
        .collect();
    unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, PCWSTR(path.as_ptr())) }
        .ok()
        .map_err(|_| "notification_probe_cleanup".into())
}

/// Unpackaged Windows applications need an explicit notification identity;
/// a newly written shortcut is not guaranteed to have been indexed by Explorer.
pub fn register_identity(app_id: &str) -> Result<(), String> {
    let name: Vec<u16> = format!("Software\\Classes\\AppUserModelId\\{app_id}")
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let mut key = HKEY::default();
    unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(name.as_ptr()),
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
        .ok()
        .map_err(|_| "notification_identity")?;
        let result = (|| {
            for (property, value) in [
                ("DisplayName", "Orivane Atlas"),
                ("CustomActivator", CLSID_TEXT),
            ] {
                let property: Vec<u16> = property.encode_utf16().chain(Some(0)).collect();
                let bytes: Vec<u8> = value
                    .encode_utf16()
                    .chain(Some(0))
                    .flat_map(u16::to_le_bytes)
                    .collect();
                RegSetValueExW(key, PCWSTR(property.as_ptr()), None, REG_SZ, Some(&bytes))
                    .ok()
                    .map_err(|_| "notification_identity".to_owned())?;
            }
            Ok(())
        })();
        let _ = RegCloseKey(key);
        result
    }
}
type Callback = Arc<dyn Fn(&str) + Send + Sync>;

#[implement(INotificationActivationCallback)]
struct Activator(Callback);
impl INotificationActivationCallback_Impl for Activator_Impl {
    fn Activate(
        &self,
        app_id: &PCWSTR,
        args: &PCWSTR,
        _: *const NOTIFICATION_USER_INPUT_DATA,
        _: u32,
    ) -> windows::core::Result<()> {
        // Windows owns these null-terminated strings for the duration of Activate.
        let id = unsafe { app_id.to_string() }?;
        let argument = unsafe { args.to_string() }?;
        if id == super::APP_ID {
            if let Some(route) = argument.strip_prefix("orivane-route:") {
                if super::super::route_is_in_app(route) {
                    (self.0)(route);
                }
            }
        }
        Ok(())
    }
}

#[implement(IClassFactory)]
struct Factory(Callback);
impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(
        &self,
        outer: Ref<'_, IUnknown>,
        iid: *const GUID,
        out: *mut *mut c_void,
    ) -> windows::core::Result<()> {
        if iid.is_null() || out.is_null() {
            return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                0x80004003u32 as i32,
            )));
        }
        unsafe {
            *out = std::ptr::null_mut();
        }
        if outer.is_some() {
            return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                0x80040110u32 as i32,
            )));
        }
        let callback: INotificationActivationCallback = Activator(self.0.clone()).into();
        unsafe { callback.query(iid, out).ok() }
    }
    fn LockServer(&self, _: BOOL) -> windows::core::Result<()> {
        Ok(())
    }
}

pub fn register_executable() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|_| "notification_registration")?;
    let key_name = format!("Software\\Classes\\CLSID\\{CLSID_TEXT}\\LocalServer32");
    let key_wide: Vec<u16> = key_name.encode_utf16().chain(Some(0)).collect();
    let command = format!("\"{}\" -Embedding", exe.display());
    let bytes: Vec<u8> = command
        .encode_utf16()
        .chain(Some(0))
        .flat_map(u16::to_le_bytes)
        .collect();
    let mut key = HKEY::default();
    unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(key_wide.as_ptr()),
            None,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
        .ok()
        .map_err(|_| "notification_registration")?;
        let result = RegSetValueExW(key, PCWSTR::null(), None, REG_SZ, Some(&bytes));
        let _ = RegCloseKey(key);
        result
            .ok()
            .map_err(|_| "notification_registration".to_owned())
    }
}

/// A dedicated MTA keeps the class object alive until the app is torn down.
pub fn start(app: tauri::AppHandle) -> Result<std::sync::mpsc::Sender<()>, String> {
    let (stop, receiver) = std::sync::mpsc::channel();
    let (ready, result) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let apartment = super::Apartment::enter();
        let registration = apartment.as_ref().map_err(Clone::clone).and_then(|_| {
            let factory: IClassFactory =
                Factory(Arc::new(move |route| super::super::activate(&app, route))).into();
            unsafe {
                CoRegisterClassObject(&CLSID, &factory, CLSCTX_LOCAL_SERVER, REGCLS_MULTIPLEUSE)
            }
            .map_err(|_| "notification_activation".to_owned())
        });
        let _ = ready.send(registration.as_ref().map(|_| ()).map_err(Clone::clone));
        if let Ok(cookie) = registration {
            let _ = receiver.recv();
            let _ = unsafe { CoRevokeClassObject(cookie) };
        }
        drop(apartment);
    });
    result
        .recv()
        .map_err(|_| "notification_activation".to_owned())??;
    Ok(stop)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use windows::core::HSTRING;
    #[test]
    fn com_activation_accepts_only_our_app_and_local_routes() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let records = seen.clone();
        let callback: INotificationActivationCallback = Activator(Arc::new(move |r| {
            records.lock().unwrap().push(r.to_owned())
        }))
        .into();
        for (app, arg) in [
            (super::super::APP_ID, "orivane-route:/tasks/abc"),
            ("foreign.app", "orivane-route:/tasks/other"),
            (super::super::APP_ID, "orivane-route://evil"),
            (super::super::APP_ID, "orivane-route:https://evil"),
        ] {
            let app = HSTRING::from(app);
            let arg = HSTRING::from(arg);
            unsafe { callback.Activate(PCWSTR(app.as_ptr()), PCWSTR(arg.as_ptr()), &[]) }.unwrap();
        }
        assert_eq!(*seen.lock().unwrap(), vec!["/tasks/abc"]);
    }
}
