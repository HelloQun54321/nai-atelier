import React, { useEffect, useRef } from 'react';
import { ThinkingParticleField, thinkingParticleSpeed } from '../services/agentThinkingParticles';

export const AgentThinkingParticles: React.FC<{ count: number; intensity: number }> = ({ count, intensity }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const settings = useRef({ count, intensity });
  const redraw = useRef<() => void>(() => {});
  useEffect(() => { settings.current = { count, intensity }; redraw.current(); }, [count, intensity]);
  useEffect(() => {
    const element = canvas.current;
    if (!element || typeof CanvasRenderingContext2D === 'undefined') return;
    const context = element.getContext('2d');
    if (!context) return;
    let field: ThinkingParticleField, frame = 0, previous = 0;
    const systemMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = () => systemMotion.matches || ['off', 'reduced'].includes(document.documentElement.dataset.motion || '');
    const paint = () => {
      if (!field) return;
      field.setCount(settings.current.count);
      context.clearRect(0, 0, field.width, field.height);
      context.fillStyle = '#fff';
      field.particles.forEach(particle => {
        context.globalAlpha = particle.opacity;
        context.beginPath(); context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2); context.fill();
      });
    };
    const tick = (time: number) => {
      field?.step(previous ? (time - previous) / 1000 : 0, settings.current.intensity);
      previous = time; paint(); frame = requestAnimationFrame(tick);
    };
    const updateMotion = () => {
      cancelAnimationFrame(frame); previous = 0; paint();
      if (!reduced()) frame = requestAnimationFrame(tick);
    };
    const resize = () => {
      const rect = element.getBoundingClientRect(), scale = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.round(rect.width * scale); element.height = Math.round(rect.height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      field = new ThinkingParticleField(rect.width, rect.height); updateMotion();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const motionObserver = new MutationObserver(updateMotion);
    motionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    systemMotion.addEventListener('change', updateMotion);
    redraw.current = paint; resize();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); motionObserver.disconnect(); systemMotion.removeEventListener('change', updateMotion); redraw.current = () => {}; };
  }, []);
  return <canvas ref={canvas} aria-hidden="true" className="agent-thinking-particles" data-particles={count} data-speed={thinkingParticleSpeed(intensity)} />;
};
