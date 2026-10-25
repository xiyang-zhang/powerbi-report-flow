# Setup

## 1. Prerequisites

- VS Code 1.100+.
- Node.js 20+ (the repo was built with Node 24).
- pnpm 9+ (this repository uses `node-linker=hoisted`).
- Optional: Power BI Desktop for rendered preview and screenshots.
- Optional: GitHub Copilot Chat, or an OpenAI-compatible API key.

## 2. Install dependencies

```bash
pnpm install
```

The extension resolves two tools at runtime, preferring the bundled copies:

- `dist/tools/report-cli.mjs` (the `powerbi-report-author` CLI; `node_modules` is a development fallback).
- `dist/tools/mcp/powerbi-modeling-mcp.exe` (the local Power BI Authoring MCP; `node_modules` is a development fallback).

The MCP server writes an audit log; the extension points it at
`context.globalStorageUri/mcp-audit`.

## 3. Build and run

```bash
pnpm typecheck
pnpm test
pnpm build
```

Open this folder in VS Code and press **F5**. In the Extension Development Host,
open the **Power BI Report Flow** Activity Bar view.

### Install a locally built VSIX

```bash
pnpm build
pnpm package
code --install-extension powerbi-report-flow-0.2.0.vsix
```

Reload VS Code and open the **Power BI Report Flow** view. This is the
recommended local/offline deployment; it does not require the Marketplace.

### Strata local LLM runtime

[Strata](https://github.com/Niko1221/Strata) is an optional, open-source local
LLM app/inference engine. It is **not** a SQL Server, PostgreSQL, or MySQL
endpoint. Start a model in Strata and run `strata connect` to get its local
OpenAI-compatible base URL, then set:

- `powerbiFlow.llm.provider` = `openai`
- `powerbiFlow.llm.baseUrl` = the URL printed by `strata connect` (usually a
  localhost URL ending in `/v1`)
- `powerbiFlow.llm.model` = the model name shown by Strata

If Strata requires a token, store it with **Power BI: Set OpenAI-compatible API
Key**. No Strata endpoint, model path, or credential is stored in the repository.
Image mode accepts multiple images and needs a Strata model that accepts image input.

External data mode is separate: use SQL Server, PostgreSQL, or MySQL profiling
with an operator-provided database endpoint. Fabric workspace authoring is not
wired into the UI yet; use Power BI Desktop/PBIP directly for Fabric-hosted
models.

## 4. LLM provider

### GitHub Copilot (default)

Install GitHub Copilot Chat and sign in. The extension uses the VS Code Language
Model API (`vscode.lm`) and selects the first available Copilot model, or the
model id configured in `powerbiFlow.llm.model`.

### OpenAI-compatible

1. Set `powerbiFlow.llm.provider` to `openai`.
2. Set `powerbiFlow.llm.baseUrl` (for example `https://api.openai.com/v1`).
3. Set `powerbiFlow.llm.model`.
4. Run **Power BI: Set OpenAI-compatible API Key**.

The key is stored in VS Code SecretStorage.

## 5. MCP EULA

The Power BI Authoring MCP requires EULA acceptance. Review the EULA link in the
package, then set `powerbiFlow.mcp.eulaAccepted` to `true`. The extension starts
the server with `--accepteula` for the current process only and passes a writable
audit-log directory.

## 6. First report

1. Choose **Mock** data mode.
2. Keep or edit the schema JSON and click **Apply schema**.
3. Choose **Text** report mode, set **Pages** (1–8), and describe the report.
4. Optionally click **Choose document(s)…** to attach text/Markdown/CSV/DOCX/images for LLM context.
5. Optionally paste per-page **Page backgrounds** YAML, for example:

   ```yaml
   overview:
     image: assets/overview-bg.png
     scaling: Fill
   breakdown:
     color: "#0B1F33"
   ```

   Relative image paths resolve from the generated project root. Images are copied into PBIR `RegisteredResources`.
6. Click **Generate spec**, review `_brief/report-spec.md`.
7. Click **Approve & build**.
8. Click **Validate**.
9. If Power BI Desktop is installed, click **Preview / screenshots**.

For image mode, choose one or more screenshots; each distinct image can become a page. The configured vision model receives all selected images.

## 7. Troubleshooting

- **`spawn EPERM` in a sandboxed environment**: esbuild, Vitest, and MCP stdio
  need child-process pipes. Run the build/test commands outside the restricted
  sandbox.
- **MCP exits immediately**: ensure the audit-log directory is writable. The
  extension creates it automatically; when running the server manually, pass
  `--audit-log-path=<writable-dir>`.
- **MCP cannot load the model**: check the TMDL error in the extension log. A
  common cause is an unsupported TMDL property in a measure or column.
- **Preview blocked**: install Power BI Desktop. Structural validation does not
  require it, but rendered screenshots do. Both the classic installer and the
  Microsoft Store/MSIX build are detected; the extension uses
  `preview --list-hosts` first, then opens the `.pbip` through the desktop bridge
  when no Desktop instance has the report open.
- **`unknown command ...report-cli.mjs` / preview says CLI failed**: this was
  a 0.1.1 Electron argv issue. Install 0.1.2 or later; it launches the bundled
  CLI through `dist/tools/electron-node-runner.mjs` inside the extension host.
- **Several Desktop instances hold the same report**: close the extra windows.
  The CLI refuses to guess which instance to screenshot when multiple windows
  have the same report folder open.
- **The sample opens with blank visuals**: PBIP/TMDL does not store imported
  data. Open `samples/SalesOverview/SalesOverview.pbip` and click **Refresh now**
  once; the CSV partition then loads. Regenerate the sample locally if its
  absolute CSV path came from another machine.
- **Dimension tables**: auto dimensions use M-query `Table.Distinct` partitions
  and are on by default (`powerbiFlow.model.autoDimensions`). They are not DAX
  calculated tables: Power BI Desktop 2.159 cannot reopen a PBIP whose
  relationship targets a calculated table.
- **`isKey` / Refresh failure**: generated TMDL never contains `isKey`.
  Power BI Desktop has no general primary-key concept and Refresh fails with
  `Non-null assertion failure: query` when a column carries it. A post-build
  check strips any leftover declaration from `SemanticModel/definition/**/*.tmdl`.
- **Blank sample after cloning**: the sample is git-ignored and generated
  locally because TMDL embeds an absolute `File.Contents` path. Regenerate with
  `node node_modules/vite-node/vite-node.mjs scripts/smoke.ts`, then click
  **Refresh now** in Desktop.
