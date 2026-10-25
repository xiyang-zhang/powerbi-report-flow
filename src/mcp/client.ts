import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpStatus {
  available: boolean;
  path?: string;
  toolCount: number;
  tools: string[];
  error?: string;
}

export interface McpModelVerification {
  ok: boolean;
  message: string;
  tablesLoaded?: number;
  measuresLoaded?: number;
  relationshipsLoaded?: number;
}

export class PowerBiMcpBridge {
  private client?: Client;
  private transport?: StdioClientTransport;
  private tools: McpToolInfo[] = [];

  constructor(
    private readonly extensionPath?: string,
    private readonly auditLogDir?: string,
  ) {}

  resolvePath(): string | undefined {
    const candidates = [
      process.env.POWERBI_MODELING_MCP,
      this.extensionPath
        ? path.join(this.extensionPath, "dist", "tools", "mcp", "powerbi-modeling-mcp.exe")
        : undefined,
      this.extensionPath
        ? path.join(this.extensionPath, "node_modules", "@microsoft", "powerbi-modeling-mcp", "index.js")
        : undefined,
      path.join(process.cwd(), "node_modules", "@microsoft", "powerbi-modeling-mcp", "index.js"),
      path.join(process.cwd(), "dist", "tools", "mcp", "powerbi-modeling-mcp.exe"),
    ].filter((candidate): candidate is string => Boolean(candidate));
    return candidates.find((candidate) => existsSync(candidate));
  }

  async start(acceptEula: boolean): Promise<McpStatus> {
    const serverPath = this.resolvePath();
    if (!serverPath) {
      return { available: false, toolCount: 0, tools: [], error: "Power BI Authoring MCP package was not found." };
    }
    if (!acceptEula) {
      return {
        available: false,
        path: serverPath,
        toolCount: 0,
        tools: [],
        error: "MCP EULA has not been accepted. Accept it in the Power BI Report Flow settings before starting the server.",
      };
    }
    try {
      if (this.auditLogDir) await mkdir(this.auditLogDir, { recursive: true });
      const isExecutable = serverPath.toLowerCase().endsWith(".exe");
      this.transport = new StdioClientTransport({
        command: isExecutable ? serverPath : process.execPath,
        args: [
          ...(isExecutable ? [] : [serverPath]),
          "--start",
          "--accepteula",
          ...(this.auditLogDir ? [`--audit-log-path=${this.auditLogDir}`] : []),
        ],
        stderr: "pipe",
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          ),
          Logging__EventLog__LogLevel__Default: "None",
          Logging__EventLog__Enabled: "false",
        },
      });
      this.client = new Client({ name: "powerbi-report-flow", version: "0.1.0" });
      await this.client.connect(this.transport);
      const listed = await this.client.listTools();
      this.tools = listed.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
      return { available: true, path: serverPath, toolCount: this.tools.length, tools: this.tools.map((tool) => tool.name) };
    } catch (error) {
      await this.stop();
      return {
        available: false,
        path: serverPath,
        toolCount: 0,
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getTools(): McpToolInfo[] {
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) throw new Error("MCP client is not connected.");
    return await this.client.callTool({ name, arguments: args });
  }

  async verifyModel(modelDir: string): Promise<McpModelVerification> {
    try {
      const connect = await this.callTool("connection_operations", {
        request: { operation: "ConnectFolder", folderPath: modelDir },
      });
      const connectJson = parseToolJson(connect);
      const connectMessage = String(connectJson?.message ?? "");
      if (/^error/i.test(connectMessage) || connectJson?.error) {
        return { ok: false, message: connectMessage || "MCP could not load the TMDL folder." };
      }
      const data = (connectJson?.data ?? {}) as Record<string, unknown>;
      return {
        ok: true,
        message: connectMessage || "MCP loaded the semantic model.",
        tablesLoaded: Number(data.tablesLoaded ?? 0),
        measuresLoaded: Number(data.measuresLoaded ?? 0),
        relationshipsLoaded: Number(data.relationshipsLoaded ?? 0),
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async stop(): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      // ignore
    }
    this.client = undefined;
    this.transport = undefined;
  }
}

function toolText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return content.map((item) => item.text ?? "").join("\n");
}

function parseToolJson(result: unknown): Record<string, unknown> | undefined {
  const text = toolText(result).trim();
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
