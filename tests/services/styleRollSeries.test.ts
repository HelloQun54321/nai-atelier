// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { candidateFixture, rollFixture } from '../fixtures/styleRoll';

const signals = (overrides = {}) => ({ busy: false, experimentId: 'synthetic-experiment', opusPercent: 50, points: 1000, ...overrides });

beforeEach(() => { vi.resetModules(); sessionStorage.clear(); });

it('额度、轮数、切换记录与长时间无进展都会停止，额度未知不当作已达标', async () => {
  const { nextRollSeriesStep, startRollSeries, ROLL_SERIES_NO_PROGRESS_MS, ROLL_SERIES_ROUND_GAP_MS } = await import('../../services/styleRollSeries');
  const state = startRollSeries({ experimentId: 'synthetic-experiment', maxRounds: 2, stopAtPercent: 5, stopAtPoints: 10 }, 1000);
  const now = 1000 + ROLL_SERIES_ROUND_GAP_MS;
  expect(nextRollSeriesStep(state, signals(), now)).toEqual({ action: 'run' });
  expect(nextRollSeriesStep(state, signals({ opusPercent: null, points: null }), now)).toEqual({ action: 'run' });
  expect(nextRollSeriesStep(state, signals({ busy: true }), now)).toEqual({ action: 'wait' });
  expect(nextRollSeriesStep(state, signals({ opusPercent: 5 }), now)).toEqual({ action: 'stop', reason: 'opus_limit' });
  expect(nextRollSeriesStep(state, signals({ points: 10 }), now)).toEqual({ action: 'stop', reason: 'points_limit' });
  expect(nextRollSeriesStep(state, signals({ experimentId: 'other' }), now)).toEqual({ action: 'stop', reason: 'record_changed' });
  expect(nextRollSeriesStep(state, signals({ busy: true }), 1000 + ROLL_SERIES_NO_PROGRESS_MS + 1)).toEqual({ action: 'stop', reason: 'no_progress' });
  // 本批仍在出图时不按无进展停止，也不发起下一轮。
  state.inFlight = true;
  expect(nextRollSeriesStep(state, signals(), 1000 + ROLL_SERIES_NO_PROGRESS_MS + 1)).toEqual({ action: 'wait' });
  state.inFlight = false; state.rounds = 2;
  expect(nextRollSeriesStep(state, signals(), now)).toEqual({ action: 'stop', reason: 'max_rounds' });
});

it('停止只生效一次并留下原因，刷新后读回停止结果但不续跑', async () => {
  const series = await import('../../services/styleRollSeries');
  series.startRollSeries({ experimentId: 'synthetic-experiment', maxRounds: 5, stopAtPercent: 5, stopAtPoints: 0 }, 1);
  series.getRollSeries().rounds = 3;
  expect(series.stopRollSeries('error', '合成失败', 2)).toBe(true);
  expect(series.stopRollSeries('user_stop')).toBe(false);
  expect(series.getRollSeries()).toMatchObject({ running: false, stopReason: 'error', lastError: '合成失败', rounds: 3 });
  vi.resetModules();
  const reloaded = await import('../../services/styleRollSeries');
  expect(reloaded.getRollSeries()).toMatchObject({ running: false, stopReason: 'error', lastError: '合成失败', rounds: 3, experimentId: 'synthetic-experiment' });
});

it('按最近候选体积预估下一轮是否逼近单条记录上限', async () => {
  const { rollSeriesWouldOverflow } = await import('../../services/styleRollSeries');
  const experiment = rollFixture();
  experiment.candidates = Array.from({ length: 20 }, (_, index) => candidateFixture(`c${index}`, `artist ${index}`));
  const size = JSON.stringify(experiment).length;
  expect(rollSeriesWouldOverflow(experiment, 6, size * 10)).toBe(false);
  expect(rollSeriesWouldOverflow(experiment, 6, size)).toBe(true);
});
