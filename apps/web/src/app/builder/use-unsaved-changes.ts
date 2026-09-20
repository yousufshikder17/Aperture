"use client";
import { useEffect } from "react";

let dirtyForms = 0;
const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };

export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    // Builder links use document navigation: one native warning covers every dirty form.
    if (dirtyForms++ === 0) window.addEventListener("beforeunload", warn);
    return () => {
      if (--dirtyForms === 0) window.removeEventListener("beforeunload", warn);
    };
  }, [dirty]);
}
