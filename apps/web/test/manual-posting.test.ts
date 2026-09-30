import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ManualPosting, postingError } from "../src/app/listings/manual-posting.js";
import { ApiError } from "../src/lib/api.js";

test("manual posting exposes labeled native inputs, explicit saving and upload limits", () => {
  const html = renderToStaticMarkup(React.createElement(ManualPosting, { onSaved() {} }));
  for (const label of ["Job title", "Company", "Description", "Original posting URL", "Save posting", "Import for review"])
    assert.ok(html.includes(label));
  assert.match(html, /private to your account/);
  assert.match(html, /one match allowance/);
  assert.match(html, /never switches to AI automatically/);
  assert.match(html, /without AI or an allowance/);
  assert.match(html, /accept=".txt,.docx,.pdf"/);
  assert.match(html, /aria-describedby="posting-file-help"/);
});

test("posting failures explain upload and retry recovery without erasing the draft", () => {
  assert.match(postingError(new ApiError(409)), /already saved/);
  assert.match(postingError(new ApiError(413)), /4 MiB/);
  assert.match(postingError(new ApiError(422)), /paste the description/);
  assert.match(postingError(new ApiError(401)), /Sign in/);
  assert.doesNotMatch(postingError(new Error("secret")), /secret/);
});
