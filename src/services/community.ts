import { invoke } from "@tauri-apps/api/core";
import { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { CommunityDraft, CommunityFeed } from "@/models/community";
import { parseCommunityFeed } from "@/utils/community";

// Only reviewed public content is published to this shared static file.
const COMMUNITY_FEED_URLS = [
  "https://raw.githubusercontent.com/Supaio/SAUMCL/main/public/community.json",
  "https://gitlab.com/Supaio/saumcl/-/raw/main/public/community.json",
];
const CACHE_KEY = "saumcl.community.feed";
export const COMMUNITY_CHANGED_EVENT = "saumcl-community-changed";

export class CommunityService {
  static retrieveDraft(): Promise<CommunityDraft> {
    return invoke("retrieve_community_draft");
  }

  static collectCandidates(): Promise<CommunityDraft> {
    return invoke("collect_reward_candidates");
  }

  static saveDraft(draft: CommunityDraft): Promise<void> {
    return invoke("save_community_draft", { draft });
  }

  static exportFeed(draft: CommunityDraft, path: string): Promise<void> {
    return invoke("export_community_feed", { draft, path });
  }

  static async applyPreview(draft: CommunityDraft | null): Promise<void> {
    await invoke("apply_community_preview", { draft });
    window.dispatchEvent(new Event(COMMUNITY_CHANGED_EVENT));
  }

  static async retrieveFeed(): Promise<{
    feed: CommunityFeed;
    preview: boolean;
    stale: boolean;
  }> {
    const preview = parseCommunityFeed(
      await invoke("retrieve_community_preview").catch(() => null)
    );
    if (preview) return { feed: preview, preview: true, stale: false };
    for (const endpoint of COMMUNITY_FEED_URLS) {
      try {
        const response = await nativeFetch(endpoint, {
          headers: { "User-Agent": "SAUMCL", "Cache-Control": "no-cache" },
          connectTimeout: 10000,
        });
        if (!response.ok) throw new Error("COMMUNITY_FETCH_FAILED");
        const feed = parseCommunityFeed(await response.json());
        if (!feed) throw new Error("INVALID_COMMUNITY_FEED");
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(feed));
        } catch {
          /* Use the response without caching. */
        }
        return { feed, preview: false, stale: false };
      } catch {
        // Try the other repository before falling back to the cache.
      }
    }
    try {
      const feed = parseCommunityFeed(
        JSON.parse(localStorage.getItem(CACHE_KEY) || "null")
      );
      if (feed) return { feed, preview: false, stale: true };
    } catch {
      /* Use the bundled, reviewed list. */
    }
    const response = await fetch("/community.json", { cache: "no-store" });
    const feed = parseCommunityFeed(await response.json());
    if (!response.ok || !feed) throw new Error("INVALID_COMMUNITY_FEED");
    return { feed, preview: false, stale: true };
  }
}
