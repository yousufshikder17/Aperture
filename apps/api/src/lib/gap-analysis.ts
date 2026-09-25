import { listingSkillTerms, normalize, resumeText, hasKeyword } from "@aperture/ai";
import type { MasterResume } from "@aperture/shared";

export function buildSkillGaps(
  resume: MasterResume,
  listings: { title: string; description: string }[],
) {
  const resumeTerms = resumeText(resume);
  const totals = new Map<string, number>();
  const counts = new Map<string, { skill: string; role_type: string; listings_requiring: number }>();

  for (const listing of listings) {
    const title = normalize(listing.title);
    const role = resume.targetRoles.find((target) => {
      const tokens = normalize(target).split(" ").filter((token) => token.length > 2);
      return tokens.length > 0 && tokens.every((token) => hasKeyword(title, token));
    }) ?? "other";
    totals.set(role, (totals.get(role) ?? 0) + 1);

    for (const term of listingSkillTerms(`${listing.title}\n${listing.description}`, resume)) {
      if (!term.inDictionary || hasKeyword(resumeTerms, term.term)) continue;
      const key = `${role}\0${term.term}`;
      const gap = counts.get(key) ?? { skill: term.term, role_type: role, listings_requiring: 0 };
      gap.listings_requiring++;
      counts.set(key, gap);
    }
  }

  return [...counts.values()].map((gap) => {
    const listings_total = totals.get(gap.role_type) ?? 0;
    return {
      ...gap,
      listings_total,
      frequency_pct: listings_total ? Math.round(1000 * gap.listings_requiring / listings_total) / 10 : null,
    };
  }).sort((a, b) => (b.frequency_pct ?? 0) - (a.frequency_pct ?? 0) || b.listings_requiring - a.listings_requiring);
}
