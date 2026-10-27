import { useCallback, useEffect, useRef, useState } from "react";
import { CommunityFeed } from "@/models/community";
import {
  COMMUNITY_CHANGED_EVENT,
  CommunityService,
} from "@/services/community";

export function useCommunityFeed() {
  const [feed, setFeed] = useState<CommunityFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState(false);
  const [stale, setStale] = useState(false);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const refresh = useCallback(() => refreshRef.current?.(), []);

  useEffect(() => {
    let active = true;
    let pending = false;
    let lastRefresh = 0;
    const handleRefresh = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      setLoading(true);
      try {
        const result = await CommunityService.retrieveFeed();
        if (active) {
          setFeed(result.feed);
          setPreview(result.preview);
          setStale(result.stale);
          setFailed(false);
          lastRefresh = Date.now();
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    };
    refreshRef.current = handleRefresh;
    void handleRefresh();
    const timer = setInterval(() => void handleRefresh(), 15 * 60 * 1000);
    const handleVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRefresh > 15 * 60 * 1000
      )
        void handleRefresh();
    };
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener(COMMUNITY_CHANGED_EVENT, handleRefresh);
    return () => {
      active = false;
      refreshRef.current = null;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener(COMMUNITY_CHANGED_EVENT, handleRefresh);
    };
  }, []);

  return { feed, loading, failed, preview, stale, refresh };
}
