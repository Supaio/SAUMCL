import type { PlaytimeStats } from "@/models/playtime";

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function summarizePlaytime(stats: PlaytimeStats, now: Date) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  let weekSeconds = 0;
  let weekDays = 0;
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + offset);
    const seconds = stats.dailySeconds[localDateKey(date)] || 0;
    weekSeconds += seconds;
    if (seconds > 0) weekDays++;
  }
  return {
    todaySeconds: stats.dailySeconds[localDateKey(now)] || 0,
    weekSeconds,
    weekDays,
    totalSeconds: stats.totalSeconds,
    totalDays: Object.values(stats.dailySeconds).filter(
      (seconds) => seconds > 0
    ).length,
  };
}

export function playtimeMonth(now: Date, dailySeconds: Record<string, number>) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const first = new Date(year, month, 1, 12);
  const count = new Date(year, month + 1, 0, 12).getDate();
  const padding = (first.getDay() + 6) % 7;
  const cells = Array.from(
    { length: Math.ceil((padding + count) / 7) * 7 },
    (_, index) => {
      const day = index - padding + 1;
      if (day < 1 || day > count) return null;
      const key = localDateKey(new Date(year, month, day, 12));
      return {
        key,
        day,
        seconds: dailySeconds[key] || 0,
        today: key === localDateKey(now),
      };
    }
  );
  return cells;
}

export function playtimeDuration(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
