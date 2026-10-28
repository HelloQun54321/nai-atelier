import { fireEvent, within } from '@testing-library/react';

export function openPurposeGroup(label: string, container: HTMLElement = document.body) {
  const button = within(container).getByRole('button', { name: label });
  if (button.getAttribute('aria-expanded') === 'false') fireEvent.click(button);
}
