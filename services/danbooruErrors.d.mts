export interface DanbooruFailure {
  status: number;
  error: string;
  code: string;
  causeCode?: string;
  upstreamStatus?: number;
  retryAfter?: number;
}
export type DanbooruFailurePayload = Omit<DanbooruFailure, 'status'>;
export function readDanbooruRetryAfter(value: string | number | null | undefined, now?: number): number;
export function createDanbooruResponseFailure(status: number, headers: Pick<Headers, 'get'>, body: string): DanbooruFailure | null;
export function isRetryableDanbooruNetworkError(error: unknown): boolean;
export function createDanbooruNetworkFailure(error: unknown): DanbooruFailure;
