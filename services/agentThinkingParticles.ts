export interface ThinkingParticle { x: number; y: number; radius: number; opacity: number }
export const thinkingParticleSpeed = (intensity: number) => 12 + Math.max(0, Math.min(1, intensity)) * 40;

/** 单一时间线驱动全部粒子；每次从右侧重新进入时重新抽取外观和轨迹。 */
export class ThinkingParticleField {
  particles: ThinkingParticle[] = [];
  constructor(public width: number, public height: number, private random = Math.random) {}
  private create(x: number): ThinkingParticle {
    let y = 0, bestDistance = -1;
    // 保持随机，同时挑选较空的纵向位置，避免入口处扎堆。
    for (let attempt = 0; attempt < 16; attempt++) {
      const candidate = 5 + this.random() * Math.max(0, this.height - 10);
      const distance = this.particles.reduce((closest, particle) => Math.min(closest, Math.hypot(x - particle.x, candidate - particle.y)), Infinity);
      if (distance > bestDistance) { y = candidate; bestDistance = distance; }
      if (distance >= 9) break;
    }
    return { x, y, radius: .7 + this.random() * 1.1, opacity: .35 + this.random() * .5 };
  }
  setCount(count: number) {
    this.particles.length = Math.min(this.particles.length, count);
    while (this.particles.length < count) {
      const positions = [-5, ...this.particles.map(particle => particle.x).filter(x => x >= 0 && x <= this.width).sort((a, b) => a - b), this.width + 5];
      let gap = 0, start = 0;
      for (let index = 1; index < positions.length; index++) {
        if (positions[index] - positions[index - 1] > gap) { gap = positions[index] - positions[index - 1]; start = positions[index - 1]; }
      }
      this.particles.push(this.create(Math.max(0, Math.min(this.width, start + gap * (.35 + this.random() * .3)))));
    }
  }
  step(seconds: number, intensity: number) {
    const speed = thinkingParticleSpeed(intensity);
    this.particles.forEach((particle, index) => {
      // 相同平移速度保留随机间距，不让后面的粒子追上前面的粒子扎堆。
      particle.x -= speed * Math.min(.05, Math.max(0, seconds));
      if (particle.x < -particle.radius - 2) {
        // 错开重新进入时间，避免一批粒子同时从同一个边界出现。
        const spacing = this.width / Math.max(1, this.particles.length);
        const rightmost = this.particles.reduce((right, item) => Math.max(right, item.x), this.width);
        this.particles[index] = this.create(rightmost + 5 + this.random() * spacing * .5);
      }
    });
  }
}
