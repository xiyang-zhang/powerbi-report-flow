import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const commit = process.env.POWERBI_SKILLS_COMMIT ?? "main";
const root = process.cwd();
const target = path.join(root, "resources", "skills", "powerbi-report-cli");
const zipUrl = `https://github.com/microsoft/skills-for-fabric/archive/${commit}.zip`;
const tempZip = path.join(root, "tmp", "skills-for-fabric.zip");
const tempDir = path.join(root, "tmp", "skills-for-fabric");

console.log(`Downloading ${zipUrl}`);
await mkdir(path.dirname(tempZip), { recursive: true });
const response = await fetch(zipUrl);
if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
await pipeline(response.body, createWriteStream(tempZip));

const { execFileSync } = await import("node:child_process");
await rm(tempDir, { recursive: true, force: true });
execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${tempZip}' -DestinationPath '${tempDir}' -Force`], {
  stdio: "inherit",
});

const { readdir, cp } = await import("node:fs/promises");
const extracted = (await readdir(tempDir)).find((name) => name.startsWith("skills-for-fabric-"));
if (!extracted) throw new Error("Could not find the extracted skills-for-fabric folder.");
const source = path.join(tempDir, extracted, "plugins", "powerbi-authoring", "skills", "powerbi-report-cli");
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
console.log(`Bundled skill: ${target}`);
