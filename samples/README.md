# Samples

Generated sample projects are intentionally git-ignored.

The semantic model embeds an absolute `File.Contents("...")` path, so a sample generated on one machine will not refresh on another. Regenerate it locally from the repository root:

```bash
node node_modules/vite-node/vite-node.mjs scripts/smoke.ts
```

The sample opens in Power BI Desktop with blank visuals until the first **Refresh now**; PBIP/TMDL does not store imported data.
