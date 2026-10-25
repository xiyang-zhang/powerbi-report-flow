import path from "node:path";
import { readdir } from "node:fs/promises";
import type { ReportAuthorCli, ValidationEnvelope } from "../cli/reportAuthor";
import type { ReportSpec } from "../core/types";
import { findPowerBiDesktop } from "../flow/dependencies";

export interface ValidationResult {
  reportDir: string;
  result: string;
  errors: string[];
  warnings: string[];
  raw?: unknown;
}

export async function validateReport(
  cli: ReportAuthorCli,
  projectRoot: string,
  reportName: string,
): Promise<ValidationResult> {
  const reportDir = path.join(projectRoot, `${reportName}.Report`);
  const { result, validation } = await cli.validate(reportDir, projectRoot);
  const envelope = validation ?? fallbackEnvelope(result.stdout, result.stderr, result.code);
  return {
    reportDir,
    result: envelope.result,
    errors: envelope.errors,
    warnings: envelope.warnings,
    raw: result.json,
  };
}

function fallbackEnvelope(stdout: string, stderr: string, code: number | null): ValidationEnvelope {
  const text = `${stdout}\n${stderr}`.trim();
  return {
    result: code === 0 ? "succeeded" : "failed",
    errorCount: code === 0 ? 0 : 1,
    warningCount: 0,
    errors: code === 0 ? [] : [text || "Validation failed without output."],
    warnings: [],
  };
}

export interface PreviewResult {
  host: "desktop" | "service" | "none";
  status: string;
  screenshots: string[];
  errors: string[];
  warnings: string[];
  blockedReason?: string;
}

export async function previewReport(
  cli: ReportAuthorCli,
  projectRoot: string,
  reportName: string,
  screenshotsDir: string,
  preference: "auto" | "desktop" | "none",
): Promise<PreviewResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (preference === "none") {
    return { host: "none", status: "disabled", screenshots: [], errors, warnings, blockedReason: "Preview is disabled by configuration." };
  }
  const hosts = await cli.listPreviewHosts(projectRoot);
  if (hosts.code !== 0) {
    warnings.push(hosts.stderr.trim() || "The preview host list could not be read.");
  }
  const cliDesktopAvailable = desktopHostAvailable(hosts.json);
  const desktopPath = findPowerBiDesktop();
  if (hosts.code !== 0 && !desktopPath) {
    return {
      host: "none",
      status: "blocked",
      screenshots: [],
      errors,
      warnings,
      blockedReason: `Preview host discovery failed and Power BI Desktop could not be located. ${hosts.stderr.trim() || ""}`.trim(),
    };
  }
  if (cliDesktopAvailable === false && !desktopPath) {
    return {
      host: "none",
      status: "blocked",
      screenshots: [],
      errors,
      warnings,
      blockedReason:
        "Power BI Desktop was not found by the preview host probe. Install the Desktop app (Microsoft Store or direct download) and try again.",
    };
  }
  let status = await cli.previewStatus(path.join(projectRoot, `${reportName}.Report`), "desktop", projectRoot);
  if (status.code !== 0 && !isHostUnavailable(status.json)) {
    return {
      host: "desktop",
      status: "blocked",
      screenshots: [],
      errors: [status.stderr.trim() || "Preview status failed."],
      warnings,
      blockedReason: "Power BI Desktop preview status failed.",
    };
  }
  const reportOpen = reportFolderIsOpen(status.json, path.join(projectRoot, `${reportName}.Report`));
  if (status.code !== 0 || reportOpen === false) {
    const pbipPath = path.join(projectRoot, `${reportName}.pbip`);
    const opened = await cli.openInDesktop(pbipPath, projectRoot, desktopPath);
    if (opened.code !== 0) {
      return {
        host: "desktop",
        status: "blocked",
        screenshots: [],
        errors: [opened.stderr.trim() || opened.stdout.trim() || "Power BI Desktop could not open the report."],
        warnings,
        blockedReason: `Power BI Desktop is installed but the report could not be opened: ${opened.stderr.trim() || opened.stdout.trim() || "unknown error"}`,
      };
    }
    status = await waitForReportStatus(cli, projectRoot, reportName, 30_000);
    if (status.code !== 0) {
      return {
        host: "desktop",
        status: "blocked",
        screenshots: [],
        errors: [status.stderr.trim() || status.stdout.trim() || "Preview status failed after opening the report."],
        warnings,
        blockedReason: "Power BI Desktop opened the report, but the preview status could not be read.",
      };
    }
  }
  if (hasUnsavedChanges(status.json)) {
    warnings.push(
      "Power BI Desktop has unsaved changes; the screenshot captures the current window as rendered, not necessarily the PBIR files on disk.",
    );
  }
  const screenshot = await cli.previewScreenshot(path.join(projectRoot, `${reportName}.Report`), "desktop", screenshotsDir, projectRoot, true);
  if (screenshot.code !== 0) {
    errors.push(screenshot.stderr.trim() || "Screenshot capture failed.");
  }
  let screenshots: string[] = [];
  if (screenshot.code === 0) {
    try {
      screenshots = (await readdir(screenshotsDir))
        .filter((file) => file.toLowerCase().endsWith(".png"))
        .map((file) => path.join(screenshotsDir, file));
    } catch {
      screenshots = [screenshotsDir];
    }
  }
  return {
    host: "desktop",
    status: screenshot.code === 0 ? "screenshots-captured" : "blocked",
    screenshots,
    errors,
    warnings,
    blockedReason: screenshot.code === 0 ? undefined : "Screenshots could not be captured.",
  };
}

