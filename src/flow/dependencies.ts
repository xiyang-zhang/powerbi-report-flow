import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { DependencyStatus } from "../core/types";
import type { ReportAuthorCli } from "../cli/reportAuthor";
import { PowerBiMcpBridge } from "../mcp/client";

const LOCAL_APPDATA = process.env.LOCALAPPDATA ?? "";
const DESKTOP_CANDIDATES = [
  "C:\\Program Files\\Microsoft Power BI Desktop\\bin\\PBIDesktop.exe",
  "C:\\Program Files (x86)\\Microsoft Power BI Desktop\\bin\\PBIDesktop.exe",
  "C:\\Program Files\\Microsoft Power BI Desktop\\PBIDesktop.exe",
  "C:\\Program Files (x86)\\Microsoft Power BI Desktop\\PBIDesktop.exe",
  LOCAL_APPDATA ? path.join(LOCAL_APPDATA, "Microsoft", "WindowsApps", "PBIDesktopStore.exe") : "",
  LOCAL_APPDATA ? path.join(LOCAL_APPDATA, "Microsoft", "WindowsApps", "PBIDesktop.exe") : "",
  LOCAL_APPDATA ? path.join(LOCAL_APPDATA, "Microsoft", "Power BI Desktop", "bin", "PBIDesktop.exe") : "",
].filter((candidate): candidate is string => Boolean(candidate));

let cachedDesktop: string | null | undefined;

function findStoreDesktop(): string | undefined {
  if (process.platform !== "win32") return undefined;
  try {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-AppxPackage Microsoft.MicrosoftPowerBIDesktop | Sort-Object Version -Descending | Select-Object -First 1).InstallLocation",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 8_000 },
    ).trim();
    if (!output) return undefined;
    const executable = path.join(output, "bin", "PBIDesktop.exe");
    return existsSync(executable) ? executable : undefined;
  } catch {
    return undefined;
  }
}

export function findPowerBiDesktop(): string | undefined {
  if (cachedDesktop !== undefined) {
    // Microsoft Store updates replace the versioned WindowsApps folder. Drop a
    // cached path that no longer exists so the next lookup can rediscover it.
    if (cachedDesktop === null || existsSync(cachedDesktop)) return cachedDesktop ?? undefined;
    cachedDesktop = undefined;
  }
  const direct = DESKTOP_CANDIDATES.find((candidate) => existsSync(candidate));
  const found = direct ?? findStoreDesktop();
  cachedDesktop = found ?? null;
  return found;
}

export function resetPowerBiDesktopCache(): void {
  cachedDesktop = undefined;
}

export function findAzureCli(): string | undefined {
  const candidates = [
    "C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd",
    "C:\\Program Files (x86)\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd",
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

export async function checkDependencies(
  cli: ReportAuthorCli,
  mcp: PowerBiMcpBridge,
  extensionPath: string,
  vscodeVersion: string,
  acceptEula: boolean,
): Promise<DependencyStatus> {
  const cliPath = cli.resolvePath();
  const cliVersion = cliPath ? await cli.version(extensionPath) : undefined;
  const mcpPath = mcp.resolvePath();
  const desktop = findPowerBiDesktop();
  const az = findAzureCli();
  const warnings: string[] = [];

  if (!cliPath) warnings.push("powerbi-report-author CLI was not found. Run pnpm install in the extension folder.");
  if (!mcpPath) warnings.push("Power BI Authoring MCP package was not found. Run pnpm install.");
  if (!desktop) warnings.push("Power BI Desktop was not found. Validation works, but rendered preview and screenshots will be blocked.");
  if (!az) warnings.push("Azure CLI was not found. Fabric publishing is unavailable (publishing is not part of this release).");
  if (mcpPath && !acceptEula) warnings.push("MCP EULA has not been accepted; the MCP bridge will not start.");

  return {
    node: process.version,
    vscode: vscodeVersion,
    reportCli: { found: Boolean(cliPath), path: cliPath, version: cliVersion },
    mcp: { found: Boolean(mcpPath), path: mcpPath },
    desktop: { found: Boolean(desktop), path: desktop },
    az: { found: Boolean(az), path: az },
    warnings,
  };
}
