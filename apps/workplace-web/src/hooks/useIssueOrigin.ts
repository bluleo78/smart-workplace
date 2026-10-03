// 이슈 상세의 "이전 화면으로 돌아가기" — 히스토리 위치 기록(AppLayout)과 복귀 동작(이슈 상세) 훅(#885).
import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { currentHistoryIdx } from '@/lib/historyParam';
import { backDeltaToOrigin, type HistoryEntries, isIssueDetailPath } from '@/lib/issueOrigin';

// 탭(문서) 수명 동안의 위치 기록 — 새로고침하면 비워지고, 그 뒤 복귀는 기본 목적지로 간다.
const entries: HistoryEntries = {};

/** 앱 셸에서 1회 호출 — 화면이 바뀔 때마다 현재 히스토리 위치가 이슈 상세인지 기록한다. */
export function useIssueOriginTracker(): void {
  const location = useLocation();
  useEffect(() => {
    const idx = currentHistoryIdx();
    if (idx !== null) entries[idx] = isIssueDetailPath(location.pathname);
  }, [location]);
}

/**
 * 이슈 상세에서 출발 화면으로 돌아가는 콜백.
 * 출발 화면을 알면 거기까지 히스토리를 되감고, 모르면(직접 링크·푸시·새로고침) 프로젝트 화면으로 간다.
 * 기본 목적지는 현재 상세 항목을 교체(replace)한다 — push 하면 프로젝트 화면에서 뒤로가기가 방금 떠난 상세로
 * 되돌아가 "‹/← 를 눌렀는데 다시 상세"가 되는 왕복 고리가 생긴다(모바일 시스템 뒤로가기에서 특히 두드러짐).
 */
export function useReturnToIssueOrigin(projectKey: string): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = currentHistoryIdx();
    const delta = idx === null ? null : backDeltaToOrigin(entries, idx);
    if (delta !== null) navigate(delta);
    else navigate(`/projects/${projectKey}`, { replace: true });
  }, [navigate, projectKey]);
}

// 열려 있는 오버레이(다이얼로그·드로워·메뉴·팝오버·툴팁) — ESC 는 이것을 닫는 데 먼저 쓰인다.
// Radix 는 닫을 때 preventDefault 를 하지 않으므로 defaultPrevented 만으로는 구분되지 않아 DOM 으로 판정한다.
const OPEN_OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';

// 글자를 입력받는 요소 — 제목·본문·코멘트 편집의 ESC(편집 취소)를 가로채지 않기 위한 판정.
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

// 쓰다 만 글(코멘트 작성창·본문 편집)이 남아 있는지 — 포커스가 밖에 있어도 ESC 한 번에 날리지 않기 위한 판정.
function hasUnsentText(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('textarea, [contenteditable="true"]')).some(
    (el) => (el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? '')).trim() !== '',
  );
}

/** 이슈 상세에서 ESC 로 복귀 — 입력 중·한글 조합 중·오버레이가 열려 있거나 쓰다 만 글이 있으면 복귀하지 않는다. */
export function useReturnOnEscape(onReturn: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      if (isEditableTarget(e.target)) return;
      if (document.querySelector(OPEN_OVERLAY_SELECTOR) || hasUnsentText()) return;
      onReturn();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onReturn, enabled]);
}
