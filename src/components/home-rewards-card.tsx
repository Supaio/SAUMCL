import {
  Badge,
  Box,
  Button,
  Divider,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuExternalLink, LuGift } from "react-icons/lu";
import { CommonIconButton } from "@/components/common/common-icon-button";
import { HomeTile } from "@/components/common/home-tile";
import { useToast } from "@/contexts/toast";
import { useCommunityFeed } from "@/hooks/use-community-feed";
import { rewardState, safeCommunityUrl } from "@/utils/community";

const HomeRewardsCard = () => {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { feed, loading, failed, preview, stale, refresh } = useCommunityFeed();
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = setInterval(update, 30000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const offers = (now ? (feed?.rewards ?? []) : []).filter(
    (offer) => rewardState(offer, now) !== "expired"
  );
  const handleOpen = async (url: string) => {
    if (!safeCommunityUrl(url)) return;
    try {
      await openUrl(url);
    } catch {
      toast({ title: t("Community.openFailed"), status: "error" });
    }
  };
  const displayDate = (date: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? date
      : new Date(date).toLocaleString(i18n.language);
  return (
    <HomeTile
      tileId="home-rewards"
      title={t("HomeRewardsCard.title")}
      icon={LuGift}
      headerExtra={
        preview ? (
          <Badge colorScheme="orange">{t("Community.preview")}</Badge>
        ) : undefined
      }
      actions={
        <CommonIconButton
          icon="refresh"
          size="xs"
          isLoading={loading}
          onClick={() => void refresh()}
        />
      }
    >
      <VStack align="stretch" spacing={3}>
        {!offers.length && (
          <VStack id="home-rewards-empty" align="flex-start" spacing={2}>
            <Text fontSize="sm" className="secondary-text">
              {t(
                loading
                  ? "Community.loading"
                  : failed
                    ? "Community.loadFailed"
                    : "HomeRewardsCard.empty"
              )}
            </Text>
            <Button
              size="xs"
              variant="ghost"
              leftIcon={<Icon as={LuExternalLink} />}
              onClick={() =>
                void handleOpen("https://www.minecraft.net/en-us/articles")
              }
            >
              {t("HomeRewardsCard.officialNews")}
            </Button>
          </VStack>
        )}
        {offers.map((offer, index) => {
          const state = rewardState(offer, now);
          return (
            <Box key={offer.id} data-reward-id={offer.id}>
              {index > 0 && <Divider mb={3} />}
              <HStack spacing={2} mb={1} flexWrap="wrap">
                <Badge
                  colorScheme={
                    state === "codeOnly"
                      ? "orange"
                      : state === "upcoming"
                        ? "gray"
                        : "green"
                  }
                >
                  {t(`HomeRewardsCard.state.${state}`)}
                </Badge>
                <Badge colorScheme="blue">
                  {t(`Community.edition.${offer.edition}`)}
                </Badge>
                <Text fontSize="xs" className="secondary-text">
                  {t(`Community.kind.${offer.kind}`)}
                </Text>
              </HStack>
              <Text fontWeight="bold" fontSize="sm" overflowWrap="anywhere">
                {offer.title}
              </Text>
              <HStack mt={2} spacing={2} flexWrap="wrap">
                <Button
                  size="xs"
                  colorScheme="blue"
                  variant="outline"
                  rightIcon={<LuExternalLink />}
                  isDisabled={state === "upcoming"}
                  onClick={() => void handleOpen(offer.claimUrl)}
                >
                  {t(
                    state === "codeOnly"
                      ? "HomeRewardsCard.redeem"
                      : "HomeRewardsCard.claim"
                  )}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void handleOpen(offer.sourceUrl)}
                >
                  {t("HomeRewardsCard.rules")}
                </Button>
              </HStack>
              <Text
                fontSize="xs"
                mt={1}
                whiteSpace="pre-wrap"
                overflowWrap="anywhere"
              >
                {offer.description}
              </Text>
              {state === "codeOnly" && (
                <Text color="orange.500" fontWeight="bold" fontSize="xs" mt={1}>
                  {t("HomeRewardsCard.codeOnlyHint")}
                </Text>
              )}
              <VStack align="stretch" spacing={0.5} mt={2}>
                {[
                  ["startsAt", offer.startsAt],
                  ["earnUntil", offer.earnUntil],
                  ["redeemUntil", offer.redeemUntil],
                ].map(
                  ([key, date]) =>
                    date && (
                      <Text key={key} fontSize="xs" className="secondary-text">
                        {t(`Community.fields.${key}`)}：{displayDate(date)}
                      </Text>
                    )
                )}
                {offer.noEndDate && (
                  <Text fontSize="xs" className="secondary-text">
                    {t("HomeRewardsCard.noEndDate")}
                  </Text>
                )}
              </VStack>
            </Box>
          );
        })}
        {offers.length > 0 && (
          <Text fontSize="xs" className="secondary-text">
            {t("HomeRewardsCard.rulesHint")}
          </Text>
        )}
        {(failed || stale) && feed && (
          <Text fontSize="xs" color="orange.400">
            {t("Community.stale")}
          </Text>
        )}
      </VStack>
    </HomeTile>
  );
};

export default HomeRewardsCard;
