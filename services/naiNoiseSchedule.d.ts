export type NaiNoiseSchedule = 'karras' | 'exponential' | 'polyexponential';

export const DEFAULT_NOISE_SCHEDULE: NaiNoiseSchedule;
export const NAI_NOISE_SCHEDULES: readonly NaiNoiseSchedule[];
export const NOISE_SCHEDULE_LABELS: Readonly<Record<NaiNoiseSchedule, string>>;

export function normalizeNoiseSchedule(value: unknown): NaiNoiseSchedule;
export function parseSamplerWithSchedule(raw: unknown): {
  sampler: string;
  noiseSchedule?: NaiNoiseSchedule;
};
