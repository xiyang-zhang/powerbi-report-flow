import path from "node:path";
import { copyFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { PageBackgroundSpec, ReportSpec, TableSpec } from "../core/types";
import { ensureDir, shortId, uuid, writeJson, writeText } from "../core/util";
import { layoutPage } from "./layout";
import { buildVisualJson } from "./visuals";

export interface ReportBuildResult {
  reportDir: string;
  warnings: string[];
  visualCount: number;
}

function safePageName(name: string, index: number): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);
  return cleaned.length > 0 ? cleaned : `page_${index + 1}`;
}

export async function createPbip(projectRoot: string, reportName: string): Promise<string> {
  const pbipPath = path.join(projectRoot, `${reportName}.pbip`);
  await writeJson(pbipPath, {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json",
    version: "1.0",
    artifacts: [{ report: { path: `${reportName}.Report` } }],
    settings: { enableAutoRecovery: true },
  });
  return pbipPath;
}

function backgroundSpec(value: string | PageBackgroundSpec | undefined): PageBackgroundSpec | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    return value.startsWith("#") || /^(rgb|hsl)a?\(/i.test(value) ? { color: value } : { image: value };
  }
  return value;
}

function backgroundExpression(value: string): { expr: { Literal: { Value: string } } } {
  return { expr: { Literal: { Value: `'${value.replace(/'/g, "''")}'` } } };
}

