import path from "node:path";
import type { DataProfile, FlowConfig } from "../core/types";
import { profileLocalFile } from "../data/localFiles";
import { generateMockData } from "../data/mock";
import { mockProfileFromSchema } from "../data/mockProfile";
import { profileExternalDatabase } from "../data/externalDb";

const MAX_ROWS = 50_000;

export async function profileFlowData(config: FlowConfig, briefDir: string): Promise<DataProfile> {
  if (config.dataMode === "local") {
    if (!config.localFile) throw new Error("Select a CSV, TSV, XLSX, or JSON file for local data mode.");
    const result = await profileLocalFile(config.localFile, path.join(briefDir, "cache"), MAX_ROWS);
    return result.profile;
  }
  if (config.dataMode === "mock") {
    if (!config.mockSchema) throw new Error("Provide a mock schema before profiling.");
    return mockProfileFromSchema(config.mockSchema);
  }
  if (config.externalDb) {
    const result = await profileExternalDatabase(config.externalDb);
    return result.profile;
  }
  if (config.fabric) {
    throw new Error(
      "Fabric live-model mode requires the Power BI Authoring MCP connection. Configure the workspace/model and use the MCP-backed flow; this build currently supports local, mock, and SQL external profiles.",
    );
  }
  throw new Error("External data mode needs either a SQL database configuration or a Fabric model configuration.");
}

export async function localProfileForBuild(config: FlowConfig, dataDir: string): Promise<DataProfile> {
  if (config.dataMode === "mock") {
    if (!config.mockSchema) throw new Error("Mock schema is missing.");
    return generateMockData(config.mockSchema, dataDir, MAX_ROWS);
  }
  if (config.dataMode === "local") {
    if (!config.localFile) throw new Error("Local data file is missing.");
    const result = await profileLocalFile(config.localFile, dataDir, MAX_ROWS);
    return result.profile;
  }
  if (!config.externalDb) throw new Error("External database configuration is missing.");
  return (await profileExternalDatabase(config.externalDb)).profile;
}
