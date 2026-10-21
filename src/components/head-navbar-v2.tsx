import {
  Box,
  Divider,
  Flex,
  HStack,
  Icon,
  Image,
  Text,
  Tooltip,
  useBreakpointValue,
  useColorModeValue,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { IconType } from "react-icons";
import {
  LuBox,
  LuCircleUserRound,
  LuCompass,
  LuSearch,
  LuSettings,
  LuZap,
} from "react-icons/lu";
import AdvancedCard from "@/components/common/advanced-card";
import { DownloadIndicator } from "@/components/download-indicator";
import { TitleShort } from "@/components/logo-title";
import { useLauncherConfig } from "@/contexts/config";
import { useSharedModals } from "@/contexts/shared-modal";
import { useTaskContext } from "@/contexts/task";
import styles from "@/styles/head-navbar.module.css";

const HeadNavBar = () => {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const { config } = useLauncherConfig();
  const { openSharedModal } = useSharedModals();
  const { tasks } = useTaskContext();

  const primaryColor = config.appearance.theme.primaryColor;
  const headNavStyle = config.appearance.theme.headNavStyle;
  const isCompactLayout =
    useBreakpointValue({ base: true, lg: false }) ?? false;
  const isSimplified =
    headNavStyle === "simplified" ||
    (headNavStyle === "adaptive" && isCompactLayout);
  const isDownloadIndicatorShown = tasks.length > 0;

  const [isAnimating, setIsAnimating] = useState(false);
  const [indicator, setIndicator] = useState({
    top: 0,
    height: 0,
    visible: false,
  });
  const navListRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // tab color settings (we do not use chakra's Tab here because lack of dark style support and indicator animation)
  const unselectTabColor = useColorModeValue("gray.600", "gray.400");
  const selectedTextColor = useColorModeValue(
    `${primaryColor}.700`,
    `${primaryColor}.100`
  );
  const indicatorBg = useColorModeValue(
    `var(--chakra-colors-${primaryColor}-100)`,
    `var(--chakra-colors-${primaryColor}-700)`
  );
  const indicatorBorder = useColorModeValue(
    `var(--chakra-colors-${primaryColor}-200)`,
    `var(--chakra-colors-${primaryColor}-500)`
  );
  const hoverBg = useColorModeValue(
    `var(--chakra-colors-${primaryColor}-50)`,
    "rgba(255, 255, 255, 0.08)"
  );

  const navList = useMemo<
    Array<{
      icon: IconType;
      label: string;
      path?: string;
      onClick?: () => void;
    }>
  >(() => {
    const discoverPageMode = config.general.functionality.discoverPage;

    return [
      { icon: LuZap, label: "launch", path: "/launch" },
      { icon: LuBox, label: "instances", path: "/instances" },
      { icon: LuCircleUserRound, label: "accounts", path: "/accounts" },
      ...(discoverPageMode === "on"
        ? [{ icon: LuCompass, label: "discover", path: "/discover" }]
        : discoverPageMode === "search-only"
          ? [
              {
                icon: LuSearch,
                label: "search",
                onClick: () => openSharedModal("spotlight-search"),
              },
            ]
          : []),
      { icon: LuSettings, label: "settings", path: "/settings" },
    ];
  }, [config.general.functionality.discoverPage, openSharedModal]);

  // animation trigger
  useEffect(() => {
    setIsAnimating(true);
    const timer = setTimeout(() => setIsAnimating(false), 700);
    return () => clearTimeout(timer);
  }, [
    config.appearance.theme.useLiquidGlassDesign,
    isDownloadIndicatorShown,
    isSimplified,
  ]);

  const selectedIndex = navList.findIndex(
    (item) => item.path && router.pathname.startsWith(item.path)
  );

  const updateIndicator = useCallback(() => {
    if (selectedIndex < 0) {
      setIndicator((prev) =>
        prev.visible ? { ...prev, visible: false } : prev
      );
      return;
    }

    const listEl = navListRef.current;
    const selectedEl = tabRefs.current[selectedIndex];
    if (!listEl || !selectedEl) {
      setIndicator((prev) =>
        prev.visible ? { ...prev, visible: false } : prev
      );
      return;
    }

    const nextTop = selectedEl.offsetTop;
    const nextHeight = selectedEl.offsetHeight;

    setIndicator((prev) => {
      if (prev.visible && prev.top === nextTop && prev.height === nextHeight) {
        return prev;
      }
      return {
        top: nextTop,
        height: nextHeight,
        visible: true,
      };
    });
  }, [selectedIndex]);

  // indicator position update trigger
  useLayoutEffect(() => {
    updateIndicator();
  }, [updateIndicator, isSimplified, i18n.resolvedLanguage]);

  useEffect(() => {
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [updateIndicator]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      updateIndicator();
    });
    if (navListRef.current) {
      observer.observe(navListRef.current);
    }
    tabRefs.current.forEach((el) => {
      if (el) {
        observer.observe(el);
      }
    });

    return () => observer.disconnect();
  }, [updateIndicator, isSimplified, i18n.resolvedLanguage]);

  const handleTabChange = (index: number) => {
    const target = navList[index];
    if (target) {
      if (target.onClick) {
        target.onClick();
      } else if (target.path) {
        router.push(target.path);
      }
    }
  };

  return (
    <Flex
      as="aside"
      w={isSimplified ? "88px" : "200px"}
      flexShrink={0}
      minH={0}
      p={4}
      pr={0}
    >
      <AdvancedCard
        level="back"
        w="100%"
        minH={0}
        p={2}
        className={`animated-card ${isAnimating ? "animate" : ""}`}
      >
        <Flex direction="column" gap={4} h="100%" minH={0}>
          <HStack
            justify={isSimplified ? "center" : "flex-start"}
            px={2}
            py={2}
          >
            <Image src="/images/icons/saumcl.png" alt="SAUMCL" boxSize="28px" />
            {!isSimplified && <TitleShort fontSize="lg" />}
          </HStack>
          <Divider />
          <Flex
            ref={navListRef}
            direction="column"
            gap={2}
            flex="1"
            minH={0}
            overflowY="auto"
            role="tablist"
            aria-orientation="vertical"
            className={styles.tabList}
            style={
              {
                "--head-nav-indicator-bg": indicatorBg,
                "--head-nav-indicator-border": indicatorBorder,
                "--head-nav-hover-bg": hoverBg,
              } as CSSProperties
            }
          >
            <Box
              className={`${styles.indicator} ${indicator.visible ? styles.indicatorVisible : ""}`}
              transform={`translateY(${indicator.top}px)`}
              h={`${indicator.height}px`}
            />
            {navList.map((item, index) => {
              const isSelected = selectedIndex === index;
              return (
                <Tooltip
                  key={`${item.label}-${item.path ?? "action"}`}
                  label={t(`HeadNavBar.navList.${item.label}`)}
                  placement="right"
                  isDisabled={!isSimplified}
                >
                  <Box
                    as="button"
                    ref={(el: HTMLButtonElement | null) => {
                      tabRefs.current[index] = el;
                    }}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    aria-label={t(`HeadNavBar.navList.${item.label}`)}
                    onClick={() => handleTabChange(index)}
                    fontWeight={isSelected ? "600" : "normal"}
                    color={isSelected ? selectedTextColor : unselectTabColor}
                    className={styles.tabButton}
                  >
                    <HStack
                      id={`head-navbar-tab-${item.label}`}
                      justify={isSimplified ? "center" : "flex-start"}
                      spacing={3}
                      w="100%"
                      className={styles.tabContent}
                    >
                      <Icon
                        as={item.icon}
                        boxSize={4}
                        className={styles.tabIcon}
                      />
                      {!isSimplified && (
                        <Text fontSize="sm" lineHeight="1">
                          {t(`HeadNavBar.navList.${item.label}`)}
                        </Text>
                      )}
                    </HStack>
                  </Box>
                </Tooltip>
              );
            })}
          </Flex>
          {isDownloadIndicatorShown && (
            <>
              <Divider borderColor="var(--chakra-colors-chakra-placeholder-color)" />
              <Flex justify="center" pb={1}>
                <DownloadIndicator />
              </Flex>
            </>
          )}
        </Flex>
      </AdvancedCard>
    </Flex>
  );
};

export default HeadNavBar;
