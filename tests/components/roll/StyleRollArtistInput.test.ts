// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StyleRollArtistInput } from '../../../components/roll/StyleRollArtistInput';

vi.mock('../../../services/tagDictionary', () => ({ searchArtistDictionary: vi.fn(async () => []) }));
afterEach(cleanup);

describe('StyleRollArtistInput 输入法确认', () => {
  it('Safari compositionend 后的 Enter 229 保留输入，普通 Enter 才添加画师，Shift Enter 保留换行', () => {
    const onChange = vi.fn();
    render(React.createElement(StyleRollArtistInput, { label: '画师', value: [], onChange, limit: 4 }));
    const input = screen.getByRole('textbox', { name: '画师' }) as HTMLTextAreaElement;
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'sample_artist' } });
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(true);
    fireEvent.compositionEnd(input);
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: false })).toBe(true);
    expect(input.value).toBe('sample_artist');
    expect(onChange).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, shiftKey: true })).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 })).toBe(false);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(['sample_artist']);
    expect(input.value).toBe('');
  });
});
