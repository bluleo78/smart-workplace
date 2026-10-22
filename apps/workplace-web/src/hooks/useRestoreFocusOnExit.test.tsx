// WP-813: 편집·선택이 끝난 뒤 포커스가 body 로 빠졌으면 지정 요소로 돌리고, 사용자가 다른 곳을 눌렀으면 그대로 둔다.
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useRestoreFocusAfterPick, useRestoreFocusOnExit } from './useRestoreFocusOnExit';

function button(label: string) {
  const b = document.createElement('button');
  b.textContent = label;
  document.body.appendChild(b);
  return b;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useRestoreFocusOnExit', () => {
  it('편집이 끝났을 때 포커스가 body 면 대상으로 돌린다', () => {
    const target = button('편집');
    const ref = { current: target };
    const { rerender } = renderHook(({ active }) => useRestoreFocusOnExit(active, ref), {
      initialProps: { active: true },
    });
    (document.activeElement as HTMLElement | null)?.blur();
    rerender({ active: false });
    expect(document.activeElement).toBe(target);
  });

  it('사용자가 다른 요소로 포커스를 옮겼으면 빼앗지 않는다', () => {
    const target = button('편집');
    const other = button('다른 곳');
    const ref = { current: target };
    const { rerender } = renderHook(({ active }) => useRestoreFocusOnExit(active, ref), {
      initialProps: { active: true },
    });
    other.focus();
    rerender({ active: false });
    expect(document.activeElement).toBe(other);
  });

  it('처음부터 편집 중이 아니면 아무것도 하지 않는다', () => {
    const target = button('편집');
    const ref = { current: target };
    renderHook(() => useRestoreFocusOnExit(false, ref));
    expect(document.activeElement).toBe(document.body);
  });
});

describe('useRestoreFocusAfterPick', () => {
  it('값을 고른 뒤 잠금이 풀리면 트리거로 돌린다', () => {
    const target = button('우선순위');
    const ref = { current: target };
    const { result, rerender } = renderHook(({ disabled }) => useRestoreFocusAfterPick(disabled, ref), {
      initialProps: { disabled: false },
    });
    result.current();
    rerender({ disabled: true });
    rerender({ disabled: false });
    expect(document.activeElement).toBe(target);
  });

  it('고른 적 없이 잠금이 풀리면(첫 로딩·권한) 포커스를 건드리지 않는다', () => {
    const target = button('우선순위');
    const ref = { current: target };
    const { rerender } = renderHook(({ disabled }) => useRestoreFocusAfterPick(disabled, ref), {
      initialProps: { disabled: true },
    });
    rerender({ disabled: false });
    expect(document.activeElement).toBe(document.body);
  });
});
