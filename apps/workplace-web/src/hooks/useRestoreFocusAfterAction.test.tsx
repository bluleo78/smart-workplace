// WP-2133: 누르면 사라지는 단추를 키보드로 눌렀을 때만, 동작이 끝나고 가라앉은 뒤 대상으로 포커스를 옮긴다.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';

import { useRestoreFocusAfterAction } from './useRestoreFocusAfterAction';

/** 「되돌리기」를 누르면 active 가 끝나며 단추가 사라지는 작은 화면 — settling 은 밖에서 준다. */
function Harness({ settling = false, fail = false }: { settling?: boolean; fail?: boolean }) {
  const [active, setActive] = useState(true);
  const focus = useRestoreFocusAfterAction({
    active,
    settling,
    getTarget: () => document.getElementById('target'),
  });
  return (
    <>
      {active && (
        <button type="button" {...focus.triggerProps(() => (fail ? focus.clear() : setActive(false)))}>되돌리기</button>
      )}
      {active && <button type="button" onClick={() => setActive(false)}>다른 경로</button>}
      <button type="button" id="target">게시</button>
    </>
  );
}

it('키보드로 누르면(앞선 pointerdown 없음 — detail=1 인 스크린리더 클릭 포함) 끝난 뒤 대상으로 옮긴다', () => {
  render(<Harness />);
  const revert = screen.getByRole('button', { name: '되돌리기' });
  act(() => revert.focus());
  fireEvent.click(revert, { detail: 1 });
  expect(screen.getByRole('button', { name: '게시' })).toHaveFocus();
});

it('포인터로 누르면(pointerdown → click) 옮기지 않는다', () => {
  render(<Harness />);
  const revert = screen.getByRole('button', { name: '되돌리기' });
  act(() => revert.focus());
  fireEvent.pointerDown(revert);
  fireEvent.click(revert, { detail: 1 });
  expect(document.body).toHaveFocus();
});

it('포인터로 눌렀다 끌어 나간 뒤 키보드로 누르면 키보드로 본다', () => {
  render(<Harness />);
  const revert = screen.getByRole('button', { name: '되돌리기' });
  act(() => revert.focus());
  fireEvent.pointerDown(revert);
  fireEvent.keyDown(revert, { key: 'Enter' });
  fireEvent.click(revert);
  expect(screen.getByRole('button', { name: '게시' })).toHaveFocus();
});

it('settling 동안은 기다렸다가 풀리면 옮긴다', () => {
  const { rerender } = render(<Harness settling />);
  const revert = screen.getByRole('button', { name: '되돌리기' });
  act(() => revert.focus());
  fireEvent.click(revert);
  expect(document.body).toHaveFocus();
  rerender(<Harness settling={false} />);
  expect(screen.getByRole('button', { name: '게시' })).toHaveFocus();
});

it('clear() 로 거두면 나중에 다른 경로로 끝나도 옮기지 않는다', () => {
  render(<Harness fail />);
  const revert = screen.getByRole('button', { name: '되돌리기' });
  act(() => revert.focus());
  fireEvent.click(revert);
  fireEvent.click(screen.getByRole('button', { name: '다른 경로' }));
  expect(document.body).toHaveFocus();
});

it('누르지 않고 다른 경로로 끝나면 옮기지 않는다', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '다른 경로' }));
  expect(document.body).toHaveFocus();
});
