import { Box } from "@chakra-ui/react";
import { KeyboardEvent, PointerEvent, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getSunPosition } from "@/utils/solar";

const SIZE = 400;
const MAP_WIDTH = 2048;
const MAP_HEIGHT = 1024;
const TAU = Math.PI * 2;
const ATMOSPHERE = [183, 221, 244];
const AXIS_TILT = (23.4 * Math.PI) / 180;
const INITIAL_LONGITUDE = (104 * Math.PI) / 180;
const ROTATION_SPEED = TAU / 120;
type MapLine = [number, number][];
type LandPolygon = MapLine[];

const HomeGlobe = () => {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const longitude = useRef(INITIAL_LONGITUDE);
  const drag = useRef<{ id: number; x: number } | null>(null);
  const redraw = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = SIZE;
    canvas.height = SIZE;
    let active = true;
    let frame = 0;
    let dirty = true;
    let previousTime: number | null = null;
    let lastPaint = 0;
    let solarSecond = -1;
    let sun = getSunPosition(Date.now());
    const controller = new AbortController();
    const map = document.createElement("canvas");
    map.width = MAP_WIDTH;
    map.height = MAP_HEIGHT;
    const mapContext = map.getContext("2d");
    if (!mapContext) return;
    mapContext.fillStyle = "#779fbd";
    mapContext.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    let texture = mapContext.getImageData(0, 0, MAP_WIDTH, MAP_HEIGHT).data;
    const image = context.createImageData(SIZE, SIZE);
    const pixels: {
      offset: number;
      longitude: number;
      row: number;
      rim: number;
      light: number;
      alpha: number;
      normalX: number;
      normalY: number;
      normalZ: number;
    }[] = [];
    const radius = SIZE / 2 - 3;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const nx = (x + 0.5 - SIZE / 2) / radius;
        const ny = (SIZE / 2 - y - 0.5) / radius;
        const distance = nx * nx + ny * ny;
        if (distance >= 1) continue;
        const z = Math.sqrt(1 - distance);
        // Fixed axial tilt and viewing angle. Only longitude changes when the
        // user rotates the globe; the poles cannot tumble with the pointer.
        const axialX = nx * Math.cos(AXIS_TILT) + ny * Math.sin(AXIS_TILT);
        const axialY = -nx * Math.sin(AXIS_TILT) + ny * Math.cos(AXIS_TILT);
        const latitude = Math.asin(Math.max(-1, Math.min(1, axialY)));
        pixels.push({
          offset: (y * SIZE + x) * 4,
          longitude: Math.atan2(axialX, z),
          row: Math.min(
            MAP_HEIGHT - 1,
            Math.floor((0.5 - latitude / Math.PI) * MAP_HEIGHT)
          ),
          rim: Math.pow(1 - z, 3) * 0.18,
          light: 0.68 + 0.32 * Math.max(0, -0.3 * nx + 0.45 * ny + 0.84 * z),
          alpha: Math.min(1, (1 - Math.sqrt(distance)) * radius),
          normalX: axialX,
          normalY: axialY,
          normalZ: z,
        });
      }
    }
    const draw = () => {
      // Express the real subsolar point in the current globe view. Lighting
      // stays attached to geographic locations during dragging and display spin.
      const delta = sun.longitude - longitude.current;
      const sunX = Math.cos(sun.declination) * Math.sin(delta);
      const sunY = Math.sin(sun.declination);
      const sunZ = Math.cos(sun.declination) * Math.cos(delta);
      for (const pixel of pixels) {
        const lon = longitude.current + pixel.longitude;
        const u = Math.floor(
          (((((lon + Math.PI) % TAU) + TAU) % TAU) / TAU) * MAP_WIDTH
        );
        const source = (pixel.row * MAP_WIDTH + u) * 4;
        const sunDot =
          pixel.normalX * sunX + pixel.normalY * sunY + pixel.normalZ * sunZ;
        const twilight = Math.max(0, Math.min(1, (sunDot + 0.05) / 0.1));
        const daylight = twilight * twilight * (3 - 2 * twilight);
        const light = pixel.light * (0.36 + 0.64 * daylight);
        const rim = pixel.rim * (0.45 + 0.55 * daylight);
        const boundary = Math.max(0, 1 - Math.abs(sunDot) / 0.008) * 0.4;
        for (let channel = 0; channel < 3; channel++) {
          const atmosphere = ATMOSPHERE[channel];
          const color =
            texture[source + channel] * light * (1 - rim) + atmosphere * rim;
          image.data[pixel.offset + channel] =
            color * (1 - boundary) + atmosphere * boundary;
        }
        image.data[pixel.offset + 3] = Math.round(255 * pixel.alpha);
      }
      context.putImageData(image, 0, 0);
    };
    const tick = (timestamp: number) => {
      if (!active || document.visibilityState === "hidden") return;
      const elapsed =
        previousTime === null
          ? 0
          : Math.min((timestamp - previousTime) / 1000, 0.1);
      previousTime = timestamp;
      const currentSolarSecond = Math.floor(Date.now() / 1000);
      if (currentSolarSecond !== solarSecond) {
        solarSecond = currentSolarSecond;
        sun = getSunPosition(currentSolarSecond * 1000);
        dirty = true;
      }
      if (!drag.current) {
        // Decreasing sampled longitude rotates the surface west-to-east.
        longitude.current =
          (longitude.current - ROTATION_SPEED * elapsed) % TAU;
        dirty = true;
      }
      if (dirty && timestamp - lastPaint >= 1000 / 30) {
        draw();
        dirty = false;
        lastPaint = timestamp;
      }
      frame = requestAnimationFrame(tick);
    };
    const handleVisibility = () => {
      cancelAnimationFrame(frame);
      previousTime = null;
      if (document.visibilityState === "visible")
        frame = requestAnimationFrame(tick);
    };
    redraw.current = () => {
      dirty = true;
    };
    document.addEventListener("visibilitychange", handleVisibility);
    handleVisibility();
    const loadMap = async <T,>(file: string): Promise<T> => {
      const response = await fetch(`/data/${file}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Globe map unavailable");
      return response.json();
    };
    void Promise.all([
      loadMap<LandPolygon[]>("earth-land.json"),
      loadMap<LandPolygon[]>("earth-china.json"),
      loadMap<MapLine[]>("earth-china-maritime.json"),
    ])
      .then(([land, china, maritime]) => {
        if (!active) return;
        const gradient = mapContext.createLinearGradient(0, 0, 0, MAP_HEIGHT);
        gradient.addColorStop(0, "#edf4f8");
        gradient.addColorStop(0.18, "#d4e3ec");
        gradient.addColorStop(0.5, "#cadde8");
        gradient.addColorStop(0.82, "#d4e3ec");
        gradient.addColorStop(1, "#edf4f8");
        const paintLand = (
          polygons: LandPolygon[],
          fill: string | CanvasGradient,
          stroke: string
        ) => {
          mapContext.fillStyle = fill;
          mapContext.strokeStyle = stroke;
          mapContext.lineWidth = 0.7;
          for (const polygon of polygons) {
            mapContext.beginPath();
            for (const ring of polygon) {
              ring.forEach(([longitude, latitude], index) => {
                const x = ((longitude + 180) / 360) * MAP_WIDTH;
                const y = ((90 - latitude) / 180) * MAP_HEIGHT;
                if (index === 0) mapContext.moveTo(x, y);
                else mapContext.lineTo(x, y);
              });
              mapContext.closePath();
            }
            mapContext.fill("evenodd");
            mapContext.stroke();
          }
        };
        paintLand(land, gradient, "rgba(236, 246, 255, 0.55)");
        paintLand(china, "#df5663", "rgba(235, 132, 143, 0.6)");
        mapContext.strokeStyle = "#df5663";
        mapContext.lineWidth = 3;
        mapContext.lineCap = "round";
        // The source already contains separate dashes; never join the gaps.
        for (const line of maritime) {
          mapContext.beginPath();
          line.forEach(([longitude, latitude], index) => {
            const x = ((longitude + 180) / 360) * MAP_WIDTH;
            const y = ((90 - latitude) / 180) * MAP_HEIGHT;
            if (index === 0) mapContext.moveTo(x, y);
            else mapContext.lineTo(x, y);
          });
          mapContext.stroke();
        }
        mapContext.strokeStyle = "rgba(228, 241, 255, 0.16)";
        mapContext.lineWidth = 1;
        mapContext.lineCap = "butt";
        mapContext.beginPath();
        for (let x = 0; x < MAP_WIDTH; x += MAP_WIDTH / 12) {
          mapContext.moveTo(x, 0);
          mapContext.lineTo(x, MAP_HEIGHT);
        }
        for (let y = MAP_HEIGHT / 6; y < MAP_HEIGHT; y += MAP_HEIGHT / 6) {
          mapContext.moveTo(0, y);
          mapContext.lineTo(MAP_WIDTH, y);
        }
        mapContext.stroke();
        texture = mapContext.getImageData(0, 0, MAP_WIDTH, MAP_HEIGHT).data;
        dirty = true;
      })
      .catch(() => {
        // The ocean sphere remains usable if the bundled map cannot be read.
      });
    return () => {
      active = false;
      controller.abort();
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", handleVisibility);
      redraw.current = null;
    };
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    drag.current = { id: event.pointerId, x: event.clientX };
  };
  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const previous = drag.current;
    if (!previous || previous.id !== event.pointerId) return;
    if (!(event.buttons & 1)) {
      drag.current = null;
      return;
    }
    const scale = Math.PI / event.currentTarget.getBoundingClientRect().width;
    longitude.current =
      (longitude.current - (event.clientX - previous.x) * scale) % TAU;
    drag.current = { id: event.pointerId, x: event.clientX };
    redraw.current?.();
  };
  const handlePointerEnd = (event: PointerEvent<HTMLCanvasElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const step = Math.PI / 18;
    switch (event.key) {
      case "ArrowLeft":
        longitude.current -= step;
        break;
      case "ArrowRight":
        longitude.current += step;
        break;
      case "Home":
        longitude.current = INITIAL_LONGITUDE;
        break;
      default:
        return;
    }
    event.preventDefault();
    redraw.current?.();
  };

  return (
    <Box id="home-globe" w={{ base: "112px", xl: "220px" }} ml="auto" mt={5}>
      <Box position="relative">
        <Box
          aria-hidden
          position="absolute"
          left="calc(50% - 1px)"
          top="-6%"
          w="2px"
          h="112%"
          bg="rgba(214, 234, 248, 0.8)"
          borderRadius="full"
          transform="rotate(-23.4deg)"
          pointerEvents="none"
        />
        <Box
          as="canvas"
          ref={canvasRef}
          id="home-globe-canvas"
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={t("HomeDateQuote.globe")}
          title={t("HomeDateQuote.globeHelp")}
          tabIndex={0}
          display="block"
          w="100%"
          h="auto"
          borderRadius="full"
          cursor="grab"
          style={{ touchAction: "none" }}
          userSelect="none"
          position="relative"
          filter="drop-shadow(0 8px 18px rgba(25, 66, 100, 0.16))"
          _active={{ cursor: "grabbing" }}
          _focusVisible={{ outline: "2px solid #b7d9f0", outlineOffset: "4px" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onLostPointerCapture={handlePointerEnd}
          onKeyDown={handleKeyDown}
        />
      </Box>
    </Box>
  );
};

export default HomeGlobe;
