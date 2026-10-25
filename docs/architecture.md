# Architecture

```
VS Code sidebar webview
        │ postMessage
        ▼
FlowController
  ├─ profileFlowData ──► DataProfile
  ├─ generateReportSpec ──► ReportSpec + design-brief.yaml
  ├─ approval gate ──► approved.json (SHA-256 of the contract)
  ├─ buildModel ──► TMDL files
  ├─ buildReport ──► PBIR pages/visuals
  ├─ validateReport ──► powerbi-report-author validate
  ├─ PowerBiMcpBridge ──► MCP ConnectFolder + model verification
  └─ previewReport ──► Desktop status/screenshots
```

## Why deterministic generation

The LLM is used for structured design work (canonical design contract, image
layout extraction, DAX proposals), while TypeScript builders write TMDL and PBIR.
This avoids the most common failure mode of agent-authored PBIR: plausible but
invalid JSON. The `powerbi-report-author` CLI is the source of truth for visual
roles, formatting properties, and schema versions.

## Data layer

- `src/data/localFiles.ts`: CSV/TSV/XLSX/JSON parsing and type inference.
- `src/data/mock.ts`: seeded PRNG and CSV generation.
- `src/data/externalDb.ts`: SQL Server/PostgreSQL/MySQL profiling.
- `src/data/infer.ts`: column profiling, basic measures, relationship inference.
- `src/data/documents.ts`: attached text/Markdown/CSV/DOCX/image context for LLM-assisted design.

## Model builder

`src/model/tmdl.ts` writes:

```
<Name>.SemanticModel/
├─ .platform
├─ definition.pbism
└─ definition/
   ├─ database.tmdl
   ├─ model.tmdl
   ├─ relationships.tmdl
   ├─ expressions.tmdl
   └─ tables/<Table>.tmdl
```

CSV partitions use `Csv.Document(File.Contents(...))`; SQL partitions use the
`Sql.Database`, `PostgreSQL.Database`, or `MySQL.Database` connectors.

### Desktop compatibility invariants

These are enforced in `src/model/tmdl.ts` and covered by `test/tmdl.test.ts`:

- Every `.tmdl` file is written with CRLF line endings. LF-only files make
  Power BI Desktop open a blank `Untitled` window.
- `defaultPowerBIDataSourceVersion: powerBI_V3` is written in `model.tmdl`.
- `isKey` is never emitted. A post-build `enforceNoIsKey()` pass removes any
  stray declaration from `definition/**/*.tmdl`; a column marked as a key makes
  Refresh fail with `Non-null assertion failure: query`.
- Auto dimensions use M-query `Table.Distinct` partitions. DAX calculated
  dimension tables were removed because Desktop 2.159 cannot reopen a PBIP
  whose relationship targets a calculated table.
- M string literals for CSV paths use single backslashes.

The MCP `connection_operations` tool is called with `ConnectFolder` to load the
generated TMDL and return table/measure/relationship counts. This catches TMDL
format errors that PBIR validation cannot see.

## Report builder

`src/report/pbir.ts` writes:

```
<Name>.Report/
├─ .platform
├─ definition.pbir
├─ definition/version.json
├─ definition/report.json
├─ StaticResources/RegisteredResources/   (optional background images)
└─ definition/pages/
   ├─ pages.json
   └─ <page>/
      ├─ page.json
      └─ visuals/<id>/visual.json
```

Each placement is converted from the 12-column layout contract to pixel
coordinates by `src/report/layout.ts`. Visual templates and field-role mapping
live in `src/report/visuals.ts` and `src/report/visualCatalog.ts`; unknown kinds
are kept as their requested `visualType` instead of being silently converted to
textboxes. `PageSpec.background` accepts a color or an image object. Background
images are copied into `StaticResources/RegisteredResources` and registered in
`definition/report.json` under `resourcePackages`, so the page JSON can reference
them with `ResourcePackageItem`.

Text mode's page count is clamped to 1–8; if the LLM returns fewer pages, the
generator appends deterministic pages. Image mode can build one page per input
image. Page backgrounds can be supplied as YAML/text through
`applyBackgroundDeclarations()` and are merged before the report is written.

## Approval and safety

- Profiling/spec stages write only `_brief/`.
- `approved.json` stores the contract hash; the build records it in
  `build-manifest.json`.
- Database passwords and API keys live in VS Code SecretStorage, never in PBIP.
- Logs redact obvious secrets.
- The MCP audit log directory is created under extension global storage.