function hasUnsavedChanges(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasUnsavedChanges);
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/hasUnsavedChanges/i.test(key) && nested === true) return true;
    if (typeof nested === "object" && hasUnsavedChanges(nested)) return true;
  }
  return false;
}

export function desktopHostAvailable(value: unknown): boolean | undefined {
  if (!value || typeof value !== "object") return undefined;
  const hosts = (value as { data?: { hosts?: unknown } }).data?.hosts;
  if (!Array.isArray(hosts)) return undefined;
  const desktop = hosts.find(
    (host): host is { host?: string; available?: boolean } =>
      Boolean(host) && typeof host === "object" && (host as { host?: string }).host === "desktop",
  );
  return desktop ? Boolean(desktop.available) : false;
}

export function reportFolderIsOpen(value: unknown, reportDir: string): boolean | undefined {
  if (!value || typeof value !== "object") return undefined;
  const reports = (value as { data?: { reports?: unknown } }).data?.reports;
  if (!Array.isArray(reports)) return undefined;
  const normalized = path.resolve(reportDir).toLowerCase();
  return reports.some((report) => {
    if (!report || typeof report !== "object") return false;
    const folder = (report as { folder?: unknown }).folder;
    return typeof folder === "string" && path.resolve(folder).toLowerCase() === normalized;
  });
}

export function isHostUnavailable(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const error = (value as { error?: { code?: unknown } }).error;
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "HOST_UNAVAILABLE");
}

async function waitForReportStatus(
  cli: ReportAuthorCli,
  projectRoot: string,
  reportName: string,
  timeoutMs: number,
): Promise<Awaited<ReturnType<ReportAuthorCli["previewStatus"]>>> {
  const reportDir = path.join(projectRoot, `${reportName}.Report`);
  const deadline = Date.now() + timeoutMs;
  let last = await cli.previewStatus(reportDir, "desktop", projectRoot);
  while (Date.now() < deadline) {
    if (last.code === 0 && reportFolderIsOpen(last.json, reportDir) !== false) return last;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    last = await cli.previewStatus(reportDir, "desktop", projectRoot);
  }
  return last;
}

export function specErrorsToMessages(spec: ReportSpec, errors: string[]): string[] {
  return errors.map((error) => `[${spec.title}] ${error}`);
}
