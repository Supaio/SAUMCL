export interface PlaytimeStats {
  dailySeconds: Record<string, number>;
  historicalSeconds: number;
  totalSeconds: number;
  trackingStartedAt: string;
  activeSessions: number;
  saveFailed: boolean;
}
