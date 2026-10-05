# Resume import

`POST /v1/builder/upload` accepts the existing multipart `file` and optional
`mode`: `deterministic` (default), `auto`, or `ai-assisted`. The existing
`ResumeExtraction` contract stays unchanged: `resume` and `layoutFindings`.
Additive `import` metadata reports the extraction method, AI use, warnings,
and cleaned raw text. Older responses without metadata remain readable.
`GET /v1/builder/import-capabilities` reports configured text/vision availability;
it does not generate anything, transmit resume content, or require an AI key.

## Extraction and decisions

DOCX uses the existing Mammoth raw-text extractor. PDF uses the already-installed
Mozilla PDF.js Node-compatible legacy build, local packaged character maps/fonts,
and disabled JavaScript evaluation. Text is read from every page, preserving line
breaks where PDF text positions or end-of-line markers support them. It does not
try to infer visual columns or perform OCR.

Both formats use the same conservative section parser. It recognizes Experience /
Work Experience, Education, Projects, Skills / Technical Skills, Summary / Profile,
and common synonyms, plus Certifications, Publications and Awards. Contacts come
from header text, including explicit Location/Headline fields. Skills come from
the skills section, with supplied category labels; proficiency and inferred role
evidence are not fabricated. Role/company headers need an explicit relationship,
labels, or an unambiguous role keyword, plus a date range. Education recognizes
common credential names next to institution text. Missing/ambiguous information
remains empty or null, with the full extracted text retained in the preview.
Target roles remain empty for the user to choose.

| Mode | Usable text | Inadequate/scanned PDF |
| --- | --- | --- |
| deterministic | Return a parsed draft without AI | Actionable text/OCR/vision-required message; never call AI |
| auto | Return the same draft without AI, even when AI is configured | Use configured, confirmed vision AI; otherwise explain how to recover |
| AI-assisted | Structure DOCX/text with AI; PDF uses rendered pages if vision is confirmed, otherwise text | Requires confirmed vision AI |

Usability requires at least 80 non-whitespace characters, at least 40 letters,
and fewer than 1% replacement characters. Each PDF page must also contain at least
40 readable non-whitespace characters and no replacement character. This deliberately
prevents a mixed text/scanned PDF from silently losing image-only pages. Empty or
unreadable DOCX input needs a fresh text export/manual entry; vision is a PDF path.
Auto mode may use configured text AI for a short DOCX that still contains readable
text; empty DOCX input never goes to AI.
Corrupt or locked documents return a safe error, rather than falling through to
unbounded rendering. Unsupported-format and upload limits remain enforced.

Deterministic and AI-text drafts report only text/parser-visible findings. AI-text
model-generated layout findings are discarded in favor of the deterministic parser's
findings, so a text-only model cannot claim to have inspected columns/fonts/graphics.
Vision findings are retained only after every PDF page has actually been rendered
and included in an image request to a confirmed vision model.

## Optional AI and Ollama

Import uses the existing provider abstraction and `fast`/mechanical tier. Gemini,
Claude, OpenAI and Ollama text generation keep their existing configuration and
structured-output validation. No alternate scoring/tailoring router was added.
Configuration availability does not guarantee that a provider/model is running,
authorized or has sufficient quota/context; generation failure returns a safe,
actionable message and keeps the existing editor draft intact.

For optional local text structuring, configure the root `.env`:

```dotenv
FAST_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=your-installed-model
```

Start Ollama and install the selected model separately; import does not pull models.
Text-only models receive text and the existing JSON schema, never images.
For images, the Ollama adapter checks `POST /api/show` for the selected fast model
and requires an explicit `vision` capability. Missing/malformed metadata, an
unavailable server, or a text-only model never authorizes images. See the
[official Ollama API contract](https://github.com/ollama/ollama/blob/main/docs/api.md#show-model-information).
Hosted model capabilities are conservatively recognized for supported Claude 3/4,
Gemini 2/3 Flash/Pro, and GPT-4o/4.1 model families. An unrecognized model still
supports optional text structuring but is not assumed to support images.

PDF vision uses PDF.js's installed Node canvas factory directly. This avoids the
existing image converter's incompatible Windows asset-path handling. Local asset
paths are resolved from the installed package with portable separators. Rendering
is sequential, in memory, and writes no page-image files.

## Review, safety and limitations

The builder offers explicit modes, method/AI-use disclosure, raw-text comparison,
and retry with AI when configured. A successful import only opens a review draft.
Accepting asks before replacing the editor draft; the saved profile is untouched
until the user explicitly saves through the existing profile flow. Accepted raw
text stays available for comparison while editing and is cleared after successful
save; it is not silently dropped when the editor remounts and is not persisted
as a new profile field.

Existing multipart/file bounds remain 8 MiB by default. Import additionally limits
PDFs to 20 pages and extracted text to 200,000 characters. Vision rendering limits
each page to 8 million pixels and all rendered PNGs together to 16 MiB. Resources
are destroyed after reading/rendering. No automatic cloud/model call happens in
deterministic mode. Raw text is cleaned of control/bidi characters and rendered as
escaped text, so literal code/HTML examples are not interpreted as executable HTML.
Provider response bodies and document contents are not included in error messages.

The V1 parser handles common English headings/date formats; it does not reliably
understand arbitrary layouts, non-English section names, invisible DOCX metadata,
multi-column PDF reading order, or unlabeled work/education boundaries. Raw evidence
allows correction without AI. Blank/very short PDF pages conservatively require
review via OCR/vision or re-export. AI results also require human verification.

`apps/api/test/resume-import.test.ts` builds DOCX, text PDF and image-only/mixed PDF
fixtures from `fixtures/resume-import.txt`, exercising actual extraction/rendering.
Provider calls are mocked; deterministic CI needs no credentials or Ollama daemon.
Web tests cover policies, metadata, safe error recovery, and default review/no-save
behavior. Existing multipart/upload/security tests remain applicable.
