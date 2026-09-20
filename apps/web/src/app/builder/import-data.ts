import { ResumeExtractionSchema } from "@aperture/shared";
export const IMPORT_LIMIT = 8 * 1024 * 1024;
export function importBody(file: File) {
  if (!file.size) throw new Error("Choose a non-empty PDF or DOCX file.");
  if (file.size > IMPORT_LIMIT) throw new Error("Choose a file no larger than 8 MiB.");
  const extension = file.name.toLowerCase().split(".").pop();
  const type = extension === "pdf" ? "application/pdf" : extension === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : null;
  if (!type || (file.type && file.type !== type && file.type !== "application/octet-stream"))
    throw new Error("Choose a PDF or DOCX file.");
  const body = new FormData();
  body.set("file", new File([file], file.name, { type }));
  return body;
}
export const parseExtraction = (value: unknown) => ResumeExtractionSchema.parse(value);
