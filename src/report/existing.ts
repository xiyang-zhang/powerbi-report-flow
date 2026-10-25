import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface ReferenceVisual {
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
}

export interface ReferencePage {
  name: string;
  displayName: string;
  width?: number;
  height?: number;
  visuals: ReferenceVisual[];
}

export interface ReferenceProfile {
  source: string;
  reportName: string;
  baseTheme?: string;
  dataColors: string[];
  pages: ReferencePage[];
  warnings: string[];
}

async function resolveReportDir(input: string): Promise<string> {
  const statCandidate = input.trim();
  if (!existsSync(statCandidate)) throw new Error(`Reference path does not exist: ${input}`);
  if (statCandidate.toLowerCase().endsWith(".pbip")) {
    const pbip = JSON.parse(await readFile(statCandidate, "utf8")) as { artifacts?: Array<{ report?: { path?: string } }> };
    const reportPath = pbip.artifacts?.find((artifact) => artifact.report?.path)?.report?.path;
    if (!reportPath) throw new Error("The PBIP file has no report artifact.");
    return path.resolve(path.dirname(statCandidate), reportPath);
  }
  if (statCandidate.toLowerCase().endsWith(".report")) return statCandidate;
  const nested = path.join(statCandidate, "definition.pbir");
  if (existsSync(nested)) return statCandidate;
  throw new Error("Select a PBIR .Report folder (with definition/ and definition.pbir) or a .pbip file.");
}

async function readJsonIfExists<T>(file: string): Promise<T | undefined> {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function extractText(visual: Record<string, unknown>): string | undefined {
  const visualRoot = (visual.visual ?? {}) as Record<string, unknown>;
  const objects = (visualRoot.objects ?? {}) as Record<string, unknown>;
  const general = objects.general as Array<{ properties?: { paragraphs?: Array<{ textRuns?: Array<{ value?: unknown }> }> } }> | undefined;
  const runs = general?.[0]?.properties?.paragraphs?.[0]?.textRuns ?? [];
  const text = runs.map((run) => (typeof run.value === "string" ? run.value : "")).join("").trim();
  return text.length > 0 ? text : undefined;
}

async function readVisuals(pageDir: string): Promise<ReferenceVisual[]> {
  const visualsRoot = path.join(pageDir, "visuals");
  if (!existsSync(visualsRoot)) return [];
  const entries = await readdir(visualsRoot, { withFileTypes: true });
  const visuals: ReferenceVisual[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const visual = await readJsonIfExists<Record<string, unknown>>(path.join(visualsRoot, entry.name, "visual.json"));
    if (!visual) continue;
    const visualRoot = (visual.visual ?? {}) as Record<string, unknown>;
    const position = (visual.position ?? {}) as Record<string, number>;
    visuals.push({
      type: String(visualRoot.visualType ?? "unknown"),
      x: position.x,
      y: position.y,
      width: position.width,
      height: position.height,
      text: extractText(visual),
    });
  }
  return visuals;
}

export async function extractReferenceProfile(input: string): Promise<ReferenceProfile> {
  const reportDir = await resolveReportDir(input);
  const warnings: string[] = [];
  const reportJson = await readJsonIfExists<Record<string, unknown>>(path.join(reportDir, "definition", "report.json"));
  const themeCollection = (reportJson?.themeCollection ?? {}) as Record<string, unknown>;
  const baseTheme = (themeCollection.baseTheme ?? {}) as Record<string, unknown>;
  const pagesJson = await readJsonIfExists<Record<string, unknown>>(path.join(reportDir, "definition", "pages", "pages.json"));
  const pageOrder = Array.isArray(pagesJson?.pageOrder) ? (pagesJson?.pageOrder as string[]) : [];
  const pages: ReferencePage[] = [];

  for (const pageName of pageOrder) {
    const pageDir = path.join(reportDir, "definition", "pages", pageName);
    const pageJson = await readJsonIfExists<Record<string, unknown>>(path.join(pageDir, "page.json"));
    if (!pageJson) continue;
    const visuals = await readVisuals(pageDir);
    if (visuals.length === 0) warnings.push(`Page ${pageName} has no visuals.`);
    pages.push({
      name: pageName,
      displayName: String(pageJson.displayName ?? pageName),
      width: typeof pageJson.width === "number" ? pageJson.width : undefined,
      height: typeof pageJson.height === "number" ? pageJson.height : undefined,
      visuals,
    });
  }

  const dataColors = await readThemeColors(reportDir, themeCollection);
  return {
    source: reportDir,
    reportName: path.basename(reportDir).replace(/\.Report$/i, ""),
    baseTheme: baseTheme.name ? String(baseTheme.name) : undefined,
    dataColors,
    pages,
    warnings,
  };
}

async function readThemeColors(reportDir: string, themeCollection: Record<string, unknown>): Promise<string[]> {
  const candidates = [
    path.join(reportDir, "StaticResources", "RegisteredResources"),
    path.join(reportDir, "StaticResources", "SharedResources", "BaseThemes"),
  ];
  for (const directory of candidates) {
    if (!existsSync(directory)) continue;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const theme = await readJsonIfExists<Record<string, unknown>>(path.join(directory, entry.name));
      if (Array.isArray(theme?.dataColors)) {
        return (theme?.dataColors as unknown[]).filter((color): color is string => typeof color === "string");
      }
      const visualStyles = theme?.visualStyles as Record<string, unknown> | undefined;
      if (visualStyles) {
        // Custom themes may nest colors; leave discovery to the LLM when no top-level colors exist.
      }
    }
  }
  const customTheme = themeCollection.customTheme as Record<string, unknown> | undefined;
  if (customTheme?.name) return [];
  return [];
}
