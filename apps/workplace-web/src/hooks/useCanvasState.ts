import { useCallback, useReducer } from 'react';

import type { WidgetSpec } from '@/types/home';

/** 캔버스에 놓인 위젯 인스턴스(안정적 id 부여). */
export interface CanvasWidget {
  id: string;
  spec: WidgetSpec;
}

/** 캔버스 페이지 — 위젯 묶음 1개 화면. */
export interface CanvasPage {
  id: string;
  label: string;
  widgets: CanvasWidget[];
}

export interface CanvasState {
  pages: CanvasPage[];
  activeIndex: number;
}

type Action =
  | { type: 'loadDefault'; specs: WidgetSpec[] }
  | { type: 'apply'; specs: WidgetSpec[] }
  | { type: 'setActive'; index: number }
  | { type: 'restore'; defaultSpecs: WidgetSpec[]; batches: WidgetSpec[][] };

let seq = 0;
// 위젯/페이지 id 생성 — 렌더 안정성용(랜덤 X, 단조 증가).
const nextId = (prefix: string) => `${prefix}-${++seq}`;

function toWidgets(specs: WidgetSpec[]): CanvasWidget[] {
  return specs.map((spec) => ({ id: nextId('w'), spec }));
}

// 기본 구성 단일 페이지 상태 생성.
function defaultState(specs: WidgetSpec[]): CanvasState {
  const page: CanvasPage = { id: nextId('p'), label: '홈', widgets: toWidgets(specs) };
  return { pages: [page], activeIndex: 0 };
}

// 위젯 배치 1개를 상태에 적용 — page='new' 면 새 페이지 추가+이동, 그 외엔 활성 페이지 replace-all.
// (apply 액션과 복원 fold 가 공유 — 동작 드리프트 방지)
function applyBatch(state: CanvasState, specs: WidgetSpec[]): CanvasState {
  if (specs.length === 0) return state;
  const first = specs[0].layout;
  if (first?.page === 'new') {
    const page: CanvasPage = {
      id: nextId('p'),
      label: first.pageLabel ?? '새 구성',
      widgets: toWidgets(specs),
    };
    return { pages: [...state.pages, page], activeIndex: state.pages.length };
  }
  const pages = [...state.pages];
  const idx = state.activeIndex;
  const active = pages[idx] ?? pages[0];
  // page='current'/미지정: 현재 페이지를 이번 배치로 재구성(replace-all).
  // layout.replace(위젯 단위 교체)는 미지원(클라 생성 id 를 백엔드가 echo 불가). 계약 타입만 유지.
  pages[idx] = { ...active, widgets: toWidgets(specs) };
  return { ...state, pages };
}

/** 복원: 기본 구성으로 시드 후 ASSISTANT 위젯 배치를 순서대로 fold(라이브 compose 와 동일 경로). */
export function restoreState(defaultSpecs: WidgetSpec[], batches: WidgetSpec[][]): CanvasState {
  let next = defaultState(defaultSpecs);
  for (const batch of batches) next = applyBatch(next, batch);
  return next;
}

function reducer(state: CanvasState, action: Action): CanvasState {
  switch (action.type) {
    case 'loadDefault':
      // 기본 구성 — 단일 페이지로 초기화(AI 호출 없음).
      return defaultState(action.specs);
    case 'apply':
      return applyBatch(state, action.specs);
    case 'restore':
      // 메시지 복원 — 기본 시드 후 배치 fold(AI 재호출 없음).
      return restoreState(action.defaultSpecs, action.batches);
    case 'setActive':
      return { ...state, activeIndex: action.index };
    default:
      return state;
  }
}

/** 홈 캔버스 멀티페이지 상태(프론트 전용, 백엔드 0). fire-hub useCanvasState 패턴 미러. */
export function useCanvasState() {
  const [state, dispatch] = useReducer(reducer, { pages: [], activeIndex: 0 });
  const loadDefault = useCallback((specs: WidgetSpec[]) => dispatch({ type: 'loadDefault', specs }), []);
  const apply = useCallback((specs: WidgetSpec[]) => dispatch({ type: 'apply', specs }), []);
  const setActive = useCallback((index: number) => dispatch({ type: 'setActive', index }), []);
  const restore = useCallback(
    (defaultSpecs: WidgetSpec[], batches: WidgetSpec[][]) =>
      dispatch({ type: 'restore', defaultSpecs, batches }),
    [],
  );
  return { ...state, loadDefault, apply, setActive, restore };
}
