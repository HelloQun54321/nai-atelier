import { expect, it } from 'vitest';
import { ThinkingParticleField, thinkingParticleSpeed } from '../../services/agentThinkingParticles';
const seeded = () => { let seed = 987654; return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; };
it('所有可见粒子只向左走，强度越高流速越快', () => {
  const field = new ThinkingParticleField(300, 32, seeded()); field.setCount(24);
  const positions = field.particles.map(particle => particle.x);
  field.step(.016, 1); expect(field.particles.every((particle, index) => particle.x < positions[index])).toBe(true);
  expect(thinkingParticleSpeed(0)).toBeLessThan(thinkingParticleSpeed(.5)); expect(thinkingParticleSpeed(.5)).toBeLessThan(thinkingParticleSpeed(1));
});
it('每次重新进入随机更换纵向位置和外观，并错开入口', () => {
  const field = new ThinkingParticleField(300, 32, seeded()); field.setCount(8);
  const particle = { ...field.particles[0] }; field.particles[0].x = -10;
  field.step(.016, .5); const respawn = field.particles[0];
  expect(respawn.x).toBeGreaterThan(300); expect(respawn.y).not.toBe(particle.y); expect(respawn.radius).not.toBe(particle.radius);
  field.particles[1].x = -10; field.step(.016, .5); expect(field.particles[1].x).toBeGreaterThan(respawn.x);
});
it('初始分布避免扎堆，切换强度数量时已有粒子保留原位置', () => {
  const field = new ThinkingParticleField(270, 32, seeded()); field.setCount(5);
  const initial = field.particles.slice(); field.setCount(24); expect(field.particles.slice(0, 5)).toEqual(initial);
  for (let index = 0; index < field.particles.length; index++) {
    const particle = field.particles[index];
    for (const other of field.particles.slice(index + 1)) expect(Math.hypot(particle.x - other.x, particle.y - other.y)).toBeGreaterThanOrEqual(9);
  }
  field.setCount(5); expect(field.particles).toEqual(initial);
});
