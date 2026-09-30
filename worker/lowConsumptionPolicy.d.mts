export function isLowConsumptionModeAllowed(operation: string): boolean;
export function lowConsumptionOperationViolation(operation: string): string | null;
export function lowConsumptionRuntimeHealthy(runtime: { health?: { ok: boolean }; syncedAt?: number }, now?: number): boolean;
export function lowConsumptionStepLimit(model?: string, freeMaxSteps?: number): number;
export function fitLowConsumptionDimensions(width: number, height: number, maxArea: number): { width: number; height: number };
export function lowConsumptionViolation(options: {
  operation: string; model?: string; steps: number; freeMaxSteps: number;
  width: number; height: number; freeMaxArea: number; referenceCount: number; vibeCount: number;
  focused: boolean; estimatedCost: number; runtimeHealthy: boolean;
  subscriptionKnown: boolean; usageLimited: boolean; usageExhausted: boolean;
}): string | null;
