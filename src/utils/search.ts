import Fuse from "fuse.js";
import { pinyin } from "pinyin-pro";

const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/u\u0308/g, "v")
    .replace(/[\p{M}\p{P}\p{S}\s]/gu, "");

const getSearchTerms = (text: string, includeInitials = true): string[] => {
  const terms = [normalize(text)];
  if (/\p{Script=Han}/u.test(text)) {
    const options = {
      toneType: "none" as const,
      nonZh: "consecutive" as const,
      separator: "",
      v: true,
    };
    terms.push(normalize(pinyin(text, options)));
    if (includeInitials) {
      terms.push(normalize(pinyin(text, { ...options, pattern: "first" })));
    }
  }
  return [...new Set(terms.filter(Boolean))];
};

// Build once per list change; typing only searches the prepared local index.
export const createTextSearch = <T>(
  items: T[],
  getTexts: (item: T) => (string | undefined)[]
) => {
  const entries = items.map((item) => ({
    item,
    terms: getTexts(item).flatMap((text) => (text ? getSearchTerms(text) : [])),
  }));
  const index = new Fuse(entries, {
    keys: ["terms"],
    threshold: 0.25,
    ignoreLocation: true,
    ignoreFieldNorm: true,
    shouldSort: false,
  });

  return (query: string): T[] => {
    const keywords = query.trim().split(/\s+/).filter(Boolean);
    if (keywords.length === 0) return items;

    // Keep the existing OR behavior for multiple keywords and the list order.
    const matches = new Set(
      keywords.flatMap((keyword) =>
        getSearchTerms(keyword, false).flatMap((term) =>
          index.search(term).map((result) => result.item.item)
        )
      )
    );
    return items.filter((item) => matches.has(item));
  };
};
