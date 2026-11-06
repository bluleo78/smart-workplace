// 이슈 상세의 "이전 화면으로 돌아가기" — 히스토리 위치 기록(AppLayout)과 복귀 동작(이슈 상세) 훅(#885).
import { useCallback, useEffect, useLayoutEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { isEditableTarget, OPEN_OVERLAY_SELECTOR } from '@/lib/escapeOverlay';
import { currentHistoryIdx } from '@/lib/historyParam';
import { backDeltaToOrigin, type HistoryEntries, isIssueDetailPath } from '@/lib/issueOrigin';

// 탭(문서) 수명 동안의 위치 기록 — 새로고침하면 비워지고, 그 뒤 복귀는 기본 목적지로 간다.
const entries: HistoryEntries = {};

/** 테스트 전용 — 모듈 수명의 위치 기록을 비운다(테스트마다 jsdom 히스토리가 idx 0 부터 다시 시작하므로 앞 테스트의 기록이 남지 않게). */
export function resetIssueOriginForTest(): void {
  for (const idx of Object.keys(entries)) delete entries[Number(idx)];
}

/**
 * 앱 셸에서 1회 호출 — 화면이 바뀔 때마다 현재 히스토리 위치가 이슈 상세인지 기록한다.
 * 레이아웃 이펙트로 기록한다(WP-1416) — 앱 셸은 화면의 부모라 일반 이펙트는 화면(자식)의 이펙트보다 늦게 돈다.
 * 화면이 자기 이펙트에서 곧바로 히스토리를 옮기면(채팅 서랍 펴기: replace → push, WP-1414) 그 뒤에 읽은 idx 는 이미 다음 항목이라
 * 방금 그린 위치가 기록되지 않았다 → 서랍이 열린 채 복귀하면(헤더 ←) 기록 없는 칸을 만나 출발 화면 대신 프로젝트 화면으로 갔다
 * (이슈·프로젝트가 캐시에 있어 첫 렌더부터 서랍을 펼 때). 레이아웃 이펙트는 같은 커밋의 모든 일반 이펙트보다 먼저 돌아,
 * 그린 위치를 옮겨지기 전에 기록한다.
 */
export function useIssueOriginTracker(): void {
  const location = useLocation();
  useLayoutEffect(() => {
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
