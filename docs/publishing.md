# Publishing checklist

This repository is prepared for a local-first release. No remote, host, or
credentials are configured.

## 1. Verify the build

```bash
pnpm typecheck
pnpm test
pnpm privacy:check
pnpm build
```

Expected: typecheck clean; 11 test files / 28 tests pass; privacy-check OK.

Regenerate and validate the sample after model changes:

```bash
node node_modules/vite-node/vite-node.mjs scripts/smoke.ts
node dist/tools/report-cli.mjs validate samples/SalesOverview/SalesOverview.Report --pretty
```

The sample is git-ignored because TMDL embeds an absolute path. Do not force-add
it.

## 2. Inspect the staged tree

```bash
git status --short
git diff --cached --stat
git ls-files | rg -n "vsix|node_modules|^dist/|^tmp/|\.env$"
```

The last command should produce no output. `samples/README.md` is the only
tracked file under `samples/`.

## 3. Privacy and security checks

- `pnpm privacy:check` must pass.
- Confirm no API keys, database passwords, connection strings, personal paths,
  Strata model paths, or LLM/database endpoint identifiers are committed.
- Confirm `.vscode/settings.json` is not tracked if it contains local paths.
- Review `SECURITY.md` and `PRIVACY.md`.

## 4. Commit and tag

Git identity is not set in this checkout. Configure it locally before the first
commit (or amend later):

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
git add -A
git commit -m "Power BI Report Flow 0.1.0"
git tag v0.1.0
```

## 5. Add your remote

```bash
git remote add origin <your-repo-url>
git branch -M main
git push -u origin main
git push origin v0.1.0
```

The extension VSIX is not committed. If you publish it, attach
`powerbi-report-flow-0.1.0.vsix` to a GitHub Release rather than committing the
binary.

## 6. Version bumping

Update `package.json` `version`, rebuild/repackage, and update install examples
in `README.md` and `docs/setup.md`. Tag the same version (`vX.Y.Z`).
