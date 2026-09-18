use base64::Engine;
use reqwest::{Client, Url};
use serde::Serialize;
use std::{sync::Mutex, time::Duration};

#[derive(Default)]
struct Session {
    origin: String,
    cookie: String,
    generation: u64,
    reference: Option<String>,
    expected_account: Option<String>,
}
#[derive(Default)]
pub struct Transport(Mutex<Session>, Option<Box<dyn crate::session_store::Vault>>);

impl Transport {
    pub fn with_vault(vault: impl crate::session_store::Vault + 'static) -> Self {
        Self(Mutex::default(), Some(Box::new(vault)))
    }
}

fn normalize(value: &str) -> Result<String, String> {
    let url = Url::parse(value.trim()).map_err(|_| "INVALID_SERVER")?;
    if !(url.scheme() == "https" || (url.scheme() == "http" && url.host_str() == Some("127.0.0.1")))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("INVALID_SERVER".into());
    }
    Ok(url.origin().ascii_serialization())
}

fn endpoint(origin: &str, path: &str, post: bool) -> Result<Url, String> {
    if path.contains(['\\', '#', '\r', '\n']) || !path.starts_with("/api/") {
        return Err("INVALID_SERVER".into());
    }
    let raw_path = path.split('?').next().unwrap_or("");
    let allowed = if post {
        &[
            "/api/session",
            "/api/register",
            "/api/account/password",
            "/api/account/sessions/revoke",
            "/api/account/claim",
            "/api/admin/status",
            "/api/admin/session-policy",
            "/api/tokens/create",
            "/api/tokens/revoke",
            "/api/logout",
            "/api/work/create",
            "/api/projects/document",
            "/api/projects/link",
            "/api/projects/upload",
            "/api/projects/delete",
            "/api/work/update",
            "/api/work/delete",
            "/api/edge/create",
            "/api/edge/delete",
            "/api/library/save",
            "/api/library/delete",
            "/api/library/upload-chunk",
            "/api/ai/providers/save",
            "/api/ai/providers/remove",
            "/api/ai/propose",
            "/api/ai/apply",
            "/api/ai/decide",
            "/api/link/create",
            "/api/link/delete",
            "/api/backup",
            "/api/organize",
            "/api/categories/save",
            "/api/plans/preview",
            "/api/plans/publish",
            "/api/recurrences/save",
            "/api/recurrences/generate",
            "/api/recurrences/backfill",
            "/api/note/save",
            "/api/note/delete",
        ][..]
    } else {
        &[
            "/api/health",
            "/api/session",
            "/api/snapshot",
            "/api/sync",
            "/api/admin",
            "/api/tokens",
            "/api/account/sessions",
            "/api/library",
            "/api/library/revisions",
            "/api/library/asset",
            "/api/ai/providers",
            "/api/ai",
            "/api/activity",
            "/api/projects/file",
            "/api/projects/activity",
            "/api/revisions",
        ][..]
    };
    if !allowed.contains(&raw_path) {
        return Err("INVALID_SERVER".into());
    }
    let url = Url::parse(&(origin.to_string() + path)).map_err(|_| "INVALID_SERVER")?;
    if url.origin().ascii_serialization() != origin || url.path() != raw_path {
        return Err("INVALID_SERVER".into());
    }
    Ok(url)
}

fn client() -> Result<Client, String> {
    // Bundled public roots avoid Android JNI trust-store initialization requirements.
    // No invalid-certificate bypass or trust-on-first-use fallback.
    let roots = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls = rustls::ClientConfig::builder_with_provider(
        rustls::crypto::ring::default_provider().into(),
    )
    .with_safe_default_protocol_versions()
    .map_err(|_| "NETWORK_ERROR")?
    .with_root_certificates(roots)
    .with_no_client_auth();
    Client::builder()
        .tls_backend_preconfigured(tls)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .build()
        .map_err(|_| "NETWORK_ERROR".into())
}
fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "LOGIN_TIMEOUT"
    } else {
        "NETWORK_ERROR"
    }
    .into()
}

