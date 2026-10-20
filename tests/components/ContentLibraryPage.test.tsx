// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ContentLibraryPage, type ContentLibrarySection } from '../../components/ContentLibraryPage';

afterEach(() => cleanup());

const Harness = () => {
  const [section, setSection] = useState<ContentLibrarySection>('items');
  return <ContentLibraryPage section={section} onSectionChange={setSection}
    items={() => <div data-testid="items">条目</div>}
    roll={() => <div data-testid="roll">抽取</div>}
    saved={() => <div data-testid="saved">组合</div>} />;
};

it('一个入口三个分区：按需挂载，切走后保留节点与状态', () => {
  render(<Harness />);
  expect(screen.getByRole('tab', { name: '条目库' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByTestId('items')).toBeTruthy();
  expect(screen.queryByTestId('roll')).toBeNull();
  expect(screen.queryByTestId('saved')).toBeNull();

  const items = screen.getByTestId('items');
  fireEvent.click(screen.getByRole('tab', { name: '一键 Roll' }));
  expect(screen.getByTestId('roll')).toBeTruthy();
  expect(screen.getByTestId('items')).toBe(items);
  expect(screen.getByTestId('items').closest('[data-content-library-pane]')?.className).toContain('hidden');

  fireEvent.click(screen.getByRole('tab', { name: '已存组合' }));
  expect(screen.getByTestId('saved')).toBeTruthy();
  expect(screen.getByTestId('roll')).toBeTruthy();

  fireEvent.click(screen.getByRole('tab', { name: '条目库' }));
  expect(screen.getByTestId('items')).toBe(items);
  expect(screen.getByTestId('items').closest('[data-content-library-pane]')?.className).not.toContain('hidden');
  expect(screen.getByRole('tab', { name: '条目库' }).getAttribute('aria-selected')).toBe('true');
});
