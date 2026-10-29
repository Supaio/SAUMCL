import {
  Badge,
  Box,
  Button,
  Card,
  HStack,
  Heading,
  Icon,
  Image,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { LuCopy, LuExternalLink, LuLink, LuUsersRound } from "react-icons/lu";
import { CommonIconButton } from "@/components/common/common-icon-button";
import { useToast } from "@/contexts/toast";
import { useCommunityFeed } from "@/hooks/use-community-feed";
import { safeCommunityUrl } from "@/utils/community";
import { copyText } from "@/utils/copy";

const COMMUNITY_LOGOS: Record<string, string> = {
  "saumcl-gitlab": "/images/icons/saumcl.png",
  "supaio-gitlab": "/images/community/supaio-avatar.jpg",
  "saumcl-github": "/images/icons/saumcl.png",
  "supaio-github": "/images/community/supaio-avatar.jpg",
  "university-sau": "/images/community/clmc-logo.png",
  "sau-oopz": "/images/community/oopz-logo.png",
  "sau-website": "/images/community/chrome-logo.svg",
};

const FriendsPage = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { feed, loading, failed, preview, stale, refresh } = useCommunityFeed();
  const links = feed?.links.filter((link) => link.enabled) ?? [];
  const sections = [
    {
      id: "sau",
      links: links.filter((link) => (link.section ?? "sau") === "sau"),
    },
    {
      id: "universities",
      links: links
        .filter((link) => link.section === "universities")
        .sort((a, b) =>
          a.name.localeCompare(b.name, "en", { sensitivity: "base" })
        ),
    },
  ];
  const handleOpen = async (url: string) => {
    if (!safeCommunityUrl(url)) return;
    try {
      await openUrl(url);
    } catch {
      toast({ title: t("Community.openFailed"), status: "error" });
    }
  };
  const handleCopy = async (group: string) => {
    await copyText(group, { toast });
  };
  return (
    <VStack id="friends-page" p={5} align="stretch" spacing={5}>
      <HStack justify="space-between">
        <HStack spacing={3}>
          <Icon as={LuLink} color="blue.400" boxSize={6} />
          <Heading size="md">{t("FriendsPage.title")}</Heading>
          {preview && (
            <Badge colorScheme="orange">{t("Community.preview")}</Badge>
          )}
        </HStack>
        <CommonIconButton
          icon="refresh"
          isLoading={loading}
          onClick={() => void refresh()}
        />
      </HStack>
      <Text fontSize="sm" className="secondary-text">
        {t("FriendsPage.description")}
      </Text>
      {!links.length && (
        <Card id="friends-empty" p={8}>
          <VStack spacing={3}>
            <Icon as={LuUsersRound} boxSize={10} color="blue.300" />
            <Text fontWeight="bold">
              {t(
                loading
                  ? "Community.loading"
                  : failed
                    ? "Community.loadFailed"
                    : "FriendsPage.empty"
              )}
            </Text>
            <Text fontSize="sm" className="secondary-text">
              {t("FriendsPage.emptyHint")}
            </Text>
          </VStack>
        </Card>
      )}
      {sections.map(
        (section) =>
          section.links.length > 0 && (
            <VStack
              key={section.id}
              id={`friends-section-${section.id}`}
              align="stretch"
              spacing={3}
            >
              <Heading size="sm">
                {t(`FriendsPage.sections.${section.id}`)}
              </Heading>
              <SimpleGrid columns={{ base: 1, lg: 2, "2xl": 3 }} spacing={4}>
                {section.links.map((link) => (
                  <Card key={link.id} p={4} data-community-link={link.id}>
                    <VStack align="stretch" spacing={3}>
                      <HStack>
                        {COMMUNITY_LOGOS[link.id] ? (
                          <Box
                            boxSize={10}
                            flexShrink={0}
                            overflow="hidden"
                            borderRadius={
                              link.id === "university-sau" ||
                              link.id === "supaio-gitlab" ||
                              link.id === "supaio-github"
                                ? "full"
                                : "md"
                            }
                          >
                            <Image
                              src={COMMUNITY_LOGOS[link.id]}
                              alt={link.name}
                              // Frame the supplied community image around its outer circle.
                              w={
                                link.id === "university-sau" ? "178.7%" : "100%"
                              }
                              h={link.id === "university-sau" ? "auto" : "100%"}
                              maxW="none"
                              objectFit="contain"
                              transform={
                                link.id === "university-sau"
                                  ? "translate(-19.5%, -4.6%)"
                                  : undefined
                              }
                            />
                          </Box>
                        ) : (
                          <Icon
                            as={link.kind === "qq" ? LuUsersRound : LuLink}
                            color="blue.400"
                          />
                        )}
                        <Text fontWeight="bold" overflowWrap="anywhere">
                          {link.name}
                        </Text>
                        <Badge ml="auto">
                          {t(`FriendsPage.kind.${link.kind}`)}
                        </Badge>
                      </HStack>
                      {link.description && (
                        <Text
                          fontSize="sm"
                          whiteSpace="pre-wrap"
                          overflowWrap="anywhere"
                        >
                          {link.description}
                        </Text>
                      )}
                      {link.kind === "qq" && (
                        <Text fontSize="sm" className="secondary-text">
                          {t("FriendsPage.groupNumber", {
                            number: link.groupNumber,
                          })}
                        </Text>
                      )}
                      <HStack mt="auto" flexWrap="wrap">
                        {link.kind === "qq" && (
                          <Button
                            size="sm"
                            variant="outline"
                            leftIcon={<LuCopy />}
                            onClick={() => void handleCopy(link.groupNumber)}
                          >
                            {t("FriendsPage.copyGroup")}
                          </Button>
                        )}
                        {link.url && (
                          <Button
                            size="sm"
                            colorScheme="blue"
                            variant="ghost"
                            rightIcon={<LuExternalLink />}
                            onClick={() => void handleOpen(link.url)}
                          >
                            {t(
                              link.kind === "qq"
                                ? "FriendsPage.join"
                                : "FriendsPage.visit"
                            )}
                          </Button>
                        )}
                      </HStack>
                    </VStack>
                  </Card>
                ))}
              </SimpleGrid>
            </VStack>
          )
      )}
      {(failed || stale) && feed && (
        <Text fontSize="xs" color="orange.400">
          {t("Community.stale")}
        </Text>
      )}
    </VStack>
  );
};

export default FriendsPage;
