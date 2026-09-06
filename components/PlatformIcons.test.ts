// @vitest-environment jsdom
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DanbooruIcon, PixivIcon } from './PlatformIcons';

describe('PlatformIcons', () => {
  it('DanbooruIcon renders valid SVG with correct viewBox and path', () => {
    const { container } = render(React.createElement(DanbooruIcon, { className: 'h-5 w-5' }));
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('fill')).toBe('none');
    expect(svg?.classList.contains('h-5')).toBe(true);
    expect(svg?.querySelector('path')?.getAttribute('d')).toContain('M6 4.5');
  });

  it('PixivIcon renders valid SVG with correct viewBox and path', () => {
    const { container } = render(React.createElement(PixivIcon, { className: 'h-5 w-5' }));
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('fill')).toBe('none');
    expect(svg?.classList.contains('h-5')).toBe(true);
    expect(svg?.querySelector('path')?.getAttribute('d')).toContain('M6 20V5');
  });
});
