export interface RewardOffer {
  id: string;
  title: string;
  description: string;
  kind: "cape" | "skin" | "addon" | "other";
  edition: "java" | "bedrock" | "both" | "other" | "unknown";
  sourceUrl: string;
  claimUrl: string;
  // An official calendar date, or an ISO timestamp with an explicit UTC offset.
  startsAt: string | null;
  earnUntil: string | null;
  redeemUntil: string | null;
  requiresCode: boolean;
  noEndDate: boolean;
}

export interface RewardDraft {
  offer: RewardOffer;
  status: "pending" | "approved" | "rejected";
  reviewedAt: string | null;
}

export interface CommunityLink {
  id: string;
  section?: "sau" | "universities";
  kind: "qq" | "website";
  name: string;
  description: string;
  groupNumber: string;
  url: string;
  enabled: boolean;
}

export interface CommunityFeed {
  schemaVersion: 1;
  rewards: RewardOffer[];
  links: CommunityLink[];
}

export interface CommunityDraft {
  schemaVersion: 1;
  lastCollectedAt: string | null;
  rewards: RewardDraft[];
  links: CommunityLink[];
}

export type RewardState = "upcoming" | "active" | "codeOnly" | "expired";
