import { ResumeImportResultSchema, ResumeImportModeSchema, type ResumeImportMode } from "@aperture/shared";
import { ApiError } from "../../lib/api";
export const IMPORT_LIMIT = 8 * 1024 * 1024;
export function importBody(file: File, mode: ResumeImportMode = "deterministic") {
  if (!file.size) throw new Error("Choose a non-empty PDF or DOCX file.");
  if (file.size > IMPORT_LIMIT) throw new Error("Choose a file no larger than 8 MiB.");
  const extension = file.name.toLowerCase().split(".").pop();
  const type = extension === "pdf" ? "application/pdf" : extension === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : null;
  if (!type || (file.type && file.type !== type && file.type !== "application/octet-stream"))
    throw new Error("Choose a PDF or DOCX file.");
  const body = new FormData();
  body.set("file", new File([file], file.name, { type }));
  body.set("mode", ResumeImportModeSchema.parse(mode));
  return body;
}
export const parseExtraction = (value: unknown) => ResumeImportResultSchema.parse(value);
export function importError(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return "Sign in again, then retry the import. Your current draft is unchanged.";
    if (cause.status === 413) return "This file exceeds an import limit. Choose a smaller file with fewer pages.";
    if (cause.code === "vision_required") return "This PDF needs image extraction. Use OCR or a text-based PDF/DOCX, or configure a vision-capable AI model; a text-only Ollama model cannot read scanned pages.";
    if (cause.code === "resume_text_unusable") return "Not enough readable text was found. Export a text-based PDF/DOCX, enter the content in the builder, or retry with AI if a vision-capable model is available.";
    if (cause.code === "ai_unavailable") return "AI import is not configured. Use deterministic import for text-based files, or configure a cloud provider or local Ollama.";
    if (cause.code === "ai_import_failed") return "AI import could not complete. Check that the configured provider/model is available, or retry deterministic import.";
    if (cause.status === 422) return "This document could not be read. Export an unlocked text-based PDF or DOCX and try again.";
    return "Extraction failed. Retry or keep editing your current resume.";
  }
  return cause instanceof Error && /Choose a/.test(cause.message) ? cause.message :
    "The extracted resume could not be read. Your current draft is unchanged.";
}
