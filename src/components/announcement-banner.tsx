import {
  Button,
  HStack,
  Icon,
  Text,
  useColorModeValue,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuMegaphone } from "react-icons/lu";
import { useLauncherConfig } from "@/contexts/config";
import { useSharedModals } from "@/contexts/shared-modal";
import {
  CAMPUS_PROFILE_UPDATED_EVENT,
  HomeServersService,
} from "@/services/home-servers";
import { CAMPUS_PREVIEW_CHANGED_EVENT } from "@/services/maintenance";
import { parseCampusProfile } from "@/utils/home-servers";

const AnnouncementBanner = () => {
  const { t } = useTranslation();
  const { config } = useLauncherConfig();
  const { openGenericConfirmDialog } = useSharedModals();
  const [message, setMessage] = useState("");
  const color = config.appearance.theme.primaryColor;
  const background = useColorModeValue(`${color}.50`, `${color}.900`);
  const foreground = useColorModeValue(`${color}.800`, `${color}.100`);
  const border = useColorModeValue(`${color}.100`, `${color}.700`);

  useEffect(() => {
    const receive = (event: Event) => {
      const profile = parseCampusProfile((event as CustomEvent).detail);
      if (profile) setMessage(profile.announcement.trim());
    };
    const refresh = (force = false) => {
      if (!force && document.visibilityState === "hidden") return;
      void HomeServersService.retrieveCampus(force).catch(() => {
        // Keep the last readable announcement if all sources are unavailable.
      });
    };
    const previewChanged = () => {
      setMessage("");
      refresh(true);
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener(CAMPUS_PROFILE_UPDATED_EVENT, receive);
    window.addEventListener(CAMPUS_PREVIEW_CHANGED_EVENT, previewChanged);
    document.addEventListener("visibilitychange", visible);
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => {
      clearInterval(timer);
      window.removeEventListener(CAMPUS_PROFILE_UPDATED_EVENT, receive);
      window.removeEventListener(CAMPUS_PREVIEW_CHANGED_EVENT, previewChanged);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  if (!message) return null;

  return (
    <HStack
      id="announcement-banner"
      role="status"
      aria-live="polite"
      aria-label={t("AnnouncementBanner.title")}
      flexShrink={0}
      minH="40px"
      px={4}
      py={1.5}
      spacing={2.5}
      bg={background}
      color={foreground}
      borderBottomWidth="1px"
      borderColor={border}
      minW={0}
      data-cow-scene-obstacle="rect"
    >
      <Icon as={LuMegaphone} flexShrink={0} aria-hidden />
      <Text fontSize="sm" fontWeight="semibold" flexShrink={0}>
        {t("AnnouncementBanner.title")}
      </Text>
      <Text
        id="announcement-banner-message"
        fontSize="sm"
        flex={1}
        minW={0}
        noOfLines={1}
        title={message}
      >
        {message}
      </Text>
      <Button
        id="announcement-banner-details"
        size="xs"
        variant="ghost"
        colorScheme={color}
        flexShrink={0}
        onClick={() =>
          openGenericConfirmDialog({
            title: t("AnnouncementBanner.title"),
            body: (
              <Text
                whiteSpace="pre-wrap"
                overflowWrap="anywhere"
                userSelect="text"
                maxH="55vh"
                overflowY="auto"
              >
                {message}
              </Text>
            ),
            btnOK: t("General.close"),
            btnCancel: "",
          })
        }
      >
        {t("AnnouncementBanner.details")}
      </Button>
    </HStack>
  );
};

export default AnnouncementBanner;
