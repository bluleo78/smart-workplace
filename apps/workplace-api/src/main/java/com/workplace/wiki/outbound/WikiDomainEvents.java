package com.workplace.wiki.outbound;

import java.time.Instant;
import java.util.List;

/**
 * 노트(위키) 도메인 이벤트. 페이지 이벤트 4종은 ApplicationEventPublisher 로 발행되어 AFTER_COMMIT 단계에서 {@link
 * WikiSseDispatcher} 가 받아 스페이스 멤버에게 브라우저 SSE(/api/v1/events)로 fan-out 한다 (#724). 나머지 2종(멤버십 변경·접근
 * 회수)은 {@link WikiCollabRevalidator} 가 동기화 서버 연결 재검증에 쓴다(WP-285).
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

  /**
   * 스페이스 멤버 추가·역할 변경·제거 직후 — 동기화 서버 연결 재검증용(WP-285). tenantId 는 발행 시점에 담는다: AFTER_COMMIT 비동기 리스너는
   * 요청의 TenantContext 를 볼 수 없다.
   */
  public record WikiSpaceMembershipChangedEvent(
      long tenantId, long spaceId, long userId, Instant occurredAt) {}

  /**
   * 페이지 접근이 사라짐(삭제 — 자식 CASCADE 포함) — 동기화 서버 연결 재검증용(WP-285). pageIds 는 삭제 직전에 모은 서브트리 전체다(삭제 후에는
   * 자식을 조회할 수 없다). SSE 용 {@link WikiPageDeletedEvent} 와 분리해 기존 페이로드를 바꾸지 않는다.
   */
  public record WikiPageAccessRevokedEvent(
      long tenantId, long spaceId, List<Long> pageIds, Instant occurredAt) {}
}