#[tauri::command]
pub async fn configure_server(
    state: tauri::State<'_, Transport>,
    origin: String,
) -> Result<(), String> {
    configure(&state, &origin)
}
fn configure(state: &Transport, origin: &str) -> Result<(), String> {
    let origin = normalize(origin)?;
    let mut current = state.0.lock().map_err(|_| "NETWORK_ERROR")?;
    if current.origin == origin {
        return Ok(());
    }
    current.cookie.clear();
    current.reference = None;
    current.expected_account = None;
    current.generation += 1;
    if let Some(vault) = &state.1 {
        if let Some(saved) = vault.load()? {
            if let Some(entry) = saved.accounts.iter().find(|entry| {
                Some(&entry.reference) == saved.active.as_ref() && entry.origin == origin
            }) {
                if valid_cookie(&entry.cookie) {
                    current.cookie = entry.cookie.clone();
                    current.reference = Some(entry.reference.clone());
                    current.expected_account = Some(entry.account_id.clone());
                }
            } else if saved.origin == origin && valid_cookie(&saved.cookie) {
                current.cookie = saved.cookie;
            }
        }
    }
    current.origin = origin;
    Ok(())
}

fn write_store(
    state: &Transport,
    saved: &crate::session_store::SavedSession,
) -> Result<(), String> {
    if let Some(vault) = &state.1 {
        if saved.accounts.is_empty() && saved.cookie.is_empty() {
            vault.clear()?;
        } else {
            vault.save(saved)?;
        }
    }
    Ok(())
}

