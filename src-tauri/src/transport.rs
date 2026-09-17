use base64::Engine;
use reqwest::{Client, Url};
use serde::Serialize;
use std::{sync::Mutex, time::Duration};

#[derive(Default)]
struct Session {
    origin: String,
    cookie: String,
    generation: u64,
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
    let first = current.origin.is_empty();
    current.cookie.clear();
    current.generation += 1;
    if let Some(vault) = &state.1 {
        if first {
            if let Some(saved) = vault.load()? {
                if saved.origin == origin && valid_cookie(&saved.cookie) {
                    current.cookie = saved.cookie;
                } else {
                    vault.clear()?;
                }
            }
        } else {
            vault.clear()?;
        }
    }
    current.origin = origin;
    Ok(())
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
        let cookie = current.cookie.clone();
        if path == "/api/logout" && payload.is_some() {
            current.cookie.clear();
            current.generation += 1;
            if let Some(vault) = &state.1 {
                vault.clear()?;
            }
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
    if let Some(cookie) = new_cookie {
        current.cookie = cookie;
        current.generation += 1;
        if let Some(vault) = &state.1 {
            if valid_cookie(&current.cookie) {
                vault.save(&crate::session_store::SavedSession {
                    origin: current.origin.clone(),
                    cookie: current.cookie.clone(),
                })?;
            } else {
                vault.clear()?;
            }
        }
    }
    if status == 401 || (path == "/api/logout" && status < 300) {
        current.cookie.clear();
        current.generation += 1;
        if let Some(vault) = &state.1 {
            vault.clear()?;
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
    #[test]
    fn restore_is_origin_bound_and_switch_forgets() {
        let vault = MemoryVault::default();
        let cookie = format!("arc_session={}", "b".repeat(64));
        vault
            .save(&SavedSession {
                origin: "https://one.example".into(),
                cookie: cookie.clone(),
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
        assert!(vault.load().unwrap().is_none());
        vault
            .save(&SavedSession {
                origin: "https://one.example".into(),
                cookie,
            })
            .unwrap();
        let mismatched = Transport::with_vault(vault.clone());
        configure(&mismatched, "https://two.example").unwrap();
        assert!(vault.load().unwrap().is_none());
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
