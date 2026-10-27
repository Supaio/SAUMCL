import type {
  CommunityFeed,
  CommunityLink,
  RewardOffer,
  RewardState,
} from "@/models/community";

export function safeCommunityUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function officialRewardUrl(value: unknown): value is string {
  if (!safeCommunityUrl(value)) return false;
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    !url.port &&
    ["minecraft.net", "www.minecraft.net"].includes(url.hostname) &&
    /\/article\/[^/]+\/?$/.test(url.pathname)
  );
}

export function rewardDate(value: string | null, end = false): number | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(
      year,
      month - 1,
      day,
      end ? 23 : 0,
      end ? 59 : 0,
      end ? 59 : 0,
      end ? 999 : 0
    );
    return date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
      ? date.getTime()
      : null;
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value
    )
  )
    return null;
  const day = value.slice(0, 10);
  if (rewardDate(day) === null) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function rewardState(offer: RewardOffer, now = Date.now()): RewardState {
  const start = rewardDate(offer.startsAt);
  const earn = rewardDate(offer.earnUntil, true);
  const redeem = rewardDate(offer.redeemUntil, true);
  const end = redeem ?? earn;
  if (end !== null && now > end) return "expired";
  if (start !== null && now < start) return "upcoming";
  if (offer.requiresCode && earn !== null && now > earn && redeem !== null)
    return "codeOnly";
  return "active";
}

export function validReward(offer: RewardOffer, approved: boolean): boolean {
  if (!offer || typeof offer !== "object") return false;
  if (
    ![
      "id",
      "title",
      "description",
      "kind",
      "edition",
      "sourceUrl",
      "claimUrl",
    ].every((key) => typeof offer[key as keyof RewardOffer] === "string")
  )
    return false;
  if (
    !offer.id ||
    offer.id.length > 128 ||
    Array.from(offer.title).length > 200 ||
    Array.from(offer.description).length > 4000 ||
    !["cape", "skin", "addon", "other"].includes(offer.kind) ||
    !["java", "bedrock", "both", "other", "unknown"].includes(offer.edition) ||
    typeof offer.requiresCode !== "boolean" ||
    typeof offer.noEndDate !== "boolean"
  )
    return false;
  if (
    (offer.sourceUrl && !officialRewardUrl(offer.sourceUrl)) ||
    (offer.claimUrl && !safeCommunityUrl(offer.claimUrl))
  )
    return false;
  for (const date of [offer.startsAt, offer.earnUntil, offer.redeemUntil]) {
    if (
      date !== null &&
      (typeof date !== "string" || rewardDate(date) === null)
    )
      return false;
  }
  if (
    (!offer.requiresCode && offer.redeemUntil) ||
    (offer.noEndDate && (offer.earnUntil || offer.redeemUntil))
  )
    return false;
  const start = rewardDate(offer.startsAt);
  const earn = rewardDate(offer.earnUntil, true);
  const redeem = rewardDate(offer.redeemUntil, true);
  if (
    (start !== null && earn !== null && start > earn) ||
    (start !== null && redeem !== null && start > redeem) ||
    (earn !== null && redeem !== null && earn > redeem)
  )
    return false;
  return (
    !approved ||
    Boolean(
      offer.title.trim() &&
      offer.description.trim() &&
      offer.edition !== "unknown" &&
      officialRewardUrl(offer.sourceUrl) &&
      safeCommunityUrl(offer.claimUrl) &&
      (offer.noEndDate || offer.earnUntil || offer.redeemUntil)
    )
  );
}

export function validCommunityLink(link: CommunityLink): boolean {
  if (
    !link ||
    typeof link !== "object" ||
    !["id", "kind", "name", "description", "groupNumber", "url"].every(
      (key) => typeof link[key as keyof CommunityLink] === "string"
    )
  )
    return false;
  return Boolean(
    link.id &&
    (link.section === undefined ||
      ["sau", "universities"].includes(link.section)) &&
    link.id.length <= 128 &&
    ["qq", "website"].includes(link.kind) &&
    Array.from(link.name).length <= 120 &&
    Array.from(link.description).length <= 1000 &&
    typeof link.enabled === "boolean" &&
    (!link.url || safeCommunityUrl(link.url)) &&
    (!link.groupNumber || /^\d{5,12}$/.test(link.groupNumber)) &&
    (!link.enabled ||
      (link.name.trim() && (link.kind === "qq" ? link.groupNumber : link.url)))
  );
}

export function parseCommunityFeed(value: unknown): CommunityFeed | null {
  if (!value || typeof value !== "object") return null;
  const feed = value as CommunityFeed;
  if (
    feed.schemaVersion !== 1 ||
    !Array.isArray(feed.rewards) ||
    feed.rewards.length > 200 ||
    !Array.isArray(feed.links) ||
    feed.links.length > 60 ||
    !feed.rewards.every((offer) => validReward(offer, true)) ||
    !feed.links.every(validCommunityLink)
  )
    return null;
  const ids = [
    ...feed.rewards.map((offer) => offer.id),
    ...feed.links.map((link) => link.id),
  ];
  return new Set(ids).size === ids.length ? feed : null;
}
