import { Box, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import HomeGlobe from "@/components/home-globe";
import { useLauncherConfig } from "@/contexts/config";

const FALLBACK_QUOTE = "世界是方的，创造没有边界。";

const HomeDateQuote = () => {
  const { t } = useTranslation();
  const { config } = useLauncherConfig();
  const [now, setNow] = useState<Date | null>(null);
  const [quotes, setQuotes] = useState([FALLBACK_QUOTE]);

  useEffect(() => {
    let active = true;
    const refresh = () => setNow(new Date());
    refresh();
    const timer = setInterval(refresh, 1000);
    const handleVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", handleVisible);
    void fetch("/minecraft-quotes.txt")
      .then((response) => {
        if (!response.ok) throw new Error("Quote file unavailable");
        return response.text();
      })
      .then((text) => {
        const lines = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"));
        if (active && lines.length) setQuotes(lines);
      })
      .catch(() => {
        /* Keep the bundled fallback sentence. */
      });
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, []);

  const utc8 = now ? new Date(now.getTime() + 8 * 3600000) : null;
  const key = utc8 ? utc8.toISOString().slice(0, 10) : "";
  const time = utc8 ? utc8.toISOString().slice(11, 19) : "";
  const date = utc8
    ? `${utc8.getUTCFullYear()}年${String(utc8.getUTCMonth() + 1).padStart(2, "0")}月${String(utc8.getUTCDate()).padStart(2, "0")}日`
    : "";
  const day = utc8 ? Math.floor(utc8.getTime() / 86400000) : 0;

  return (
    <Box
      id="home-date-quote"
      w={{ base: "100%", xl: "280px" }}
      flexShrink={0}
      alignSelf={{ base: "stretch", xl: "flex-start" }}
      textAlign="right"
      color="white"
      textShadow="0 2px 6px rgba(0, 0, 0, 0.65)"
      py={{ base: 1, xl: 4 }}
      px={1}
    >
      <Text
        id="home-current-date"
        as="time"
        display="block"
        dateTime={key || undefined}
        aria-label={t("HomeDateQuote.date", { date })}
        fontSize={{ base: "xl", xl: "2xl" }}
        fontWeight="semibold"
        whiteSpace="nowrap"
      >
        {date || "\u00a0"}
      </Text>
      <Text
        id="home-current-time"
        as="time"
        display="block"
        dateTime={key && time ? `${key}T${time}+08:00` : undefined}
        aria-label={t("HomeDateQuote.time", { time })}
        fontSize={{ base: "sm", xl: "md" }}
        fontWeight="medium"
        letterSpacing="0.04em"
        whiteSpace="nowrap"
        mt={1}
      >
        {time ? `${time} UTC+8` : "\u00a0"}
      </Text>
      <Text
        id="home-minecraft-quote"
        aria-label={t("HomeDateQuote.quote")}
        fontSize="sm"
        lineHeight="tall"
        mt={1}
        overflowWrap="anywhere"
      >
        {quotes[day % quotes.length]}
      </Text>
      {config.appearance.theme.showHomeGlobe && <HomeGlobe />}
    </Box>
  );
};

export default HomeDateQuote;
