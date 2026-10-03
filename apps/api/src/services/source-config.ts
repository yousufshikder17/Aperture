import { rssSourceConfig, type FeedConfig } from "./rss-source.js";

// Public sources are operator-configured. No personalized or default Jobicy feed is added.
export function configuredFeeds(env: NodeJS.ProcessEnv = process.env): FeedConfig[] {
  return [
    { source: "linkedin_rss", url: env.LINKEDIN_RSS_URL ?? "" },
    { source: "indeed_rss", url: env.INDEED_RSS_URL ?? "" },
  ];
}
export function configuredSources(env: NodeJS.ProcessEnv = process.env) {
  return configuredFeeds(env).map(rssSourceConfig);
}
