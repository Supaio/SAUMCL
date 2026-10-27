import { Box, Card, HStack, Icon, Text } from "@chakra-ui/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { type IconType } from "react-icons";
import { LuGripVertical } from "react-icons/lu";
import {
  HOME_TILES_LAYOUT_KEY,
  HomeTileDefinition,
  HomeTileLayout,
  HomeTileOperation,
  HomeTilePreferences,
  HomeTileRect,
} from "@/models/home-tiles";
import cardStyles from "@/styles/card.module.css";
import {
  changeHomeTileRect,
  fitHomeTile,
  parseHomeTileLayout,
  resolveHomeTiles,
} from "@/utils/home-tiles";

interface HomeTileContextValue {
  tiles: HomeTileLayout;
  activeId: string | null;
  start: (
    event: ReactPointerEvent<HTMLDivElement>,
    id: string,
    operation: HomeTileOperation
  ) => void;
  keyDown: (
    event: ReactKeyboardEvent<HTMLDivElement>,
    id: string,
    operation: HomeTileOperation
  ) => void;
}
const HomeTileContext = createContext<HomeTileContextValue | null>(null);

export const HomeTileBoard = ({
  definitions,
  children,
}: {
  definitions: HomeTileDefinition[];
  children: ReactNode;
}) => {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [preferences, setPreferences] = useState<HomeTilePreferences>({});
  const [activeTile, setActiveTile] = useState<{
    id: string;
    rect: HomeTileRect;
  } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const boundsRef = useRef(bounds);
  const resolved = resolveHomeTiles(definitions, preferences, bounds);
  const tiles = activeTile
    ? { ...resolved.tiles, [activeTile.id]: activeTile.rect }
    : resolved.tiles;
  const resolvedRef = useRef(resolved);
  boundsRef.current = bounds;
  resolvedRef.current = resolved;

  const commit = (next: HomeTileLayout) => {
    setPreferences(next);
    try {
      localStorage.setItem(
        HOME_TILES_LAYOUT_KEY,
        JSON.stringify({ schemaVersion: 1, tiles: next })
      );
    } catch {
      /* Keep the current session's layout. */
    }
  };

  useEffect(() => {
    let stored: HomeTilePreferences = {};
    try {
      stored = parseHomeTileLayout(
        JSON.parse(localStorage.getItem(HOME_TILES_LAYOUT_KEY) || "null")
      );
    } catch {
      /* Start with the default layout. */
    }
    for (const definition of definitions) {
      if (!stored[definition.id] && definition.legacySizeKey) {
        try {
          const legacy = JSON.parse(
            localStorage.getItem(definition.legacySizeKey) || "null"
          );
          const imported = parseHomeTileLayout({
            schemaVersion: 1,
            tiles: { [definition.id]: legacy },
          });
          if (imported[definition.id])
            stored[definition.id] = imported[definition.id];
        } catch {
          /* Use the tile's default size. */
        }
      }
    }
    setPreferences(stored);
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      const next = {
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      };
      if (
        next.width !== boundsRef.current.width ||
        next.height !== boundsRef.current.height
      ) {
        cleanupRef.current?.();
        setBounds(next);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      cleanupRef.current?.();
    };
  }, [definitions]);

  const start = (
    event: ReactPointerEvent<HTMLDivElement>,
    id: string,
    operation: HomeTileOperation
  ) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const definition = definitions.find((tile) => tile.id === id);
    const rect = resolvedRef.current.tiles[id];
    const viewport = viewportRef.current;
    if (!definition || !rect || !viewport) return;
    event.preventDefault();
    event.stopPropagation();
    cleanupRef.current?.();
    const startingLayout = resolvedRef.current.tiles;
    const others = Object.entries(startingLayout)
      .filter(([tileId]) => tileId !== id)
      .map(([, tile]) => tile);
    const origin = {
      x: event.clientX,
      y: event.clientY,
    };
    const pointerId = event.pointerId;
    const handle = event.currentTarget;
    const selection = document.body.style.userSelect;
    handle.setPointerCapture(pointerId);
    document.body.style.userSelect = "none";
    setActiveTile({ id, rect });
    const nextRect = (moveEvent: PointerEvent) =>
      changeHomeTileRect(
        rect,
        operation,
        moveEvent.clientX - origin.x,
        moveEvent.clientY - origin.y,
        definition,
        boundsRef.current,
        others
      );
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      document.body.style.userSelect = selection;
      cleanupRef.current = null;
      if (handle.hasPointerCapture(pointerId))
        handle.releasePointerCapture(pointerId);
    };
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId === pointerId)
        setActiveTile({ id, rect: nextRect(moveEvent) });
    };
    const end = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const next = nextRect(moveEvent);
      const placed =
        operation === "move"
          ? fitHomeTile(next, others, boundsRef.current)
          : next;
      if (
        placed &&
        (moveEvent.clientX !== origin.x || moveEvent.clientY !== origin.y)
      )
        commit({ ...startingLayout, [id]: placed });
      setActiveTile(null);
      cleanup();
    };
    const cancel = () => {
      setActiveTile(null);
      cleanup();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    cleanupRef.current = cancel;
  };

  const keyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    id: string,
    operation: HomeTileOperation
  ) => {
    const direction: Record<string, [number, number]> = {
      ArrowLeft: [-8, 0],
      ArrowRight: [8, 0],
      ArrowUp: [0, -8],
      ArrowDown: [0, 8],
    };
    const delta = direction[event.key];
    const definition = definitions.find((tile) => tile.id === id);
    const rect = resolvedRef.current.tiles[id];
    if (
      !delta ||
      !definition ||
      !rect ||
      cleanupRef.current ||
      (operation === "width" && !delta[0]) ||
      (operation === "height" && !delta[1])
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const others = Object.entries(resolved.tiles)
      .filter(([tileId]) => tileId !== id)
      .map(([, tile]) => tile);
    const next = changeHomeTileRect(
      rect,
      operation,
      ...delta,
      definition,
      bounds,
      others
    );
    const placed =
      operation === "move" ? fitHomeTile(next, others, bounds) : next;
    if (placed) commit({ ...resolved.tiles, [id]: placed });
  };

  return (
    <Box
      id="home-tile-board"
      ref={viewportRef}
      position="relative"
      w="100%"
      minW={0}
      minH={0}
      flex={1}
      overflow="hidden"
      aria-label={t("HomeTile.board")}
    >
      <Box position="relative" w="100%" h={`${resolved.height}px`}>
        <HomeTileContext.Provider
          value={{ tiles, activeId: activeTile?.id ?? null, start, keyDown }}
        >
          {children}
        </HomeTileContext.Provider>
      </Box>
    </Box>
  );
};

