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
  | { type: 'setActive'; index: number };

let seq = 0;
// 위젯/페이지 id 생성 — 렌더 안정성용(랜덤 X, 단조 증가).
const nextId = (prefix: string) => `${prefix}-${++seq}`;

function toWidgets(specs: WidgetSpec[]): CanvasWidget[] {
  return specs.map((spec) => ({ id: nextId('w'), spec }));
}

function reducer(state: CanvasState, action: Action): CanvasState {
  switch (action.type) {
    case 'loadDefault': {
      // 기본 구성 — 단일 페이지로 초기화(AI 호출 없음).
      const page: CanvasPage = { id: nextId('p'), label: '홈', widgets: toWidgets(action.specs) };
      return { pages: [page], activeIndex: 0 };
    }
    case 'apply': {
      const specs = action.specs;
      if (specs.length === 0) return state;
      const first = specs[0].layout;
      // page='new' → 새 페이지 생성 + 이동, 이번 배치 전체를 거기에.
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
      // layout.replace 가 있으면 해당 위젯만 교체(나머지 유지).
      const replaceIds = specs.map((s) => s.layout?.replace).filter(Boolean) as string[];
      if (replaceIds.length > 0) {
        let widgets = active.widgets;
        for (const spec of specs) {
          const rid = spec.layout?.replace;
          if (rid) {
            widgets = widgets.map((w) => (w.id === rid ? { id: rid, spec } : w));
          } else {
            widgets = [...widgets, { id: nextId('w'), spec }];
          }
        }
        pages[idx] = { ...active, widgets };
        return { ...state, pages };
      }
      // 기본(page='current'/미지정): 현재 페이지를 이번 배치로 재구성(replace-all).
      pages[idx] = { ...active, widgets: toWidgets(specs) };
      return { ...state, pages };
    }
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
  return { ...state, loadDefault, apply, setActive };
}
