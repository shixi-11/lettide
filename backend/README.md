# Lettide backend

The local service binds only to `127.0.0.1:47831`. It serves `../web/dist` when present. Windows stores encrypted data under `%USERPROFILE%\.lettide` with CurrentUser DPAPI (from 0.3.12; data from the former `%LOCALAPPDATA%\Lettide` is copied there once and left in place; `LETTIDE_DATA_DIR` overrides the location); macOS uses `~/Library/Application Support/Lettide` with a Keychain-backed AES-256-GCM key. Startup refuses to reset unreadable data or silently fall back to plaintext.

Run `pnpm install`, then `pnpm start`. The MCP stdio bridge is `pnpm mcp`; it starts the shared service in a hidden detached process when needed. The browser UI uses a SameSite=Strict HttpOnly cookie and same-origin checks. MCP calls authenticate with the random token inside the encrypted store. Neither the token nor provider credentials appear in tool results.

QQ and GoDaddy Professional Email accounts are retained only after IMAP and SMTP authentication checks pass. GoDaddy defaults use `imap.secureserver.net:993` and `smtpout.secureserver.net:465`, as described in [GoDaddy's IMAP setup guide](https://www.godaddy.com/en-uk/help/use-imap-settings-to-add-my-professional-email-to-a-client-32204). Gmail and Microsoft accounts use the local OAuth PKCE flow. Sync is bounded to the newest 60 inbox and sent messages per account on each request; this is polling, not push delivery.

The reading UI explicitly requests anonymous Google web translation, sending only the selected body over POST. Results are cached in the encrypted store; failures have no paid fallback. Explicit assistant/Ollama jobs remain available. MCP sending has separate prepare and confirm tools; API sends require an idempotency key, and uncertain outcomes are recorded as `outcome_unknown` to prevent automatic retries.

Tests use a temporary directory and an injected AES-GCM codec; that codec is test-only and is not a supported production storage mode.
