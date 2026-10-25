# Security

## Reporting a vulnerability

Do not open a public issue for a security problem. Contact the repository owner
privately with:

- affected version/commit,
- a minimal reproduction,
- impact and any known mitigation.

Please allow time for a fix before public disclosure.

## Trust boundaries

- **VS Code extension host** runs local code and spawns bundled tools.
- **Power BI Authoring MCP** is a local stdio process. It is started only after
  the user sets `powerbiFlow.mcp.eulaAccepted`; its audit log is written under
  extension global storage.
- **Power BI Desktop** is an optional local renderer. The extension asks the
  report CLI to open a PBIP and capture a screenshot.
- **LLM provider** is optional. In text/existing modes, the design brief and
  profile/schema are sent to the configured provider. In image mode, the
  selected image is sent. With Copilot, requests go through VS Code's language
  model API.
- **Database connectors** run inside the extension host for profiling; passwords
  are used in memory and are not persisted to PBIP.

## Secret handling

- API keys are stored in VS Code SecretStorage, not in `settings.json`.
- Database credentials are entered per build/profile and are not written to
  generated files.
- Logs are sanitized for obvious credentials and connection strings.
- The repository ignores `.env`, key material, `tmp/`, `dist/`, generated
  samples, and VSIX artifacts.

## Before publishing

Run:

```bash
pnpm privacy:check
pnpm typecheck
pnpm test
pnpm build
```

`pnpm privacy:check` scans tracked text files for private-key blocks, common
token prefixes, likely `api_key`/`password` assignments, and absolute Windows
user paths. It is a guardrail, not a replacement for human review.

## Supported versions

Security fixes target the latest released version. The bundled Power BI CLI,
MCP executable, and skill retain their upstream licenses and security posture.
