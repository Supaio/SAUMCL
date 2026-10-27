import {
  Badge,
  Box,
  Divider,
  HStack,
  Icon,
  SimpleGrid,
  Spinner,
  Text,
  Tooltip,
  VStack,
  useColorModeValue,
} from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuCalendarDays, LuInfo } from "react-icons/lu";
import { CommonIconButton } from "@/components/common/common-icon-button";
import { HomeTile } from "@/components/common/home-tile";
import { PlaytimeStats } from "@/models/playtime";
import { PlaytimeService } from "@/services/playtime";
import {
  playtimeDuration,
  playtimeMonth,
  summarizePlaytime,
} from "@/utils/playtime";

const PlaytimeCalendarCard = () => {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState<PlaytimeStats | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const dayBackground = useColorModeValue("blackAlpha.50", "whiteAlpha.100");
  const playedBackground = useColorModeValue("blue.100", "blue.800");

  useEffect(() => {
    let active = true;
    let pending = false;
    const handleRefresh = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      setLoading(true);
      setNow(new Date());
      try {
        const next = await PlaytimeService.retrieveStats();
        if (active) {
          setStats(next);
          setFailed(false);
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
    const timer = setInterval(() => void handleRefresh(), 30000);
    const handleVisible = () => {
      if (document.visibilityState === "visible") void handleRefresh();
    };
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisible);
      refreshRef.current = null;
    };
  }, []);

  const summary = stats && now ? summarizePlaytime(stats, now) : null;
  const month = stats && now ? playtimeMonth(now, stats.dailySeconds) : [];
  const duration = (seconds: number) =>
    t("PlaytimeCalendarCard.duration", playtimeDuration(seconds));
  const weekdays = Array.from({ length: 7 }, (_, day) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: "narrow" }).format(
      new Date(2026, 0, 5 + day, 12)
    )
  );

  return (
    <HomeTile
      tileId="playtime-calendar"
      title={t("PlaytimeCalendarCard.title")}
      icon={LuCalendarDays}
      actions={
        <HStack spacing={1}>
          {stats && stats.activeSessions > 0 && (
            <Badge colorScheme="green">
              {t("PlaytimeCalendarCard.playing")}
            </Badge>
          )}
          {loading && <Spinner size="xs" />}
          <CommonIconButton
            icon="refresh"
            size="xs"
            isDisabled={loading}
            onClick={() => void refreshRef.current?.()}
          />
        </HStack>
      }
    >
      {stats && now && summary ? (
        <VStack align="stretch" spacing={2} h="100%">
          <Text fontSize="sm" fontWeight="semibold" flexShrink={0}>
            {new Intl.DateTimeFormat(i18n.language, {
              year: "numeric",
              month: "long",
            }).format(now)}
          </Text>
          <SimpleGrid
            columns={7}
            templateRows={`auto repeat(${Math.ceil(month.length / 7)}, minmax(18px, 1fr))`}
            flex={1}
            flexShrink={0}
            spacing={1}
            textAlign="center"
            fontSize="xs"
            aria-label={t("PlaytimeCalendarCard.monthLabel")}
          >
            {weekdays.map((label, index) => (
              <Text key={`weekday-${index}`} className="secondary-text" mb={1}>
                {label}
              </Text>
            ))}
            {month.map((day, index) =>
              day ? (
                <Tooltip
                  key={day.key}
                  label={`${day.key} · ${duration(day.seconds)}`}
                >
                  <Box
                    as="span"
                    tabIndex={0}
                    aria-label={`${day.key} · ${duration(day.seconds)}`}
                    data-date={day.key}
                    data-played={day.seconds > 0 ? "true" : "false"}
                    minH="18px"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    borderRadius="md"
                    borderWidth="1px"
                    borderColor={day.today ? "blue.400" : "transparent"}
                    fontWeight={day.today ? "bold" : "normal"}
                    bg={
                      day.seconds >= 10800
                        ? "blue.500"
                        : day.seconds >= 3600
                          ? "blue.400"
                          : day.seconds > 0
                            ? playedBackground
                            : dayBackground
                    }
                    color={day.seconds >= 3600 ? "white" : undefined}
                  >
                    {day.day}
                  </Box>
                </Tooltip>
              ) : (
                <Box key={`empty-${index}`} h={6} />
              )
            )}
          </SimpleGrid>
          <Divider flexShrink={0} />
          <SimpleGrid columns={3} spacing={2} flexShrink={0}>
            {[
              { key: "today", seconds: summary.todaySeconds },
              { key: "week", seconds: summary.weekSeconds },
              { key: "total", seconds: summary.totalSeconds },
            ].map(({ key, seconds }) => (
              <Box key={key} minW={0}>
                <Text fontSize="xs" className="secondary-text">
                  {t(`PlaytimeCalendarCard.${key}`)}
                </Text>
                <Text
                  id={`playtime-${key}`}
                  fontSize="sm"
                  fontWeight="bold"
                  mt={1}
                >
                  {duration(seconds)}
                </Text>
                {(key === "week" || key === "total") && (
                  <Text
                    id={`playtime-${key}-days`}
                    fontSize="xs"
                    className="secondary-text"
                    mt={1}
                  >
                    {t(`PlaytimeCalendarCard.${key}Days`, {
                      count:
                        key === "week" ? summary.weekDays : summary.totalDays,
                    })}
                  </Text>
                )}
                {key === "total" && stats.historicalSeconds > 0 && (
                  <Text fontSize="xs" className="secondary-text" mt={1}>
                    {t("PlaytimeCalendarCard.includesHistory")}
                  </Text>
                )}
              </Box>
            ))}
          </SimpleGrid>
          <HStack spacing={1} flexShrink={0}>
            <Text fontSize="xs" className="secondary-text">
              {t("PlaytimeCalendarCard.localTime")}
            </Text>
            <Tooltip
              label={t("PlaytimeCalendarCard.trackingNote", {
                date: stats.trackingStartedAt,
              })}
            >
              <Box
                as="span"
                display="inline-flex"
                tabIndex={0}
                aria-label={t("PlaytimeCalendarCard.trackingNote", {
                  date: stats.trackingStartedAt,
                })}
              >
                <Icon as={LuInfo} boxSize={3} className="secondary-text" />
              </Box>
            </Tooltip>
          </HStack>
          {(failed || stats.saveFailed) && (
            <Text fontSize="xs" color="orange.400">
              {t(
                stats.saveFailed
                  ? "PlaytimeCalendarCard.saveFailed"
                  : "PlaytimeCalendarCard.refreshFailed"
              )}
            </Text>
          )}
        </VStack>
      ) : (
        <Text fontSize="sm" className="secondary-text">
          {t(
            failed
              ? "PlaytimeCalendarCard.loadFailed"
              : "PlaytimeCalendarCard.loading"
          )}
        </Text>
      )}
    </HomeTile>
  );
};

export default PlaytimeCalendarCard;
