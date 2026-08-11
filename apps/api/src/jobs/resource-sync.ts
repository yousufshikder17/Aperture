// CLI entry for the registry sync job (also wired as `npm run resources:sync`).
import { syncRegistry } from "../services/resource-sync.js";

syncRegistry()
  .then((r) => {
    console.log(
      `registry sync: ${r.entries} entries, ${r.fromRegistry} tagged by registry, ${r.fromAi} AI-indexed`,
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error("registry sync failed:", err);
    process.exit(1);
  });
