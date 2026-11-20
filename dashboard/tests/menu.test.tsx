// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { MenuButton } from '../src/components/ui';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function setup() {
  const onCsv = vi.fn();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(<MenuButton label="More actions" items={[
      { label: 'Export CSV', onSelect: onCsv },
      { label: 'Export JSON', onSelect: () => {} },
    ]} />);
  });
  const trigger = el.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  const items = () => [...el.querySelectorAll<HTMLButtonElement>('[role=menuitem]')];
  return { el, root, trigger, items, onCsv };
}

describe('MenuButton', () => {
  it('opens on click, runs the chosen item and closes', async () => {
    const { trigger, items, onCsv, root } = await setup();
    expect(items()).toHaveLength(0);
    await act(async () => { trigger.click(); });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(items().map((b) => b.textContent)).toEqual(['Export CSV', 'Export JSON']);
    await act(async () => { items()[0].click(); });
    expect(onCsv).toHaveBeenCalledOnce();
    expect(items()).toHaveLength(0);
    act(() => root.unmount());
  });

  it('closes on Escape and on a click outside', async () => {
    const { trigger, items, root } = await setup();
    await act(async () => { trigger.click(); });
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(items()).toHaveLength(0);
    await act(async () => { trigger.click(); });
    await act(async () => { document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(items()).toHaveLength(0);
    act(() => root.unmount());
  });
});
