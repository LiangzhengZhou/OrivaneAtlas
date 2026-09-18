//! Native-only credential storage. Never expose these bytes through IPC.
use serde::{Deserialize, Serialize};

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct SavedSession {
    pub origin: String,
    pub cookie: String,
    #[serde(default)]
    pub accounts: Vec<SavedCredential>,
    #[serde(default)]
    pub active: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SavedCredential {
    pub reference: String,
    pub origin: String,
    pub account_id: String,
    pub display_name: String,
    pub cookie: String,
}

pub trait Vault: Send + Sync {
    fn load(&self) -> Result<Option<SavedSession>, String>;
    fn save(&self, session: &SavedSession) -> Result<(), String>;
    fn clear(&self) -> Result<(), String>;
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn dpapi_roundtrip_ciphertext_corruption_and_clear() {
        let directory = std::env::temp_dir().join(format!(
            "atlas-session-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let vault = WindowsVault(directory.join("session.dpapi"));
        assert!(vault.load().unwrap().is_none());
        let session = SavedSession {
            origin: "https://private.example".into(),
            cookie: format!("arc_session={}", "a".repeat(64)),
            ..SavedSession::default()
        };
        vault.save(&session).unwrap();
        let raw = std::fs::read(&vault.0).unwrap();
        assert!(!raw
            .windows(session.cookie.len())
            .any(|v| v == session.cookie.as_bytes()));
        assert_eq!(vault.load().unwrap().unwrap().cookie, session.cookie);
        vault.save(&session).unwrap();
        let mut corrupt = raw;
        let index = corrupt.len() / 2;
        corrupt[index] ^= 0xff;
        std::fs::write(&vault.0, corrupt).unwrap();
        assert!(vault.load().unwrap().is_none());
        assert!(!vault.0.exists());
        vault.save(&session).unwrap();
        vault.clear().unwrap();
        assert!(vault.load().unwrap().is_none());
        std::fs::remove_dir(directory).unwrap();
    }
}

#[cfg(windows)]
pub struct WindowsVault(pub std::path::PathBuf);

#[cfg(windows)]
fn protect(data: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{Foundation::LocalFree, Security::Cryptography::*};
    let mut input = data.to_vec();
    let source = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    // Current Windows user, never LOCAL_MACHINE. UI is forbidden in background restore.
    let ok = unsafe {
        if encrypt {
            CryptProtectData(
                &source,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &source,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    input.fill(0);
    if ok == 0 {
        return Err("SECURE_STORAGE".into());
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        std::slice::from_raw_parts_mut(output.pbData, output.cbData as usize).fill(0);
        LocalFree(output.pbData.cast());
    }
    Ok(result)
}

#[cfg(windows)]
impl Vault for WindowsVault {
    fn load(&self) -> Result<Option<SavedSession>, String> {
        let data = match std::fs::read(&self.0) {
            Ok(data) => data,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("SECURE_STORAGE".into()),
        };
        let decoded = if data.len() <= 131072 {
            protect(&data, false).ok()
        } else {
            None
        };
        let result = decoded.and_then(|mut bytes| {
            let value = serde_json::from_slice(&bytes).ok();
            bytes.fill(0);
            value
        });
        if result.is_none() {
            self.clear()?;
        }
        Ok(result)
    }
    fn save(&self, session: &SavedSession) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(session).map_err(|_| "SECURE_STORAGE")?;
        let encrypted = protect(&bytes, true);
        bytes.fill(0);
        let encrypted = encrypted?;
        std::fs::create_dir_all(self.0.parent().ok_or("SECURE_STORAGE")?)
            .map_err(|_| "SECURE_STORAGE")?;
        let pending = self.0.with_extension("pending");
        std::fs::write(&pending, encrypted).map_err(|_| "SECURE_STORAGE")?;
        std::fs::rename(pending, &self.0).map_err(|_| "SECURE_STORAGE".into())
    }
    fn clear(&self) -> Result<(), String> {
        for path in [&self.0, &self.0.with_extension("pending")] {
            match std::fs::remove_file(path) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(_) => return Err("SECURE_STORAGE".into()),
            }
        }
        Ok(())
    }
}

#[cfg(target_os = "android")]
pub struct AndroidVault(pub tauri::plugin::PluginHandle<tauri::Wry>);
#[cfg(target_os = "android")]
impl Vault for AndroidVault {
    fn load(&self) -> Result<Option<SavedSession>, String> {
        #[derive(Deserialize)]
        struct Loaded {
            value: Option<String>,
        }
        let result: Loaded = self
            .0
            .run_mobile_plugin("load", ())
            .map_err(|_| "SECURE_STORAGE")?;
        result
            .value
            .map(|v| serde_json::from_str(&v).map_err(|_| "SECURE_STORAGE".into()))
            .transpose()
    }
    fn save(&self, session: &SavedSession) -> Result<(), String> {
        let value = serde_json::to_string(session).map_err(|_| "SECURE_STORAGE")?;
        self.0
            .run_mobile_plugin::<serde_json::Value>("save", serde_json::json!({"value": value}))
            .map_err(|_| "SECURE_STORAGE")?;
        Ok(())
    }
    fn clear(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("clear", ())
            .map_err(|_| "SECURE_STORAGE")?;
        Ok(())
    }
}
