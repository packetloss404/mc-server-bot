# Backlog

## Portfolio audit backlog — 2026-07-17
_Findings from a 2026-07-17 code audit, preserved for later._

### Later / deferred
- **[low/M]** Plaintext secret persistence (BYO LLM provider API keys)
  - Fix: data/llm-settings.json stores provider apiKeys in plaintext (LLMSettings.ts:384) — but already written mode 0o600 and masked in all API responses (LLMSettings.ts:100). Single-user self-hosted bot where any encryption key would live on the same box, so at-rest encryption is marginal. Optional: add passphrase/OS-keychain wrapping of the apiKey fields if ever multi-tenant.

### Known limitations (deliberate — not planned)
- No Dockerfile
- No migration framework
- REPO_REVIEW.md still dated 2026-06-17
