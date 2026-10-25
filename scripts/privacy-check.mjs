import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ignoredDirs = new Set(["node_modules", "dist", "tmp", ".git", "coverage", ".vscode-test", "samples"]);
const textExtensions = new Set([".md", ".ts", ".js", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".txt", ".css", ".html", ".pbip", ".tmdl"]);
const ignoredFiles = new Set(["scripts/privacy-check.mjs", "pnpm-lock.yaml"]);

const checks = [
    { name: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
    { name: "OpenAI-style secret", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
    { name: "GitHub token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
    { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/g },
    { name: "credential assignment", re: /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)\s*[:=]\s*["'][^"'\s]{8,}["']/gi },
    { name: "absolute Windows user path", re: /\b[A-Za-z]:\\Users\\(?!<)[^\\\s]+/g },
];

const findings = [];
for await (const file of walk(root)) {
    const rel = path.relative(root, file).replaceAll("\\", "/");
    if (ignoredFiles.has(rel)) continue;
    let text;
    try {
        text = await readFile(file, "utf8");
    } catch {
        continue;
    }
    const lines = text.split(/\r?\n/);
    for (const check of checks) {
        check.re.lastIndex = 0;
        for (let i = 0; i < lines.length; i += 1) {
            check.re.lastIndex = 0;
            const match = check.re.exec(lines[i]);
            if (match) findings.push({ rel, line: i + 1, check: check.name, sample: redact(match[0]) });
        }
    }
}

if (findings.length === 0) {
    console.log("privacy-check: OK - no secrets or private paths found");
    process.exit(0);
}
console.error(`privacy-check: ${findings.length} potential finding(s)`);
for (const f of findings) console.error(`  ${f.rel}:${f.line} [${f.check}] ${f.sample}`);
process.exit(1);

async function* walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (ignoredDirs.has(entry.name)) continue;
            yield* walk(path.join(dir, entry.name));
            continue;
        }
        if (!entry.isFile()) continue;
        const full = path.join(dir, entry.name);
        const info = await stat(full);
        if (info.size > 2_000_000) continue;
        if (textExtensions.has(path.extname(entry.name).toLowerCase()) || entry.name === ".gitignore" || entry.name === ".gitattributes") yield full;
    }
}

function redact(value) {
    if (value.length <= 12) return "<redacted>";
    return `${value.slice(0, 6)}...${value.slice(-3)}`;
}