fn forget_current(state: &Transport, current: &mut Session) -> Result<(), String> {
    if let Some(vault) = &state.1 {
        let mut saved = vault.load()?.unwrap_or_default();
        saved
            .accounts
            .retain(|entry| Some(&entry.reference) != current.reference.as_ref());
        if saved.active == current.reference {
            saved.active = None;
        }
        if saved.origin == current.origin {
            saved.origin.clear();
            saved.cookie.clear();
        }
        write_store(state, &saved)?;
    }
    current.cookie.clear();
    current.reference = None;
    current.expected_account = None;
    current.generation += 1;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountMetadata {
    id: String,
    server_url: String,
    user_id: String,
    display_name: String,
    credential_reference: String,
}

#[tauri::command]
pub fn saved_accounts(state: tauri::State<'_, Transport>) -> Result<Vec<AccountMetadata>, String> {
    let _guard = state.0.lock().map_err(|_| "SECURE_STORAGE")?;
    let saved = match &state.1 {
        Some(vault) => vault.load()?.unwrap_or_default(),
        None => return Ok(Vec::new()),
    };
    Ok(saved
        .accounts
        .into_iter()
        .map(|entry| AccountMetadata {
            id: format!("{}|{}", entry.origin, entry.account_id),
            server_url: entry.origin,
            user_id: entry.account_id,
            display_name: entry.display_name,
            credential_reference: entry.reference,
        })
        .collect())
}

#[tauri::command]
pub fn detach_account(state: tauri::State<'_, Transport>) -> Result<(), String> {
    let mut current = state.0.lock().map_err(|_| "SECURE_STORAGE")?;
    current.cookie.clear();
    current.reference = None;
    current.expected_account = None;
    current.generation += 1;
    Ok(())
}

#[tauri::command]
pub fn forget_account(state: tauri::State<'_, Transport>, reference: String) -> Result<(), String> {
    let mut current = state.0.lock().map_err(|_| "SECURE_STORAGE")?;
    let vault = state.1.as_ref().ok_or("SECURE_STORAGE")?;
    let mut saved = vault.load()?.unwrap_or_default();
    saved.accounts.retain(|entry| entry.reference != reference);
    if saved.active.as_ref() == Some(&reference) {
        saved.active = None;
    }
    write_store(&state, &saved)?;
    if current.reference.as_ref() == Some(&reference) {
        current.cookie.clear();
        current.reference = None;
        current.expected_account = None;
        current.generation += 1;
    }
    Ok(())
}

async fn select(state: &Transport, reference: String) -> Result<Reply, String> {
    let origin = {
        let mut current = state.0.lock().map_err(|_| "SECURE_STORAGE")?;
        let saved = state
            .1
            .as_ref()
            .ok_or("SECURE_STORAGE")?
            .load()?
            .unwrap_or_default();
        let entry = saved
            .accounts
            .iter()
            .find(|entry| entry.reference == reference)
            .ok_or("UNAUTHORIZED")?;
        let origin = normalize(&entry.origin)?;
        if origin != entry.origin || !valid_cookie(&entry.cookie) {
            return Err("SECURE_STORAGE".into());
        }
        current.origin = origin.clone();
        current.cookie = entry.cookie.clone();
        current.reference = Some(entry.reference.clone());
        current.expected_account = Some(entry.account_id.clone());
        current.generation += 1;
        origin
    };
    send(
        state,
        origin,
        "/api/session".into(),
        None,
        String::new(),
        String::new(),
    )
    .await
}

#[tauri::command]
pub async fn select_account(
    state: tauri::State<'_, Transport>,
    reference: String,
) -> Result<Reply, String> {
    select(&state, reference).await
}

fn valid_cookie(cookie: &str) -> bool {
    cookie
        .strip_prefix("arc_session=")
        .is_some_and(|token| token.len() == 64 && token.bytes().all(|b| b.is_ascii_hexdigit()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    status: u16,
    content_type: String,
    body: String,
}

#[tauri::command]
pub async fn server_request(
    state: tauri::State<'_, Transport>,
    origin: String,
    path: String,
    payload: Option<String>,
    csrf: String,
    idempotency_key: String,
) -> Result<Reply, String> {
    send(&state, origin, path, payload, csrf, idempotency_key).await
}
async fn send(
    state: &Transport,
    origin: String,
    path: String,
    payload: Option<String>,
    csrf: String,
    idempotency_key: String,
) -> Result<Reply, String> {
    let (cookie, generation) = {
        let mut current = state.0.lock().map_err(|_| "NETWORK_ERROR")?;
        if current.origin != origin || origin.is_empty() {
            return Err("INVALID_SERVER".into());
        }
        let cookie = if path == "/api/session" && payload.is_some() {
            current.cookie.clear();
            current.reference = None;
            current.expected_account = None;
            current.generation += 1;
            String::new()
        } else {
            current.cookie.clone()
        };
        if path == "/api/logout" && payload.is_some() {
            forget_current(state, &mut current)?;
        }
        (cookie, current.generation)
    };
    let url = endpoint(&origin, &path, payload.is_some())?;
    let timeout = if url.path() == "/api/session" {
        8
    } else if ["/api/backup", "/api/library/asset"].contains(&url.path()) {
        60
    } else {
        15
    };
    let client = client()?;
    let mut request = if let Some(body) = payload {
        client
            .post(url)
            .header("Content-Type", "application/json")
            .header("X-CSRF-Token", csrf)
            .header("Idempotency-Key", idempotency_key)
            .body(body)
    } else {
        client.get(url)
    };
    request = request
        .header("Origin", &origin)
        .timeout(Duration::from_secs(timeout));
    if !cookie.is_empty() {
        request = request.header("Cookie", cookie);
    }
    let response = request.send().await.map_err(network_error)?;
    if response.status().is_redirection() {
        return Err("INVALID_RESPONSE".into());
    }
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let new_cookie = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .filter_map(|v| v.split(';').next())
        .find(|v| v.starts_with("arc_session="))
        .map(str::to_string);
    let bytes = response.bytes().await.map_err(network_error)?;
    let mut current = state.0.lock().map_err(|_| "NETWORK_ERROR")?;
    if current.generation != generation {
        return Err("SERVER_CHANGED".into());
    }
    if status == 401 || (path == "/api/logout" && status < 300) {
        forget_current(state, &mut current)?;
    } else if (200..300).contains(&status) {
        if let Some(cookie) = new_cookie {
            if !valid_cookie(&cookie) {
                forget_current(state, &mut current)?;
            } else {
                current.cookie = cookie;
            }
        }
        let identity = if path == "/api/session" {
            let body: serde_json::Value =
                serde_json::from_slice(&bytes).map_err(|_| "INVALID_RESPONSE")?;
            let account = body.get("account");
            let id = account
                .and_then(|value| value.get("id"))
                .and_then(|value| value.as_str());
            if current
                .expected_account
                .as_deref()
                .is_some_and(|expected| Some(expected) != id)
            {
                forget_current(state, &mut current)?;
                return Err("ACCOUNT_MISMATCH".into());
            }
            id.zip(
                account
                    .and_then(|value| value.get("username"))
                    .and_then(|value| value.as_str()),
            )
            .map(|(id, name)| (id.to_string(), name.to_string()))
        } else {
            None
        };
        if let Some(vault) = &state.1 {
            let mut saved = vault.load()?.unwrap_or_default();
            if valid_cookie(&current.cookie) {
                if let Some((id, name)) = identity {
                    if id.len() > 256 || name.len() > 256 {
                        return Err("INVALID_RESPONSE".into());
                    }
                    let reference = format!("native:{}|{}", current.origin, id);
                    saved.accounts.retain(|entry| entry.reference != reference);
                    if saved.accounts.len() >= 20 {
                        return Err("VAULT_FULL".into());
                    }
                    saved.accounts.push(crate::session_store::SavedCredential {
                        reference: reference.clone(),
                        origin: current.origin.clone(),
                        account_id: id.clone(),
                        display_name: name,
                        cookie: current.cookie.clone(),
                    });
                    current.reference = Some(reference.clone());
                    current.expected_account = Some(id);
                    saved.active = Some(reference);
                    saved.origin.clear();
                    saved.cookie.clear();
                } else if let Some(entry) = saved
                    .accounts
                    .iter_mut()
                    .find(|entry| Some(&entry.reference) == current.reference.as_ref())
                {
                    entry.cookie = current.cookie.clone();
                } else {
                    saved.origin = current.origin.clone();
                    saved.cookie = current.cookie.clone();
                }
                write_store(state, &saved)?;
            }
        }
    }
    Ok(Reply {
        status,
        content_type,
        body: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_store::{SavedSession, Vault};
    use std::sync::Arc;

    #[derive(Clone, Default)]
    struct MemoryVault(Arc<Mutex<Option<String>>>);
    impl Vault for MemoryVault {
        fn load(&self) -> Result<Option<SavedSession>, String> {
            Ok(self
                .0
                .lock()
                .unwrap()
                .as_ref()
                .map(|v| serde_json::from_str(v).unwrap()))
        }
        fn save(&self, value: &SavedSession) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(serde_json::to_string(value).unwrap());
            Ok(())
        }
        fn clear(&self) -> Result<(), String> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }
    fn fixture(
        replies: Vec<(u16, serde_json::Value, Option<String>)>,
    ) -> (String, std::thread::JoinHandle<Vec<String>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for (status, body, cookie) in replies {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut buffer = [0; 8192];
                let length = stream.read(&mut buffer).unwrap();
                requests.push(String::from_utf8_lossy(&buffer[..length]).into_owned());
                let body = body.to_string();
                let cookie = cookie
                    .map(|value| format!("Set-Cookie: {value}; HttpOnly\r\n"))
                    .unwrap_or_default();
                let reply = format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\n{cookie}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                stream.write_all(reply.as_bytes()).unwrap();
            }
            requests
        });
        (origin, worker)
    }
    fn identity(id: &str) -> serde_json::Value {
        serde_json::json!({"account":{"id":id,"username":id},"context":{"workspaceId":id,"principalId":id},"csrf":"verified-csrf"})
    }
    fn credential(origin: &str, id: &str, token: char) -> crate::session_store::SavedCredential {
        crate::session_store::SavedCredential {
            origin: origin.into(),
            reference: format!("native:{origin}|{id}"),
            account_id: id.into(),
            display_name: id.into(),
            cookie: format!("arc_session={}", token.to_string().repeat(64)),
        }
    }
    #[test]
    fn multiple_accounts_switch_back_without_password_and_logout_only_selected() {
        let (origin, worker) = fixture(vec![
            (200, identity("first"), None),
            (200, identity("second"), None),
            (200, identity("first"), None),
            (200, serde_json::json!({}), None),
        ]);
        let first = credential(&origin, "first", 'a');
        let second = credential(&origin, "second", 'b');
        let vault = MemoryVault::default();
        vault
            .save(&SavedSession {
                accounts: vec![first.clone(), second.clone()],
                ..SavedSession::default()
            })
            .unwrap();
        let state = Transport::with_vault(vault.clone());
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            for reference in [&first.reference, &second.reference, &first.reference] {
                assert_eq!(select(&state, reference.clone()).await.unwrap().status, 200);
            }
            assert_eq!(vault.load().unwrap().unwrap().accounts.len(), 2);
            send(
                &state,
                origin,
                "/api/logout".into(),
                Some("{}".into()),
                "verified-csrf".into(),
                String::new(),
            )
            .await
            .unwrap();
        });
        let requests = worker.join().unwrap();
        assert!(requests[0].contains(&first.cookie));
        assert!(requests[1].contains(&second.cookie));
        assert!(requests[2].contains(&first.cookie));
        assert!(requests[3].contains(&first.cookie));
        let saved = vault.load().unwrap().unwrap();
        assert_eq!(saved.accounts.len(), 1);
        assert_eq!(saved.accounts[0].reference, second.reference);
        assert!(state.0.lock().unwrap().cookie.is_empty());
    }
    #[test]
    fn trusted_identity_mismatch_removes_only_the_selected_entry() {
        let (origin, worker) = fixture(vec![(200, identity("wrong-account"), None)]);
        let selected = credential(&origin, "expected", 'a');
        let unrelated = credential("https://other.example", "expected", 'b');
        let vault = MemoryVault::default();
        vault
            .save(&SavedSession {
                accounts: vec![selected.clone(), unrelated.clone()],
                ..SavedSession::default()
            })
            .unwrap();
        let state = Transport::with_vault(vault.clone());
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(select(&state, selected.reference));
        assert_eq!(result.err().unwrap(), "ACCOUNT_MISMATCH");
        assert!(state.0.lock().unwrap().cookie.is_empty());
        let remaining = vault.load().unwrap().unwrap();
        assert_eq!(remaining.accounts.len(), 1);
        assert_eq!(remaining.accounts[0].reference, unrelated.reference);
        worker.join().unwrap();
    }
    #[test]
    fn same_account_id_on_different_servers_never_shares_a_cookie() {
        let (first_origin, first_worker) = fixture(vec![(200, identity("same"), None)]);
        let (second_origin, second_worker) = fixture(vec![(200, identity("same"), None)]);
        let first = credential(&first_origin, "same", 'a');
        let second = credential(&second_origin, "same", 'b');
        let vault = MemoryVault::default();
        vault
            .save(&SavedSession {
                accounts: vec![first.clone(), second.clone()],
                ..SavedSession::default()
            })
            .unwrap();
        let state = Transport::with_vault(vault.clone());
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            select(&state, first.reference.clone()).await.unwrap();
            select(&state, second.reference.clone()).await.unwrap();
        });
        let first_requests = first_worker.join().unwrap();
        let second_requests = second_worker.join().unwrap();
        assert!(first_requests[0].contains(&first.cookie));
        assert!(!first_requests[0].contains(&second.cookie));
        assert!(second_requests[0].contains(&second.cookie));
        assert!(!second_requests[0].contains(&first.cookie));
        assert_eq!(vault.load().unwrap().unwrap().accounts.len(), 2);
    }
    #[test]
    fn signing_in_another_account_never_sends_the_retained_cookie() {
        let next_cookie = format!("arc_session={}", "b".repeat(64));
        let (origin, worker) = fixture(vec![(200, identity("second"), Some(next_cookie))]);
        let first = credential(&origin, "first", 'a');
        let vault = MemoryVault::default();
        vault
            .save(&SavedSession {
                accounts: vec![first.clone()],
                active: Some(first.reference),
                ..SavedSession::default()
            })
            .unwrap();
        let state = Transport::with_vault(vault.clone());
        configure(&state, &origin).unwrap();
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(send(
                &state,
                origin,
                "/api/session".into(),
                Some("{\"username\":\"second\",\"password\":\"request-only\"}".into()),
                String::new(),
                String::new(),
            ))
            .unwrap();
        let requests = worker.join().unwrap();
        assert!(!requests[0].to_lowercase().contains("cookie:"));
        let saved = vault.load().unwrap().unwrap();
        assert_eq!(saved.accounts.len(), 2);
        assert!(!serde_json::to_string(&saved)
            .unwrap()
            .contains("request-only"));
    }
    #[test]
    fn revoked_selection_preserves_other_server_and_legacy_promotes() {
        let (origin, worker) = fixture(vec![
            (200, identity("legacy"), None),
            (401, serde_json::json!({}), None),
        ]);
        let vault = MemoryVault::default();
        vault
            .save(&SavedSession {
                origin: origin.clone(),
                cookie: format!("arc_session={}", "a".repeat(64)),
                accounts: vec![credential("https://other.example", "legacy", 'b')],
                ..SavedSession::default()
            })
            .unwrap();
        let state = Transport::with_vault(vault.clone());
        configure(&state, &origin).unwrap();
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            send(
                &state,
                origin.clone(),
                "/api/session".into(),
                None,
                String::new(),
                String::new(),
            )
            .await
            .unwrap();
            let saved = vault.load().unwrap().unwrap();
            assert!(saved.cookie.is_empty());
            assert_eq!(saved.accounts.len(), 2);
            assert_eq!(
                select(&state, format!("native:{origin}|legacy"))
                    .await
                    .unwrap()
                    .status,
                401
            );
        });
        let saved = vault.load().unwrap().unwrap();
        assert_eq!(saved.accounts.len(), 1);
        assert_eq!(saved.accounts[0].origin, "https://other.example");
        worker.join().unwrap();
    }
    #[test]
    fn legacy_restore_is_origin_bound_and_switch_preserves() {
        let vault = MemoryVault::default();
        let cookie = format!("arc_session={}", "b".repeat(64));
        vault
            .save(&SavedSession {
                origin: "https://one.example".into(),
                cookie: cookie.clone(),
                ..SavedSession::default()
            })
            .unwrap();
        let state = Transport::with_vault(vault.clone());
        configure(&state, "https://one.example/").unwrap();
        assert_eq!(state.0.lock().unwrap().cookie, cookie);
        configure(&state, "https://one.example").unwrap();
        assert_eq!(state.0.lock().unwrap().cookie, cookie);
        drop(state);
        let restarted = Transport::with_vault(vault.clone());
        configure(&restarted, "https://one.example").unwrap();
        assert_eq!(restarted.0.lock().unwrap().cookie, cookie);
        configure(&restarted, "https://two.example").unwrap();
        assert!(restarted.0.lock().unwrap().cookie.is_empty());
        assert!(vault.load().unwrap().is_some());
        vault
            .save(&SavedSession {
                origin: "https://one.example".into(),
                cookie,
                ..SavedSession::default()
            })
            .unwrap();
        let mismatched = Transport::with_vault(vault.clone());
        configure(&mismatched, "https://two.example").unwrap();
        assert!(vault.load().unwrap().is_some());
    }

    #[test]
    fn logout_forgets_even_when_network_is_unavailable() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let vault = MemoryVault::default();
        vault
            .save(&SavedSession {
                origin: origin.clone(),
                cookie: format!("arc_session={}", "c".repeat(64)),
                ..SavedSession::default()
            })
            .unwrap();
        let state = Transport::with_vault(vault.clone());
        configure(&state, &origin).unwrap();
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            assert!(send(
                &state,
                origin,
                "/api/logout".into(),
                Some("{}".into()),
                String::new(),
                String::new()
            )
            .await
            .is_err());
        });
        assert!(state.0.lock().unwrap().cookie.is_empty());
        assert!(vault.load().unwrap().is_none());
    }
    #[test]
    #[ignore = "Requires local strict-host fixture"]
    fn strict_host_contract() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let origin = std::env::var("ATLAS_TEST_ORIGIN").unwrap();
            let password = std::env::var("ATLAS_TEST_PASSWORD").unwrap();
            let vault = MemoryVault::default();
            let state = Transport::with_vault(vault.clone());
            configure(&state, &origin).unwrap();
            let call = |path: &str, body: Option<String>, csrf: &str| {
                send(&state, origin.clone(), path.into(), body, csrf.into(), String::new())
            };
            let wrong = serde_json::json!({"username":"native-test","password":"wrong-password"}).to_string();
            assert_eq!(call("/api/session", Some(wrong), "").await.unwrap().status, 401);
            let login = serde_json::json!({"username":"native-test","password":password}).to_string();
            let reply = call("/api/session", Some(login), "").await.unwrap();
            assert_eq!(reply.status, 200);
            let bytes = base64::engine::general_purpose::STANDARD.decode(reply.body).unwrap();
            let data: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            let csrf = data["csrf"].as_str().unwrap();
            assert_eq!(call("/api/session", None, "").await.unwrap().status, 200);
            assert_eq!(call("/api/snapshot", None, "").await.unwrap().status, 200);
            let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lL8AAAAASUVORK5CYII=";
            let upload = serde_json::json!({"uploadId":"781a8601-a661-451c-9c66-50b880c62c78", "spaceId":null, "name":"native.png", "mime":"image/png", "base64":png, "index":0, "final":true}).to_string();
            let image = send(&state, origin.clone(), "/api/library/upload-chunk".into(), Some(upload), csrf.into(), "bee57582-4255-49bd-af20-75f616c38aa5".into()).await.unwrap();
            assert_eq!(image.status, 200);
            let image_data: serde_json::Value = serde_json::from_slice(&base64::engine::general_purpose::STANDARD.decode(image.body).unwrap()).unwrap();
            let image = call(image_data["url"].as_str().unwrap(), None, "").await.unwrap();
            assert_eq!(image.status, 200);
            assert_eq!(image.content_type, "image/png");
            assert_eq!(image.body, png);
            let restored = Transport::with_vault(vault.clone());
            configure(&restored, &origin).unwrap();
            assert_eq!(send(&restored, origin.clone(), "/api/session".into(), None, String::new(), String::new()).await.unwrap().status, 200);
            let backup = call("/api/backup", Some("{}".into()), csrf).await.unwrap();
            assert_eq!(backup.status, 200);
            assert!(base64::engine::general_purpose::STANDARD.decode(backup.body).unwrap().starts_with(b"SQLite format 3"));
            assert_eq!(call("/api/backup", Some("{}".into()), "bad").await.unwrap().status, 403);
            assert_eq!(call("/api/logout", Some("{}".into()), csrf).await.unwrap().status, 200);
            assert!(vault.load().unwrap().is_none());
            assert_eq!(send(&restored, origin.clone(), "/api/session".into(), None, String::new(), String::new()).await.unwrap().status, 401);
            assert!(restored.0.lock().unwrap().cookie.is_empty());
            assert_eq!(call("/api/session", None, "").await.unwrap().status, 401);
            configure(&state, "https://other.example").unwrap();
            assert!(call("/api/session", None, "").await.is_err());
        });
    }
    #[test]
    fn redirect_is_not_followed() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let thread = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0; 4096];
            stream.read(&mut buffer).unwrap();
            stream.write_all(b"HTTP/1.1 302 Found\r\nLocation: https://example.com/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        let state = Transport::default();
        configure(&state, &origin).unwrap();
        let reply = tokio::runtime::Runtime::new().unwrap().block_on(send(
            &state,
            origin,
            "/api/session".into(),
            None,
            String::new(),
            String::new(),
        ));
        assert_eq!(reply.err().unwrap(), "INVALID_RESPONSE");
        thread.join().unwrap();
    }
    #[test]
    fn login_deadline_and_retry() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let thread = std::thread::spawn(move || {
            let (mut slow, _) = listener.accept().unwrap();
            let mut buffer = [0; 4096];
            slow.read(&mut buffer).unwrap();
            // Keep the first response open until the client times out and retries.
            let (mut retry, _) = listener.accept().unwrap();
            retry.read(&mut buffer).unwrap();
            retry.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}").unwrap();
        });
        let state = Transport::default();
        configure(&state, &origin).unwrap();
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let start = std::time::Instant::now();
            let reply = send(
                &state,
                origin.clone(),
                "/api/session".into(),
                Some("{}".into()),
                String::new(),
                String::new(),
            )
            .await;
            assert_eq!(reply.err().unwrap(), "LOGIN_TIMEOUT");
            assert!(start.elapsed() >= Duration::from_secs(7));
            assert!(start.elapsed() < Duration::from_secs(11));
            assert_eq!(
                send(
                    &state,
                    origin,
                    "/api/session".into(),
                    Some("{}".into()),
                    String::new(),
                    String::new()
                )
                .await
                .unwrap()
                .status,
                401
            );
        });
        thread.join().unwrap();
    }
    #[test]
    fn origin_and_path_policy() {
        assert_eq!(
            normalize("https://example.com/").unwrap(),
            "https://example.com"
        );
        for v in [
            "http://example.com",
            "https://user:pass@example.com",
            "https://example.com/path",
            "https://example.com/?x=1",
        ] {
            assert!(normalize(v).is_err());
        }
        for p in [
            "//evil.test",
            "/api/../secret",
            "/api/%2e%2e/secret",
            "/api/session#fragment",
            "/api/session\\evil",
            "/api/unknown",
        ] {
            assert!(endpoint("https://example.com", p, true).is_err());
        }
        assert!(endpoint("https://example.com", "/api/sync?cursor=abc", false).is_ok());
        assert!(endpoint("https://example.com", "/api/backup", false).is_err());
        assert!(endpoint("https://example.com", "/api/account/sessions", false).is_ok());
        assert!(endpoint("https://example.com", "/api/account/sessions", true).is_err());
        assert!(endpoint("https://example.com", "/api/account/sessions/revoke", true).is_ok());
        assert!(endpoint("https://example.com", "/api/account/sessions/revoke", false).is_err());
    }
    #[test]
    fn switching_server_discards_cookie() {
        let state = Transport::default();
        configure(&state, "https://example.com").unwrap();
        state.0.lock().unwrap().cookie = "arc_session=private".into();
        configure(&state, "https://other.example").unwrap();
        let s = state.0.lock().unwrap();
        assert!(s.cookie.is_empty());
        assert_eq!(s.generation, 2);
    }
}
