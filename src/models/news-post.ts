type ImageSrcUnion = [string, number, number];

export const COMMUNITY_NEWS_SOURCE_URL =
  "https://mc.sjtu.cn/api-sjmcl/article/mua";

export interface NewsPostSummary {
  title: string;
  abstract?: string;
  keywords?: string;
  imageSrc?: ImageSrcUnion;
  source: NewsSourceInfo;
  createAt: string;
  link: string;
}

export interface NewsSourceInfo {
  // News source metadata is supplied by the launcher-managed feed.
  name?: string;
  fullName?: string;
  endpointUrl: string; // If it only contains this field, it means the data source is offline or pending.
  iconSrc?: string;
}

export interface NewsPostRequest {
  url: string;
  cursor: number | null;
}
