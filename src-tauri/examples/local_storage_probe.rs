// Isolated native persistence harness. No product services, session vault or transport.
#[cfg(windows)]
fn main() {
    use std::path::PathBuf;
    let args: Vec<String> = std::env::args().collect();
    assert!(
        (4..=5).contains(&args.len()),
        "bundle, script, profile and optional checkpoint mode"
    );
    let checkpoint = args.get(4).is_some_and(|mode| mode == "checkpoint");
    let script = format!(
        "{}\n{}",
        std::fs::read_to_string(&args[1]).expect("fixture bundle"),
        std::fs::read_to_string(&args[2]).expect("fixture probe")
    );
    let profile = PathBuf::from(&args[3]);
    let artifacts = std::fs::canonicalize(".artifacts").expect("test artifacts directory");
    assert_eq!(
        std::fs::canonicalize(profile.parent().expect("profile parent"))
            .expect("profile parent directory"),
        artifacts
    );
    assert!(profile
        .file_name()
        .expect("profile name")
        .to_string_lossy()
        .starts_with("local-webview2-probe-"));
    std::fs::create_dir_all(&profile).expect("isolated profile directory");
    let profile = std::fs::canonicalize(profile).expect("isolated profile");
    assert!(
        profile.starts_with(&artifacts),
        "profile must stay within test artifacts"
    );
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "app.orivane.atlas.local-storage-probe".into();
    context.config_mut().app.windows.clear();
    context.config_mut().app.security.csp = None;
    tauri::Builder::default()
        .register_uri_scheme_protocol("probe", move |context, request| {
            let url = tauri::Url::parse(&request.uri().to_string()).expect("probe URL");
            if url.path() == "/result" {
                let json = url
                    .query_pairs()
                    .find(|(key, _)| key == "json")
                    .expect("probe result")
                    .1
                    .into_owned();
                let value: serde_json::Value = serde_json::from_str(&json).expect("probe JSON");
                println!("{}", value);
                use std::io::Write;
                std::io::stdout().flush().expect("probe checkpoint output");
                if !checkpoint || value["ok"] != true {
                    context
                        .app_handle()
                        .exit(if value["ok"] == true { 0 } else { 1 });
                }
            }
            tauri::http::Response::builder()
                .header("Content-Type", "text/html")
                .body(b"<!doctype html><title>Isolated Local Storage Probe</title>".to_vec())
                .expect("probe response")
        })
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "probe",
                tauri::WebviewUrl::External("probe://localhost/index".parse()?),
            )
            .visible(false)
            .data_directory(profile)
            .initialization_script(script)
            .build()?;
            Ok(())
        })
        .run(context)
        .expect("native probe runtime");
}

#[cfg(not(windows))]
fn main() {
    panic!("This probe requires Windows WebView2; it is not a cross-platform acceptance result");
}
