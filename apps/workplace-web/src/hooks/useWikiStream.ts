// wiki.page.* SSE 이벤트 핸들러 — 통합 스트림 라우터(useEventStream)가 호출.
// AI 비서/타 세션이 노트를 생성·수정·삭제·이동해도 열린 노트 화면이 리프레시 전까지 stale 이던 갭(#724)을 메운다.
// 백엔드 WikiSseDispatcher 가 스페이스 멤버 전원에게 wiki.page.* 를 브로드캐스트하면, 해당 스페이스 트리·열린 페이지·스페이스 목록
// 캐시를 무효화해 TanStack Query 가 최신 상태를 재조회하도록 한다. self-echo 도 무해(내 캐시는 이미 낙관적 갱신됨 → 재조회만 유발).
// 주의: wiki.ai.* (인에디터 /ai 토큰 스트림)는 이 핸들러가 아니라 aiEventBus 로 라우팅된다(useEventStream 에서 분기 순서 보장).

import type { QueryClient } from '@tanstack/react-query';

import { wikiKeys } from './queries/wikiKeys';

interface WikiPagePayload {
  spaceId?: number;
  pageId?: number;
}

const INVALIDATING_EVENTS = new Set([
  'wiki.page.created',
  'wiki.page.updated',
  'wiki.page.deleted',
  'wiki.page.moved',
]);

export function handleWikiEvent(qc: QueryClient, eventName: string, data: unknown) {
  if (!INVALIDATING_EVENTS.has(eventName)) return;
  const p = data as WikiPagePayload;
  // 스페이스 트리(사이드바) — 생성·삭제·이동·제목변경 모두 트리에 영향.
  if (typeof p?.spaceId === 'number' && Number.isFinite(p.spaceId)) {
    qc.invalidateQueries({ queryKey: wikiKeys.tree(p.spaceId) });
  }
  // 열려 있는 단건 페이지 — 다른 탭/AI 의 본문 수정 반영.
  if (typeof p?.pageId === 'number' && Number.isFinite(p.pageId)) {
    qc.invalidateQueries({ queryKey: wikiKeys.page(p.pageId) });
  }
  // 스페이스 목록(페이지 수 등 파생 정보)도 갱신될 수 있어 함께 무효화.
  qc.invalidateQueries({ queryKey: wikiKeys.spaces() });
}
