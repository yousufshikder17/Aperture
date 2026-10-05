import { load } from "cheerio";

export function careerText(value: string): string {
  const $ = load(value, {}, false);
  $("script,style,template,noscript").remove();
  $("br").replaceWith("\n");
  $("p,div,section,article,li,h1,h2,h3,h4,h5,h6,tr").each((_index, element) => { $(element).append("\n"); });
  return $.text().replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
