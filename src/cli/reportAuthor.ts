import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  json?: unknown;
  timedOut?: boolean;
}

export interface ValidationEnvelope {
  result: string;
  errorCount: number;
  warningCount: number;
  errors: string[];
  warnings: string[];
}

export class ReportAuthorCli {
  constructor(private readonly extensionPath?: string) {}

  resolvePath(): string | undefined {
    const candidates = [
      process.env.POWERBI_REPORT_AUTHOR_CLI,
      this.extensionPath ? path.join(this.extensionPath, "dist", "tools", "report-cli.mjs") : undefined,
      this.extensionPath
        ? path.join(this.extensionPath, "node_modules", "@microsoft", "powerbi-report-authoring-cli", "dist", "cli.js")
        : undefined,
      path.join(process.cwd(), "node_modules", "@microsoft", "powerbi-report-authoring-cli", "dist", "cli.js"),
      path.join(process.cwd(), "dist", "tools", "report-cli.mjs"),
    ].filter((candidate): candidate is string => Boolean(candidate));
    return candidates.find((candidate) => existsSync(candidate));
  }

  resolveBridgePath(): string | undefined {
    const candidates = [
      process.env.POWERBI_DESKTOP_BRIDGE_CLI,
      this.extensionPath ? path.join(this.extensionPath, "dist", "tools", "desktop-bridge.mjs") : undefined,
      this.extensionPath
        ? path.join(this.extensionPath, "node_modules", "@microsoft", "powerbi-desktop-bridge-cli", "dist", "cli.js")
        : undefined,
      path.join(process.cwd(), "node_modules", "@microsoft", "powerbi-desktop-bridge-cli", "dist", "cli.js"),
    ].filter((candidate): candidate is string => Boolean(candidate));
    return candidates.find((candidate) => existsSync(candidate));
  }

  private resolveRunnerPath(): string | undefined {
    const candidates = [
      this.extensionPath ? path.join(this.extensionPath, "dist", "tools", "electron-node-runner.mjs") : undefined,
      path.join(process.cwd(), "dist", "tools", "electron-node-runner.mjs"),
    ].filter((candidate): candidate is string => Boolean(candidate));
    return candidates.find((candidate) => existsSync(candidate));
  }

  async run(args: string[], cwd: string, timeoutMs = 120_000): Promise<CliResult> {
    const cliPath = this.resolvePath();
    if (!cliPath) {
      return { code: null, stdout: "", stderr: "powerbi-report-author CLI was not found.", json: undefined };
    }
    return await this.runScript(cliPath, args, cwd, timeoutMs);
  }

  private async runScript(
    scriptPath: string,
    args: string[],
    cwd: string,
    timeoutMs: number,
    extraEnv: Record<string, string> = {},
  ): Promise<CliResult> {
    return await new Promise<CliResult>((resolve) => {
      const runner = this.resolveRunnerPath();
      // In the VS Code extension host process.execPath is Electron's Code.exe.
      // Commander would otherwise treat the script path as a command because it
      // auto-detects Electron and shifts argv for a packaged app. The launcher
      // fixes that argv shape before importing the real CLI.
      const useElectronRunner = Boolean(runner && process.versions.electron);
      const commandArgs = runner && useElectronRunner ? [runner, ...args] : [scriptPath, ...args];
      const electronEnv = runner && useElectronRunner
        ? { ELECTRON_RUN_AS_NODE: "1", POWERBI_CLI_TARGET: scriptPath }
        : {};
      const child = spawn(process.execPath, commandArgs, {
        cwd,
        env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...electronEnv, ...extraEnv },
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        child.kill();
        resolve({ code: null, stdout, stderr, json: extractJson(stdout), timedOut: true });
      }, timeoutMs);
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr: `${stderr}\n${error.message}`.trim(), json: extractJson(stdout) });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr, json: extractJson(stdout) });
      });
    });
  }

  async version(cwd: string): Promise<string | undefined> {
    const result = await this.run(["--version"], cwd, 30_000);
    const text = result.stdout.trim() || result.stderr.trim();
    return text.split(/\r?\n/).find((line) => /^\d+\.\d+\.\d+/.test(line.trim()))?.trim();
  }

  async scaffold(outputDir: string, reportName: string, modelPath: string, cwd: string): Promise<CliResult> {
    return this.run(
      ["scaffold", outputDir, "--name", reportName, "--model-path", modelPath, "--offline"],
      cwd,
      120_000,
    );
  }

  async validate(reportPath: string, cwd: string): Promise<{ result: CliResult; validation?: ValidationEnvelope }> {
    const result = await this.run(["validate", reportPath, "--pretty"], cwd, 120_000);
    return { result, validation: parseValidation(result.json) };
  }

  async listPreviewHosts(cwd: string): Promise<CliResult> {
    return this.run(["preview", "--list-hosts"], cwd, 60_000);
  }

  async previewStatus(folder: string, host: "desktop" | "service", cwd: string): Promise<CliResult> {
    return this.run(["preview", folder, "--host", host, "--status"], cwd, 60_000);
  }

  async openInDesktop(pbipPath: string, cwd: string, desktopPath?: string): Promise<CliResult> {
    const bridge = this.resolveBridgePath();
    if (!bridge) {
      return { code: null, stdout: "", stderr: "Power BI Desktop bridge CLI was not found.", json: undefined };
    }
    return this.runScript(
      bridge,
      ["open", pbipPath, "--timeout", "90"],
      cwd,
      180_000,
      desktopPath ? { PBI_DESKTOP_PATH: desktopPath } : {},
    );
  }

  async previewScreenshot(
    folder: string,
    host: "desktop" | "service",
    outputDir: string,
    cwd: string,
    allPages = true,
  ): Promise<CliResult> {
    const args = ["preview", folder, "--host", host, "--screenshot", outputDir];
    if (allPages) args.push("--all-pages");
    return this.run(args, cwd, 180_000);
  }
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/).reverse();
    for (const line of lines) {
      const candidate = line.trim();
      if (!candidate.startsWith("{") && !candidate.startsWith("[")) continue;
      try {
        return JSON.parse(candidate);
      } catch {
        // continue
      }
    }
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

export function parseValidation(json: unknown): ValidationEnvelope | undefined {
  if (!json || typeof json !== "object") return undefined;
  const root = json as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;
  const errorsRaw = data.errors ?? data.error ?? [];
  const warningsRaw = data.warnings ?? data.warning ?? [];
  const errors = Array.isArray(errorsRaw)
    ? errorsRaw.map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
    : [];
  const warnings = Array.isArray(warningsRaw)
    ? warningsRaw.map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
    : [];
  return {
    result: String(data.result ?? data.status ?? "unknown"),
    errorCount: Number(data.errorCount ?? errors.length),
    warningCount: Number(data.warningCount ?? warnings.length),
    errors,
    warnings,
  };
}
