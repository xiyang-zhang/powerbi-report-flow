import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  sourcemap: true,
  logLevel: "info",
  target: ["es2022"],
};

async function copyAssets() {
  const dist = path.join(root, "dist");
  await mkdir(path.join(dist, "webview"), { recursive: true });
  await cp(path.join(root, "src", "ui", "webview", "index.html"), path.join(dist, "webview", "index.html"));
  await cp(path.join(root, "src", "ui", "webview", "style.css"), path.join(dist, "webview", "style.css"));
  await cp(path.join(root, "resources", "templates"), path.join(dist, "templates"), { recursive: true }).catch(() => undefined);
  await cp(path.join(root, "resources", "tools", "electron-node-runner.mjs"), path.join(dist, "tools", "electron-node-runner.mjs"));
  const mcpSource = path.join(root, "node_modules", "@microsoft", "powerbi-modeling-mcp-win32-x64", "dist");
  if (existsSync(mcpSource)) {
    await cp(mcpSource, path.join(dist, "tools", "mcp"), { recursive: true });
  }
  const mcpPackage = path.join(root, "node_modules", "@microsoft", "powerbi-modeling-mcp-win32-x64");
  for (const file of ["LICENSE", "NOTICE.txt", "README.md"]) {
    const source = path.join(mcpPackage, file);
    if (existsSync(source)) await cp(source, path.join(dist, "tools", "mcp", file));
  }
  const cliLicense = path.join(root, "node_modules", "@microsoft", "powerbi-report-authoring-cli", "LICENSE");
  if (existsSync(cliLicense)) await cp(cliLicense, path.join(dist, "tools", "report-cli.LICENSE"));
  const bridgeLicense = path.join(root, "node_modules", "@microsoft", "powerbi-desktop-bridge-cli", "LICENSE");
  if (existsSync(bridgeLicense)) await cp(bridgeLicense, path.join(dist, "tools", "desktop-bridge.LICENSE"));
  const visualSchemaData = path.join(root, "node_modules", "@microsoft", "powerbi-core-visual-schema", "data");
  if (existsSync(visualSchemaData)) {
    await cp(visualSchemaData, path.join(dist, "data"), { recursive: true });
  }
}

const cliOptions = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node20"],
  logLevel: "info",
  entryPoints: [path.join(root, "node_modules", "@microsoft", "powerbi-report-authoring-cli", "dist", "cli.js")],
  outfile: path.join(root, "dist", "tools", "report-cli.mjs"),
  external: ["playwright"],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
};

const bridgeOptions = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node20"],
  logLevel: "info",
  entryPoints: [path.join(root, "node_modules", "@microsoft", "powerbi-desktop-bridge-cli", "dist", "cli.js")],
  outfile: path.join(root, "dist", "tools", "desktop-bridge.mjs"),
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
};

const extensionOptions = {
  ...shared,
  entryPoints: [path.join(root, "src", "extension.ts")],
  outfile: path.join(root, "dist", "extension.js"),
  platform: "node",
  format: "cjs",
  external: ["vscode", "mssql", "pg", "mysql2"],
};

const webviewOptions = {
  ...shared,
  entryPoints: [path.join(root, "src", "ui", "webview", "main.ts")],
  outfile: path.join(root, "dist", "webview", "main.js"),
  platform: "browser",
  format: "iife",
};

if (watch) {
  await rm(path.join(root, "dist"), { recursive: true, force: true });
  await copyAssets();
  const ext = await context(extensionOptions);
  const web = await context(webviewOptions);
  await Promise.all([ext.watch(), web.watch()]);
  console.log("watching...");
} else {
  await rm(path.join(root, "dist"), { recursive: true, force: true });
  await Promise.all([build(extensionOptions), build(webviewOptions), build(cliOptions), build(bridgeOptions)]);
  await copyAssets();
  console.log("build complete");
}
