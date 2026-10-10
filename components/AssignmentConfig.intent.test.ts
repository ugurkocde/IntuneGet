// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/hooks/useMicrosoftAuth', () => ({
  useMicrosoftAuth: () => ({ getAccessToken: async () => 'token' }),
}));
vi.mock('@/hooks/useMspOptional', () => ({
  useMspOptional: () => ({ isMspUser: false, selectedTenantId: null }),
}));
import { AssignmentConfig } from './AssignmentConfig';
import type { PackageAssignment } from '@/types/upload';

let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ groups: [{ id: 'group-1', displayName: 'Finance Users' }] }),
  })));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function render(assignments: PackageAssignment[], onChange: (next: PackageAssignment[]) => void) {
  const node = document.createElement('div');
  document.body.append(node);
  root = createRoot(node);
  await act(async () => root.render(createElement(AssignmentConfig, { assignments, onChange })));
}

const intentSelect = () =>
  document.querySelector<HTMLSelectElement>('#assignment-new-group-intent');

async function chooseIntent(value: string) {
  const select = intentSelect()!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function searchAndPickGroup() {
  const input = document.querySelector<HTMLInputElement>('input[placeholder="Search Entra ID groups..."]')!;
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setValue.call(input, 'Finance');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Group search is debounced by 300 ms.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  const option = [...document.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Finance Users')
  )!;
  await act(async () => option.click());
}

describe('AssignmentConfig intent for new groups', () => {
  it('offers Required, Available, Uninstall and Update Only before a group is added', async () => {
    await render([{ type: 'allDevices', intent: 'required' }], vi.fn());

    const select = intentSelect();
    expect(select).not.toBeNull();
    expect(select!.value).toBe('required');
    expect([...select!.options].map((option) => option.value)).toEqual([
      'required',
      'available',
      'uninstall',
      'updateOnly',
    ]);
  });

  it('adds an included group with the chosen Available intent', async () => {
    const onChange = vi.fn();
    await render([{ type: 'allDevices', intent: 'required' }], onChange);

    await chooseIntent('available');
    expect(document.body.textContent).toContain('Users can install it themselves from Company Portal.');
    await searchAndPickGroup();

    expect(onChange).toHaveBeenLastCalledWith([
      { type: 'allDevices', intent: 'required' },
      { type: 'group', intent: 'available', groupId: 'group-1', groupName: 'Finance Users' },
    ]);
  });

  it('adds an included group with the chosen Uninstall intent', async () => {
    const onChange = vi.fn();
    await render([{ type: 'allUsers', intent: 'available' }], onChange);

    await chooseIntent('uninstall');
    await searchAndPickGroup();

    expect(onChange).toHaveBeenLastCalledWith([
      { type: 'allUsers', intent: 'available' },
      { type: 'group', intent: 'uninstall', groupId: 'group-1', groupName: 'Finance Users' },
    ]);
  });

  it('keeps exclusions on the required intent and hides the intent picker in exclude mode', async () => {
    const onChange = vi.fn();
    await render([{ type: 'allUsers', intent: 'available' }], onChange);

    await chooseIntent('available');
    const exclude = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Exclude'
    )!;
    await act(async () => exclude.click());
    expect(intentSelect()).toBeNull();

    await searchAndPickGroup();

    expect(onChange).toHaveBeenLastCalledWith([
      { type: 'allUsers', intent: 'available' },
      { type: 'exclusionGroup', intent: 'required', groupId: 'group-1', groupName: 'Finance Users' },
    ]);
  });
});
