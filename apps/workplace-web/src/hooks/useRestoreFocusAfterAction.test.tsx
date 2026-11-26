// WP-2133: 누르면 사라지는 단추를 키보드로 눌렀을 때만, 동작이 끝나고 가라앉은 뒤 대상으로 포커스를 옮긴다.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, onTestFinished } from 'vitest';

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

it('포인터로 눌렀다 단추 밖에서 떼면 표시를 지워, 뒤이은 detail=1 클릭(VO+Space)을 키보드로 본다', () => {
  render(<Harness />);
  const revert = screen.getByRole('button', { name: '되돌리기' });
  act(() => revert.focus());
  fireEvent.pointerDown(revert);
  // 끌어 나가 밖(대상 단추 위)에서 뗀다 — 클릭은 오지 않는다
  fireEvent.pointerUp(screen.getByRole('button', { name: '게시' }));
  fireEvent.click(revert, { detail: 1 });
  expect(screen.getByRole('button', { name: '게시' })).toHaveFocus();
});

it('보통 마우스 순서(pointerdown → 단추 위 pointerup → click)는 여전히 포인터로 본다', () => {
  render(<Harness />);
  const revert = screen.getByRole('button', { name: '되돌리기' });
  act(() => revert.focus());
  fireEvent.pointerDown(revert);
  fireEvent.pointerUp(revert);
  fireEvent.click(revert, { detail: 1 });
  expect(document.body).toHaveFocus();
});

it('pointercancel 이면 표시를 지워 뒤이은 detail=1 클릭을 키보드로 본다', () => {
  render(<Harness />);
  const revert = screen.getByRole('button', { name: '되돌리기' });
  act(() => revert.focus());
  fireEvent.pointerDown(revert);
  fireEvent.pointerCancel(revert);
  fireEvent.click(revert, { detail: 1 });
  expect(screen.getByRole('button', { name: '게시' })).toHaveFocus();
});

/** jsdom 에 없는 document.elementFromPoint 를 이 테스트 동안만 고정값으로 둔다. */
function mockElementFromPoint(el: Element | null) {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => el });
  onTestFinished(() => {
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  });
}

it('터치처럼 단추가 포인터를 잡아 pointerup 대상이 단추여도, 놓은 자리가 밖이면 표시를 지운다', () => {
  render(<Harness />);
  const revert = screen.getByRole('button', { name: '되돌리기' });
  const outside = screen.getByRole('button', { name: '게시' });
  act(() => revert.focus());
  fireEvent.pointerDown(revert, { pointerId: 1 });
  // 암시적 포인터 캡처 — 대상은 단추지만 놓은 좌표의 요소는 밖(게시)이다
  mockElementFromPoint(outside);
  fireEvent.pointerUp(revert, { pointerId: 1, clientX: 500, clientY: 500 });
  fireEvent.click(revert, { detail: 1 });
  expect(outside).toHaveFocus();
});

it('오른쪽·가운데 단추 누름은 클릭이 오지 않으므로 표시를 세우지 않는다', () => {
  render(<Harness />);
  const revert = screen.getByRole('button', { name: '되돌리기' });
  act(() => revert.focus());
  fireEvent.pointerDown(revert, { button: 2 });
  fireEvent.pointerUp(revert, { button: 2 });
  fireEvent.click(revert, { detail: 1 });
  expect(screen.getByRole('button', { name: '게시' })).toHaveFocus();
});

it('ctrl+클릭이 문맥 메뉴를 열면(mac) 표시를 지운다', () => {
  render(<Harness />);
  const revert = screen.getByRole('button', { name: '되돌리기' });
  act(() => revert.focus());
  fireEvent.pointerDown(revert, { ctrlKey: true });
  fireEvent.contextMenu(revert);
  fireEvent.pointerUp(revert, { ctrlKey: true });
  fireEvent.click(revert, { detail: 1 });
  expect(screen.getByRole('button', { name: '게시' })).toHaveFocus();
});

it('다른 포인터(pointerId)의 pointerup·pointercancel 은 이번 누름의 표시를 건드리지 않는다', () => {
  render(<Harness />);
  const revert = screen.getByRole('button', { name: '되돌리기' });
  const outside = screen.getByRole('button', { name: '게시' });
  act(() => revert.focus());
  fireEvent.pointerDown(revert, { pointerId: 1 });
  fireEvent.pointerUp(outside, { pointerId: 2 });
  fireEvent.pointerCancel(outside, { pointerId: 3 });
  fireEvent.pointerUp(revert, { pointerId: 1 });
  fireEvent.click(revert, { detail: 1 });
  expect(document.body).toHaveFocus();
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
