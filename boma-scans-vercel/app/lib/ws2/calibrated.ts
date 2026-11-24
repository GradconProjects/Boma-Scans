import data from "@/app/lib/ws2/calibration-data.json";
import { runWs2, ws2Lines, type Ws2Input } from "@/app/lib/ws2/engine";
import { applyCalibration, ratingLines, type Ws2Calibration, type Ws2Rated } from "@/app/lib/ws2/rating";

export const WS2_CALIBRATION = data as unknown as Ws2Calibration;
/** The engine plus the calibrated rating. This is what the app, the scan and Telegram use. */
export function runWs2Calibrated(input: Ws2Input): Ws2Rated { return applyCalibration(runWs2(input), WS2_CALIBRATION); }
export function ws2RatedLines(r: Ws2Rated): string[] { const lines = ws2Lines(r); const i = lines.findIndex(l => l.startsWith("📊 SCORES")); return [...lines.slice(0, Math.max(0, i)), ...ratingLines(r), "", ...lines.slice(Math.max(0, i))]; }
