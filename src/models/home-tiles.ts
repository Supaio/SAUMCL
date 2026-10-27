export interface HomeTileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HomeTileDefinition {
  id: string;
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  minHeight: number;
  legacySizeKey?: string;
}

export type HomeTilePreferences = Record<string, Partial<HomeTileRect>>;
export type HomeTileLayout = Record<string, HomeTileRect>;
export type HomeTileOperation = "move" | "width" | "height" | "both";

export const HOME_TILES_LAYOUT_KEY = "saumcl.homeTiles.layout";
export const HOME_TILE_DEFINITIONS: HomeTileDefinition[] = [
  {
    id: "home-servers",
    defaultWidth: 640,
    defaultHeight: 240,
    minWidth: 320,
    minHeight: 160,
    legacySizeKey: "saumcl.homeServersCard.size",
  },
  {
    id: "playtime-calendar",
    defaultWidth: 360,
    defaultHeight: 420,
    minWidth: 280,
    minHeight: 240,
  },
  {
    id: "home-rewards",
    defaultWidth: 360,
    defaultHeight: 230,
    minWidth: 280,
    minHeight: 160,
  },
];
