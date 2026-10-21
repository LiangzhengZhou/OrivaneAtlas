//! Platform acknowledgement journal. Contains only content hashes, never titles,
//! bodies, routes or business rules. A receipt is written only after OS acceptance.
use super::Intent;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};

fn path(root: &Path, intent: &Intent) -> Result<PathBuf, String> {
    let bytes = serde_json::to_vec(intent).map_err(|_| "notification_receipt_encode")?;
    let hash = format!("{:x}", Sha256::digest(bytes));
    Ok(root.join(hash))
}
pub fn contains(root: &Path, intent: &Intent) -> Result<bool, String> {
    match std::fs::read(path(root, intent)?) {
        Ok(value) => Ok(value == b"accepted\n"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err("notification_receipt_read".into()),
    }
}
pub fn accept(root: &Path, intent: &Intent) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|_| "notification_receipt_directory")?;
    if contains(root, intent)? { return Ok(()); }
    // An incomplete write never becomes an acknowledgement. Reconciliation can
    // replace it after a fresh OS acknowledgement; no same-version data changes.
    let mut file = std::fs::OpenOptions::new().create(true).truncate(true).write(true)
        .open(path(root, intent)?).map_err(|_| "notification_receipt_write")?;
    file.write_all(b"accepted\n").map_err(|_| "notification_receipt_write")?;
    file.sync_all().map_err(|_| "notification_receipt_sync".to_owned())?;
    #[cfg(test)]
    if std::env::var_os("ATLAS_NOTIFICATION_TEST_PAUSE_AFTER_RECEIPT").is_some() {
        // Deterministic crash boundary, compiled only into the native test exe.
        // Parent observes the fsynced receipt and terminates this OS process.
        std::fs::write(root.join("test-fsynced-ready"), b"ready").map_err(|_| "notification_test_gate")?;
        std::thread::sleep(std::time::Duration::from_secs(30));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn receipts_survive_reopen_and_never_match_changed_private_payloads() {
        let root = std::env::temp_dir().join(format!("orivane-receipt-test-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let mut intent = Intent { id: "id".into(), scope: "workspace".into(), title: "Private title".into(), body: "Private body".into(), route: "/tasks/task".into(), urgency: "NORMAL".into(), deliver_at_ms: 1000 };
        assert!(!contains(&root, &intent).unwrap());
        accept(&root, &intent).unwrap();
        accept(&root, &intent).unwrap();
        assert!(contains(&root, &intent).unwrap());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        let original = path(&root, &intent).unwrap();
        assert_eq!(std::fs::read(&original).unwrap(), b"accepted\n");
        intent.body.clear();
        assert!(!contains(&root, &intent).unwrap());
        intent.scope = "other-workspace".into();
        assert!(!contains(&root, &intent).unwrap());
        std::fs::write(&original, b"acce").unwrap();
        intent.body = "Private body".into();
        intent.scope = "workspace".into();
        assert!(!contains(&root, &intent).unwrap());
        accept(&root, &intent).unwrap();
        assert!(contains(&root, &intent).unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }
}
