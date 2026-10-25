// VS Code's extension host runs on Electron. Its Code.exe can execute a Node
// script when ELECTRON_RUN_AS_NODE=1, but Commander detects Electron from
// process.versions.electron and then shifts argv as if this were a packaged app,
// leaving the script path as the first user argument ("unknown command ...").
//
// This tiny launcher runs before the real CLI, forces the argv layout Commander
// expects for a default Electron app, and imports the actual entry point.
process.defaultApp = true;

const target = process.env.POWERBI_CLI_TARGET;
if (!target) {
  console.error("POWERBI_CLI_TARGET is not set");
  process.exit(2);
}

process.argv[1] = target;

const { pathToFileURL } = await import("node:url");
await import(pathToFileURL(target).href);
