import { Flex, VStack } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { HomeTileBoard } from "@/components/common/home-tile";
import HomeWidgetContainer from "@/components/extension/home-widget-container";
import HomeButtonGroup from "@/components/home-button-group";
import HomeDateQuote from "@/components/home-date-quote";
import HomeRewardsCard from "@/components/home-rewards-card";
import HomeServersCard from "@/components/home-servers-card";
import LaunchInterfaceB from "@/components/launch-interface-b";
import PlaytimeCalendarCard from "@/components/playtime-calendar-card";
import { useLauncherConfig } from "@/contexts/config";
import { HOME_TILE_DEFINITIONS } from "@/models/home-tiles";

const LaunchPage = () => {
  const { config } = useLauncherConfig();
  return config.appearance.theme.launchInterface === "b" ? (
    <LaunchInterfaceB />
  ) : (
    <LaunchInterfaceA />
  );
};

const LaunchInterfaceA = () => {
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
