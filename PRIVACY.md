# Privacy

Power BI Report Flow is local-first. It has no analytics, telemetry, crash
reporting, or advertising endpoint, and it does not create a user account.

## What stays local

- Data profiling: local files and database rows are read on the machine running
  VS Code. Profiles and generated CSVs are written under the workspace output
  folder.
- Generated projects: PBIP/PBIR/TMDL, briefs, validation results, and logs are
  written under the workspace (and MCP audit logs under VS Code global storage).
- API keys: stored in VS Code SecretStorage. They are not written to project
  files or logs.
- Database passwords: used in memory for a profiling request; not persisted in
  PBIP.

## What can leave the machine

Only when you configure an LLM provider and use an LLM-assisted mode:

- **Text mode** sends the report description, the canonical design brief, and
  column/table profile information (names, types, sample values) to the
  configured provider.
- **Existing-report mode** adds the extracted report profile (page/visual
  geometry, titles, theme colors).
- **Image mode** sends the selected image.
- **Repair** may send validation errors plus the generated spec.

With **Copilot**, requests go through VS Code's language model API under your
GitHub/Microsoft terms. With **OpenAI-compatible**, requests go to the
`powerbiFlow.llm.baseUrl` you configure. Use an approved local or enterprise
endpoint for sensitive data, and review the provider's retention policy.

No data is sent to the extension author.

## Generated artifacts

PBIP/TMDL can contain server names, file paths, table/column names, and data
samples. Treat generated projects as sensitive as the source data. Review them
before committing to a public repository or sharing a `.pbip`/`.vsix`.

## Children and tracking

The extension is a developer tool, is not directed at children, and does not
track usage.