export async function buildReport(
  projectRoot: string,
  reportName: string,
  spec: ReportSpec,
  modelTables: TableSpec[],
): Promise<ReportBuildResult> {
  const reportDir = path.join(projectRoot, `${reportName}.Report`);
  const pagesRoot = path.join(reportDir, "definition", "pages");
  const resourcesDir = path.join(reportDir, "StaticResources", "RegisteredResources");
  await rm(pagesRoot, { recursive: true, force: true });
  await ensureDir(pagesRoot);
  await rm(resourcesDir, { recursive: true, force: true });

  const pageNames: string[] = [];
  const usedPageNames = new Set<string>();
  for (const [index, page] of spec.pages.entries()) {
    let candidate = safePageName(page.name, index);
    if (usedPageNames.has(candidate.toLowerCase())) candidate = `${candidate}_${index + 1}`;
    usedPageNames.add(candidate.toLowerCase());
    pageNames.push(candidate);
  }
  const warnings: string[] = [];
  const resourceItems: Array<{ name: string; path: string; type: "Image" }> = [];
  const pageBackgrounds = new Map<number, PageBackgroundSpec>();
  for (const [index, page] of spec.pages.entries()) {
    const configured = backgroundSpec(page.background);
    if (!configured) continue;
    const resolved: PageBackgroundSpec = { ...configured };
    if (configured.image) {
      const candidates = path.isAbsolute(configured.image)
        ? [configured.image]
        : [path.resolve(projectRoot, configured.image), path.resolve(reportDir, configured.image)];
      const source = candidates.find((candidate) => existsSync(candidate));
      if (!source) {
        warnings.push(`Page ${page.displayName}: background image not found (${configured.image}).`);
        delete resolved.image;
      } else {
        const extension = path.extname(source).toLowerCase();
        if (![".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(extension)) {
          warnings.push(`Page ${page.displayName}: unsupported background image type (${path.basename(source)}).`);
          delete resolved.image;
        } else {
          await ensureDir(resourcesDir);
          const itemName = `file${shortId(12)}${extension}`;
          const target = path.join(resourcesDir, itemName);
          await copyFile(source, target);
          await stat(target);
          resolved.image = itemName;
          resourceItems.push({ name: itemName, path: itemName, type: "Image" });
        }
      }
    }
    pageBackgrounds.set(index, resolved);
  }
  let visualCount = 0;

  for (let pageIndex = 0; pageIndex < spec.pages.length; pageIndex += 1) {
    const page = spec.pages[pageIndex]!;
    const pageName = pageNames[pageIndex]!;
    const pageDir = path.join(pagesRoot, pageName);
    await ensureDir(pageDir);
    const configured = pageBackgrounds.get(pageIndex);
    const backgroundProperties: Record<string, unknown> = {};
    if (configured?.color) {
      backgroundProperties.color = { solid: { color: backgroundExpression(configured.color) } };
    }
    if (typeof configured?.transparency === "number") {
      const transparency = Math.max(0, Math.min(100, Math.round(configured.transparency)));
      backgroundProperties.transparency = { expr: { Literal: { Value: `${transparency}D` } } };
    } else {
      backgroundProperties.transparency = { expr: { Literal: { Value: "0D" } } };
    }
    if (configured?.image) {
      backgroundProperties.image = {
        image: {
          name: backgroundExpression(configured.image),
          url: {
            expr: {
              ResourcePackageItem: {
                PackageName: "RegisteredResources",
                PackageType: 1,
                ItemName: configured.image,
              },
            },
          },
          scaling: backgroundExpression(configured.scaling ?? "Fill"),
        },
      };
    }
    await writeJson(path.join(pageDir, "page.json"), {
      $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json",
      name: pageName,
      displayName: page.displayName,
      displayOption: "FitToPage",
      height: page.canvas.height,
      width: page.canvas.width,
      ...(Object.keys(backgroundProperties).length > 0
        ? { objects: { background: [{ properties: backgroundProperties }] } }
        : {}),
    });

    for (const [index, layout] of layoutPage(page).entries()) {
      const placement = layout.placement;
      const table = modelTables.find((candidate) => candidate.name === placement.fieldBindings[0]?.table) ?? modelTables[0];
      const validBindings = placement.fieldBindings.filter((binding) => {
        const target = modelTables.find((candidate) => candidate.name === binding.table);
        if (!target) return false;
        return (
          target.columns.some((column) => column.name === binding.field) ||
          target.measures.some((measure) => measure.name === binding.field)
        );
      });
      if (validBindings.length !== placement.fieldBindings.length) {
        warnings.push(
          `Visual ${placement.id} on ${page.displayName}: ignored fields not present in the model: ${placement.fieldBindings
            .filter((binding) => !validBindings.includes(binding))
            .map((binding) => `${binding.table}[${binding.field}]`)
            .join(", ")}`,
        );
      }
      const visual = buildVisualJson(
        spec,
        { ...page, name: pageName },
        { ...placement, fieldBindings: validBindings },
        layout.rect,
        table ? [table] : modelTables,
      );
      const visualName = String((visual as { name?: string }).name ?? shortId());
      const visualDir = path.join(pageDir, "visuals", visualName);
      await ensureDir(visualDir);
      await writeJson(path.join(visualDir, "visual.json"), visual);
      visualCount += 1;
      if (index > 50) {
        warnings.push(`Page ${page.displayName} has more than 50 visuals; only the first 51 were written.`);
        break;
      }
    }
  }

  await writeJson(path.join(reportDir, "definition.pbir"), {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json",
    version: "4.0",
    datasetReference: { byPath: { path: `../${reportName}.SemanticModel` } },
  });

  await writeJson(path.join(reportDir, "definition", "version.json"), {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json",
    version: "2.0.0",
  });

  await writeJson(path.join(reportDir, "definition", "pages", "pages.json"), {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.1.0/schema.json",
    pageOrder: pageNames,
    activePageName: pageNames[0],
  });

  await writeJson(path.join(reportDir, "definition", "report.json"), {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.3.0/schema.json",
    themeCollection: {
      baseTheme: {
        name: "CY24SU06",
        type: "SharedResources",
        reportVersionAtImport: { visual: "2.11.0", report: "3.4.0", page: "2.3.1" },
      },
    },
    ...(resourceItems.length > 0
      ? {
          resourcePackages: [
            {
              name: "RegisteredResources",
              type: "RegisteredResources",
              items: resourceItems,
            },
          ],
        }
      : {}),
    settings: {
      useStylableVisualContainerHeader: true,
      exportDataMode: "AllowSummarized",
      defaultDrillFilterOtherVisuals: true,
      allowChangeFilterTypes: true,
      useEnhancedTooltips: true,
      useDefaultAggregateDisplayName: true,
    },
    annotations: [
      { name: "generated_by", value: "powerbi-report-flow" },
      { name: "source_mode", value: spec.sourceMode },
      { name: "report_mode", value: spec.reportMode },
    ],
  });

  await writeJson(path.join(reportDir, ".platform"), {
    $schema: "https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json",
    metadata: { type: "Report", displayName: reportName },
    config: { version: "2.0", logicalId: uuid() },
  });

  await writeText(
    path.join(projectRoot, "README.md"),
    `# ${reportName}\n\nGenerated by Power BI Report Flow.\n\nOpen \`${reportName}.pbip\` in Power BI Desktop to refresh data and inspect the report.\n`,
  );

  return { reportDir, warnings, visualCount };
}
