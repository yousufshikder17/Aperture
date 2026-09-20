import { ReferenceListSchema } from "@aperture/shared";
export function referencesFromForm(form: FormData) {
  const text = (key: string) => String(form.get(key) ?? "").trim();
  return ReferenceListSchema.parse({ references: form.getAll("references").map(id => {
    const prefix = "references." + id + ".";
    return {
      name: text(prefix + "name"), relationship: text(prefix + "relationship"),
      title: text(prefix + "title"), company: text(prefix + "company"),
      seniority: text(prefix + "seniority"), lastWorkedTogether: text(prefix + "lastWorkedTogether"),
      contact: text(prefix + "contact") || null, notes: text(prefix + "notes") || null,
    };
  }) });
}
