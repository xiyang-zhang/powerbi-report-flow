import { readFile } from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import type { LlmImage } from "../llm/provider";

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".tsv",
  ".xml",
  ".html",
  ".htm",
  ".log",
]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_TEXT_CHARS = 100_000;
const MAX_IMAGES = 8;

export interface DocumentContext {
  text: string;
  images: LlmImage[];
  warnings: string[];
}

function mimeTypeForImage(file: string): LlmImage["mimeType"] | undefined {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return undefined;
}

function imageFromBuffer(data: Uint8Array, mimeType: string | undefined): LlmImage | undefined {
  if (mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp") {
    return { data, mimeType };
  }
  return undefined;
}

async function readDocx(
  file: string,
  images: LlmImage[],
  warnings: string[],
): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ path: file });
    const html = await mammoth.convertToHtml(
      { path: file },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          if (images.length >= MAX_IMAGES) return { src: "" };
          const buffer = await image.read();
          const converted = imageFromBuffer(new Uint8Array(buffer), image.contentType);
          if (converted) images.push(converted);
          return { src: "" };
        }),
      },
    );
    for (const message of [...result.messages, ...html.messages]) {
      if (message.type === "warning" || message.type === "error") warnings.push(`Document ${path.basename(file)}: ${message.message}`);
    }
    return result.value;
  } catch (error) {
    warnings.push(`Document ${path.basename(file)} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

/**
 * Reads attached text documents, images, and .docx files into one LLM context.
 * PDFs are not parsed yet; they are reported as a warning instead of silently ignored.
 */
export async function readDocumentContext(files: string[]): Promise<DocumentContext> {
  const warnings: string[] = [];
  const images: LlmImage[] = [];
  const sections: string[] = [];

  for (const file of files.filter((candidate) => candidate && candidate.trim().length > 0)) {
    const ext = path.extname(file).toLowerCase();
    try {
      if (IMAGE_EXTENSIONS.has(ext)) {
        if (images.length >= MAX_IMAGES) {
          warnings.push(`Document image limit (${MAX_IMAGES}) reached; skipped ${path.basename(file)}.`);
          continue;
        }
        const mimeType = mimeTypeForImage(file);
        if (!mimeType) {
          warnings.push(`Unsupported image type: ${path.basename(file)}.`);
          continue;
        }
        images.push({ data: new Uint8Array(await readFile(file)), mimeType });
        sections.push(`Attached image: ${path.basename(file)}`);
        continue;
      }
      if (ext === ".docx") {
        const text = await readDocx(file, images, warnings);
        if (text.trim()) sections.push(`## ${path.basename(file)}\n${text.trim()}`);
        continue;
      }
      if (TEXT_EXTENSIONS.has(ext)) {
        const raw = await readFile(file, "utf8");
        sections.push(`## ${path.basename(file)}\n${raw.slice(0, MAX_TEXT_CHARS)}`);
        if (raw.length > MAX_TEXT_CHARS) {
          warnings.push(`Document ${path.basename(file)} was truncated to ${MAX_TEXT_CHARS} characters.`);
        }
        continue;
      }
      warnings.push(`Unsupported document type: ${path.basename(file)} (supported: text, markdown, JSON, YAML, CSV, XML, HTML, DOCX, PNG/JPEG/WebP).`);
    } catch (error) {
      warnings.push(`Document ${path.basename(file)} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let text = sections.join("\n\n");
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    warnings.push(`Document context was truncated to ${MAX_TEXT_CHARS} characters.`);
  }
  return { text, images: images.slice(0, MAX_IMAGES), warnings };
}
