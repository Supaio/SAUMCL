import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCowDrop } from "@/contexts/cow-drop";
import {
  COW_RADIUS,
  CowBody,
  MAX_COW_RADIUS,
  containCows,
  dropCow,
  getCowCapacity,
  stepCowPhysics,
} from "@/utils/cow-drop";

const COW_SPRITE_URL = "/images/sau-cow.png";
const TIME_STEP = 1 / 120;
const GRAY_EFFECT_SECONDS = 1.6;

const drawCow = (
  ctx: CanvasRenderingContext2D,
  cow: CowBody,
  sprite: HTMLImageElement | HTMLCanvasElement,
  viewportWidth: number,
  viewportHeight: number,
  effectAge?: number,
  reducedMotion = false
) => {
  const spriteWidth =
    sprite instanceof HTMLImageElement ? sprite.naturalWidth : sprite.width;
  const spriteHeight =
    sprite instanceof HTMLImageElement ? sprite.naturalHeight : sprite.height;
  if (!spriteWidth || !viewportWidth || !viewportHeight) return;
  const scale = (cow.radius * 2) / Math.max(spriteWidth, spriteHeight);
  const width = spriteWidth * scale;
  const height = spriteHeight * scale;
  const cos = Math.cos(cow.angle);
  const sin = Math.sin(cow.angle);
  const offsetY = cow.radius - height / 2;
  const extentX = (Math.abs(cos) * width + Math.abs(sin) * height) / 2;
  const extentY = (Math.abs(sin) * width + Math.abs(cos) * height) / 2;
  // Clamp the rotated image itself, including horns and feet, inside the canvas.
  const x = Math.max(
    extentX,
    Math.min(viewportWidth - extentX, cow.x - sin * offsetY)
  );
  const y = Math.max(
    extentY,
    Math.min(viewportHeight - extentY, cow.y + cos * offsetY)
  );
  ctx.save();
  ctx.translate(x, y);
  if (effectAge !== undefined && effectAge < GRAY_EFFECT_SECONDS) {
    const progress = effectAge / GRAY_EFFECT_SECONDS;
    const opacity = 1 - progress;
    const glowRadius = cow.radius * (2 + (reducedMotion ? 0 : progress * 0.7));
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowRadius);
    glow.addColorStop(0, `rgba(245, 250, 255, ${opacity * 0.7})`);
    glow.addColorStop(0.5, `rgba(180, 220, 255, ${opacity * 0.4})`);
    glow.addColorStop(1, "rgba(180, 220, 255, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
    ctx.fill();
    if (!reducedMotion) {
      ctx.fillStyle = `rgba(245, 250, 255, ${opacity})`;
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI * 2 + progress * 0.7;
        const distance = cow.radius * (0.8 + progress * 1.8);
        const sx = Math.cos(angle) * distance;
        const sy = Math.sin(angle) * distance;
        const size = 2 + opacity * 3;
        ctx.beginPath();
        ctx.moveTo(sx, sy - size);
        ctx.lineTo(sx + size * 0.35, sy);
        ctx.lineTo(sx, sy + size);
        ctx.lineTo(sx - size * 0.35, sy);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  ctx.rotate(cow.angle);
  ctx.drawImage(sprite, -width / 2, -height / 2, width, height);
  ctx.restore();
};

const CowDropGame = ({
  dropRequest,
  topInset,
}: {
  dropRequest: number;
  topInset: number;
}) => {
  const { t } = useTranslation();
  const {
    cowCount,
    cowCapacity,
    clearRequest,
    isGameLaunchBlocked,
    setCowCount,
    setCowCapacity,
    clearCows,
    recordGrayCows,
  } = useCowDrop();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cowsRef = useRef<CowBody[]>([]);
  const boundsRef = useRef({ width: 0, height: 0 });
  const grayEffectsRef = useRef(new Map<CowBody, number>());
  const grayCelebrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [showGrayCelebration, setShowGrayCelebration] = useState(false);
  const lastRequestRef = useRef(dropRequest);
  const startAnimationRef = useRef<() => void>(() => {});
  const clearAnimationRef = useRef<() => void>(() => {});
  const isFull = cowCapacity > 0 && cowCount >= cowCapacity;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let frame: number | null = null;
    let lastTime = 0;
    let accumulator = 0;
    const sprite = new window.Image();
    const graySprite = document.createElement("canvas");
    const grayEffects = grayEffectsRef.current;
    let grayReady = false;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const draw = () => {
      const { width, height } = boundsRef.current;
      ctx.clearRect(0, 0, width, height);
      const now = performance.now();
      for (const cow of cowsRef.current) {
        const startedAt = grayEffects.get(cow);
        const effectAge =
          startedAt === undefined ? undefined : (now - startedAt) / 1000;
        if (effectAge !== undefined && effectAge >= GRAY_EFFECT_SECONDS)
          grayEffects.delete(cow);
        drawCow(
          ctx,
          cow,
          cow.isGray && grayReady ? graySprite : sprite,
          width,
          height,
          effectAge,
          reducedMotion
        );
      }
    };
    sprite.onload = () => {
      // Cache a gray sprite once, including alpha, for WebViews without canvas filters.
      graySprite.width = Math.ceil(MAX_COW_RADIUS * 4);
      graySprite.height = Math.round(
        (sprite.naturalHeight / sprite.naturalWidth) * graySprite.width
      );
      const grayContext = graySprite.getContext("2d");
      if (grayContext) {
        grayContext.drawImage(
          sprite,
          0,
          0,
          graySprite.width,
          graySprite.height
        );
        const pixels = grayContext.getImageData(
          0,
          0,
          graySprite.width,
          graySprite.height
        );
        for (let i = 0; i < pixels.data.length; i += 4) {
          const gray = Math.round(
            pixels.data[i] * 0.2126 +
              pixels.data[i + 1] * 0.7152 +
              pixels.data[i + 2] * 0.0722
          );
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
        }
        grayContext.putImageData(pixels, 0, 0);
        grayReady = true;
      }
      draw();
    };
    sprite.src = COW_SPRITE_URL;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      boundsRef.current = { width: rect.width, height: rect.height };
      setCowCapacity(getCowCapacity(rect.width, rect.height));
      containCows(cowsRef.current, rect.width, rect.height);
      draw();
    };
    const tick = (now: number) => {
      accumulator += lastTime ? Math.min((now - lastTime) / 1000, 1 / 20) : 0;
      lastTime = now;
      const { width, height } = boundsRef.current;
      const canvasRect = canvas.getBoundingClientRect();
      const obstacles = Array.from(
        document.querySelectorAll<HTMLElement>("[data-cow-obstacle]")
      ).flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.right <= canvasRect.left ||
          rect.left >= canvasRect.right ||
          rect.bottom <= canvasRect.top ||
          rect.top >= canvasRect.bottom
        )
          return [];
        return [
          {
            left: rect.left - canvasRect.left,
            top: rect.top - canvasRect.top,
            right: rect.right - canvasRect.left,
            bottom: rect.bottom - canvasRect.top,
          },
        ];
      });
      while (accumulator >= TIME_STEP) {
        stepCowPhysics(cowsRef.current, width, height, TIME_STEP, obstacles);
        accumulator -= TIME_STEP;
      }
      draw();
      frame = requestAnimationFrame(tick);
    };
    const stopAnimation = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      lastTime = 0;
      accumulator = 0;
    };
    const startAnimation = () => {
      if (frame === null && !document.hidden && cowsRef.current.length > 0) {
        frame = requestAnimationFrame(tick);
      }
    };
    const clear = () => {
      stopAnimation();
      cowsRef.current = [];
      grayEffects.clear();
      if (grayCelebrationTimerRef.current !== null)
        clearTimeout(grayCelebrationTimerRef.current);
      grayCelebrationTimerRef.current = null;
      setShowGrayCelebration(false);
      setCowCount(0);
      draw();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearCows();
    };
    const handleVisibilityChange = () => {
      stopAnimation();
      startAnimation();
    };
    startAnimationRef.current = startAnimation;
    clearAnimationRef.current = clear;
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    document.addEventListener("keydown", handleEscape, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stopAnimation();
      observer.disconnect();
      document.removeEventListener("keydown", handleEscape, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      startAnimationRef.current = () => {};
      clearAnimationRef.current = () => {};
      cowsRef.current = [];
      grayEffects.clear();
      if (grayCelebrationTimerRef.current !== null)
        clearTimeout(grayCelebrationTimerRef.current);
      setCowCount(0);
      sprite.onload = null;
      sprite.src = "";
    };
  }, [setCowCount, setCowCapacity, clearCows]);

  useEffect(() => {
    const pending = dropRequest - lastRequestRef.current;
    lastRequestRef.current = dropRequest;
    const { width, height } = boundsRef.current;
    let grayAdded = 0;
    for (let i = 0; i < pending; i++) {
      const x = COW_RADIUS + Math.random() * (width - COW_RADIUS * 2);
      if (!dropCow(cowsRef.current, x, width, height)) {
        break;
      }
      const cow = cowsRef.current[cowsRef.current.length - 1];
      if (cow.isGray) {
        grayAdded++;
        grayEffectsRef.current.set(cow, performance.now());
      }
    }
    if (grayAdded > 0) {
      recordGrayCows(grayAdded);
      setShowGrayCelebration(true);
      if (grayCelebrationTimerRef.current !== null)
        clearTimeout(grayCelebrationTimerRef.current);
      grayCelebrationTimerRef.current = setTimeout(() => {
        setShowGrayCelebration(false);
        grayCelebrationTimerRef.current = null;
      }, 2200);
    }
    setCowCount(cowsRef.current.length);
    startAnimationRef.current();
  }, [dropRequest, setCowCount, recordGrayCows]);

  useEffect(() => {
    clearAnimationRef.current();
  }, [clearRequest]);

  return (
    <>
      <canvas
        ref={canvasRef}
        id="cow-drop-canvas"
        aria-hidden="true"
        style={{
          position: "fixed",
          top: topInset,
          left: 0,
          width: "100%",
          height: `calc(100vh - ${topInset}px)`,
          display: "block",
          pointerEvents: "none",
          zIndex: 20,
        }}
      />
      {showGrayCelebration && (
        <div
          id="gray-cow-celebration"
          role="status"
          style={{
            position: "fixed",
            top: topInset + 16,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "10px 20px",
            border: "1px solid rgba(220, 237, 255, 0.9)",
            borderRadius: 12,
            background:
              "linear-gradient(135deg, rgba(52, 65, 85, 0.95), rgba(96, 116, 142, 0.95))",
            boxShadow: "0 0 24px rgba(196, 223, 255, 0.6)",
            color: "#f2f7ff",
            pointerEvents: "none",
            zIndex: 21,
          }}
        >
          {t("CowDropGame.grayFound")}
        </div>
      )}
      {(isFull || isGameLaunchBlocked) && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 32,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "8px 16px",
            width: "max-content",
            maxWidth: "calc(100vw - 32px)",
            textAlign: "center",
            borderRadius: 8,
            background: "rgba(23, 32, 51, 0.9)",
            color: "white",
            pointerEvents: "none",
            zIndex: 20,
          }}
        >
          {t(isFull ? "CowDropGame.full" : "CowDropGame.launchBlocked", {
            count: cowCount,
            limit: cowCapacity,
          })}
        </div>
      )}
    </>
  );
};

export default CowDropGame;
