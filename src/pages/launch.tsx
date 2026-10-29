import { Button, Flex, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HomeTileBoard } from "@/components/common/home-tile";
import HomeWidgetContainer from "@/components/extension/home-widget-container";
import HomeButtonGroup from "@/components/home-button-group";
import HomeDateQuote from "@/components/home-date-quote";
import HomeRewardsCard from "@/components/home-rewards-card";
import HomeServersCard from "@/components/home-servers-card";
import PlaytimeCalendarCard from "@/components/playtime-calendar-card";
import { HOME_TILE_DEFINITIONS } from "@/models/home-tiles";

const LaunchPage = () => {
  const router = useRouter();
  const { t } = useTranslation();
  const layoutRef = useRef<HTMLDivElement>(null);
  const [maxWidgetWidth, setMaxWidgetWidth] = useState<number>(550);

  useEffect(() => {
    const layoutEl = layoutRef.current;
    if (!layoutEl) return;

    const updateMaxWidgetWidth = () => {
      const spacing = 88; // main layout padding + spacing
      const minButtonGroupWidth =
        document.getElementById("main-launch-button")?.getBoundingClientRect()
          .width ?? 14.5 * 16;
      const available = layoutEl.clientWidth - minButtonGroupWidth - spacing;
      const safeMax = Math.max(0, available);
      setMaxWidgetWidth(safeMax);
    };

    updateMaxWidgetWidth();
    const observer = new ResizeObserver(updateMaxWidgetWidth);
    observer.observe(layoutEl);
    const buttonGroupEl = document.getElementById("home-button-group");
    if (buttonGroupEl) observer.observe(buttonGroupEl);
    return () => observer.disconnect();
  }, []);

  return (
    <Flex ref={layoutRef} p={7} pt={1} h="100%" gap={6} direction="column">
      <Button
        size="xs"
        alignSelf="flex-start"
        onClick={() => void router.push("/standalone/ui-preview")}
      >
        {t("ShadcnPreview.try")}
      </Button>
      <VStack
        align="stretch"
        spacing={4}
        w="100%"
        minW={0}
        minH={0}
        flex={1}
        overflow="hidden"
      >
        <Flex
          w="100%"
          minW={0}
          minH={0}
          flex={1}
          gap={4}
          direction={{ base: "column-reverse", xl: "row" }}
        >
          <HomeTileBoard definitions={HOME_TILE_DEFINITIONS}>
            <HomeServersCard />
            <PlaytimeCalendarCard />
            <HomeRewardsCard />
          </HomeTileBoard>
          <HomeDateQuote />
        </Flex>
        <HomeWidgetContainer maxWidth={maxWidgetWidth} />
      </VStack>

      <Flex justify="flex-end" align="flex-end" minW="14.5rem" flexShrink={0}>
        <HomeButtonGroup />
      </Flex>
    </Flex>
  );
};

export default LaunchPage;
