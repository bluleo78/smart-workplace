package com.workplace.wiki.outbound;

import java.time.Instant;

/**
 * 노트(위키) 도메인 이벤트 4종. ApplicationEventPublisher 로 발행되어 AFTER_COMMIT 단계에서 {@link WikiSseDispatcher} 가
 * 받아 스페이스 멤버에게 브라우저 SSE(/api/v1/events)로 fan-out 한다 (#724).
 *
 * <p>AI 비서/타 세션이 노트를 생성·수정해도 열린 노트 화면이 리프레시 전까지 stale 이던 갭을 메운다. 페이로드는 프론트 쿼리키 무효화에 필요한 최소
 * 정보(spaceId·pageId)만 담는다 — 본문은 재조회로 가져오므로 싣지 않는다.
 */
public final class WikiDomainEvents {
  private WikiDomainEvents() {}

  /** 페이지 생성 직후. parentId 는 트리 위치. */
  public record WikiPageCreatedEvent(
      long spaceId, long pageId, Long parentId, String title, Long actorId, Instant occurredAt) {}

  /** 페이지 본문/제목 저장 직후. */
  public record WikiPageUpdatedEvent(
      long spaceId, long pageId, String title, Long actorId, Instant occurredAt) {}

  /** 페이지 삭제 직후(자식 CASCADE). */
  public record WikiPageDeletedEvent(long spaceId, long pageId, Long actorId, Instant occurredAt) {}

  /** 페이지 트리 이동(parent/position 변경) 직후 — 사이드바 트리 재조회용. */
  public record WikiPageMovedEvent(long spaceId, long pageId, Long actorId, Instant occurredAt) {}
}
