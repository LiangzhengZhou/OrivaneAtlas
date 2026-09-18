fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "check_app_update",
            "install_app_update",
            "configure_server",
            "saved_accounts",
            "select_account",
            "forget_account",
            "detach_account",
            "server_request",
        ]),
    ))
    .expect("Tauri build failed");
    // Tauri links its Common Controls v6 manifest only into application binaries.
    // Opt in when running GNU Windows lib tests that also import GUI dependencies.
    println!("cargo:rerun-if-env-changed=ATLAS_NATIVE_TEST_MANIFEST");
    if std::env::var_os("ATLAS_NATIVE_TEST_MANIFEST").is_some()
        && std::env::var("TARGET").unwrap_or_default() == "x86_64-pc-windows-gnu"
    {
        println!("cargo:rustc-link-arg={}/libresource.a", std::env::var("OUT_DIR").unwrap());
    }
}
