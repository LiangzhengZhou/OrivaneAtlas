# ADR 0020 — Seven-day login sessions

Accepted 2026-09-16 at the user's request. Supersedes the eight-hour expiry described in ADR0019.

Host issues sessions with a fixed seven-day absolute lifetime (604800 seconds), shared by the server expiry and cookie Max-Age. Requests do not slide or extend the deadline. Expiry is exclusive: at the deadline the session is unauthorized. Existing Origin, CSRF, HttpOnly, SameSite, HTTPS Secure and account-version/revocation checks remain unchanged.

This deliberately increases the lifetime of a stolen session; OS-protected native storage remains required. No passwords are persisted. Sessions remain in process memory: a server restart invalidates them, and this is not a guarantee of seven days across restarts. No database migration, refresh token, API credential lifetime change, or new account-switch UI is included. Existing clients need no rebuild; the updated Host must be deployed and users sign in again to receive the new lifetime.
