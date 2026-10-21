#[cfg(windows)]
#[path = "../src/notifications.rs"]
mod notifications;

fn main() {
    #[cfg(windows)]
    match notifications::presentation_probe() {
        Ok(result) => println!("{result}"),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