export const HomeTile = ({
  tileId,
  title,
  icon,
  headerExtra,
  actions,
  children,
}: {
  tileId: string;
  title: string;
  icon: IconType;
  headerExtra?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) => {
  const context = useContext(HomeTileContext);
  const { t } = useTranslation();
  if (!context) throw new Error("HomeTile must be inside HomeTileBoard");
  const rect = context.tiles[tileId];
  if (!rect) return null;
  const handleProps = (operation: HomeTileOperation) => ({
    tabIndex: 0,
    role: "button",
    "aria-label": t(`HomeTile.${operation}`, { title }),
    title: t(`HomeTile.${operation}`, { title }),
    sx: { touchAction: "none" },
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) =>
      context.start(event, tileId, operation),
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) =>
      context.keyDown(event, tileId, operation),
    _focusVisible: {
      outline: "2px solid",
      outlineColor: "blue.400",
      outlineOffset: "-2px",
    },
  });
  return (
    <Card
      id={`${tileId}-card`}
      data-home-tile={tileId}
      className={cardStyles["card-back"]}
      position="absolute"
      left={`${rect.x}px`}
      top={`${rect.y}px`}
      w={`${rect.width}px`}
      h={`${rect.height}px`}
      minW={0}
      p={4}
      overflow="hidden"
      zIndex={context.activeId === tileId ? 2 : 1}
    >
      <HStack
        justify="space-between"
        mb={3}
        flexShrink={0}
        minW={0}
        spacing={2}
      >
        <HStack
          id={`${tileId}-move-handle`}
          {...handleProps("move")}
          cursor={context.activeId === tileId ? "grabbing" : "grab"}
          flex={1}
          minW={0}
          spacing={2}
        >
          <Icon
            as={LuGripVertical}
            boxSize={3}
            className="secondary-text"
            flexShrink={0}
          />
          <Icon as={icon} color="blue.400" flexShrink={0} />
          <Text fontWeight="bold" noOfLines={1}>
            {title}
          </Text>
          {headerExtra}
        </HStack>
        {actions}
      </HStack>
      <Box flex={1} minW={0} minH={0} overflow="auto">
        {children}
      </Box>
      <Box
        id={`${tileId}-resize-width`}
        {...handleProps("width")}
        position="absolute"
        top={0}
        right={0}
        bottom="18px"
        w="8px"
        cursor="ew-resize"
      />
      <Box
        id={`${tileId}-resize-height`}
        {...handleProps("height")}
        position="absolute"
        left={0}
        right="18px"
        bottom={0}
        h="8px"
        cursor="ns-resize"
      />
      <Box
        id={`${tileId}-resize-corner`}
        {...handleProps("both")}
        position="absolute"
        right={0}
        bottom={0}
        boxSize="18px"
        cursor="nwse-resize"
      >
        <Box
          position="absolute"
          right="5px"
          bottom="5px"
          boxSize="7px"
          borderRight="2px solid"
          borderBottom="2px solid"
          borderColor="gray.400"
        />
      </Box>
    </Card>
  );
};
