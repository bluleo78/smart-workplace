package com.workplace.wiki.outbound;

import java.time.Instant;
import java.util.List;

/**
 * 노트(위키) 도메인 이벤트. 페이지 이벤트 4종은 ApplicationEventPublisher 로 발행되어 AFTER_COMMIT 단계에서 {@link
 * WikiSseDispatcher} 가 받아 스페이스 멤버에게 브라우저 SSE(/api/v1/events)로 fan-out 한다 (#724). 나머지(멤버십 변경·접근
 * 회수·공유 범위 축소)는 {@link WikiCollabRevalidator} 가 동기화 서버 연결 재검증에 쓴다(WP-285·WP-579).
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
   * 스페이스에 조직도 부서로 들어오는 사람이 바뀌었을 수 있다(WP-1052) — 멤버 부서 행의 추가·역할 변경·제거, 멤버로 둔 부서(하위 포함)의 구성원 감소. 부서
   * 변화는 누가 들고 났는지 사람 단위로 알려 주지 않으므로 스페이스 단위로 낸다. 커밋 직전 같은 트랜잭션에서 편집 권한을 잃은 사람이 만든 공유를 정리하고 ({@code
   * WikiSpaceMemberGroupService}), 커밋 뒤 동기화 서버가 그 스페이스의 열린 연결을 모두 다시 판정한다({@link
   * WikiCollabRevalidator}). tenantId 는 발행 시점에 담는다(비동기 리스너는 요청의 TenantContext 를 못 본다).
   */
  public record WikiSpaceAudienceChangedEvent(long tenantId, List<Long> spaceIds) {}

  /**
   * 스페이스에 조직도 부서로 들어오는 사람이 <b>늘기만</b> 했다(WP-1166) — 멤버로 둔 부서(하위 포함)의 구성원 증가. 부서로 역할이 오를 수 있어(직접 보기
   * 전용 → 부서로 편집자) 커밋 뒤 동기화 서버가 열린 연결을 새 역할로 다시 판정하게 한다({@link WikiCollabRevalidator}). 편집을 잃은 사람이
   * 없으니 {@link WikiSpaceAudienceChangedEvent} 와 달리 공유 정리는 돌지 않는다.
   */
  public record WikiSpaceAudienceGrownEvent(long tenantId, List<Long> spaceIds) {}

  /**
   * 페이지 접근이 사라짐(삭제 — 자식 CASCADE 포함) — 동기화 서버 연결 재검증용(WP-285). pageIds 는 삭제 직전에 모은 서브트리 전체다(삭제 후에는
   * 자식을 조회할 수 없다). SSE 용 {@link WikiPageDeletedEvent} 와 분리해 기존 페이로드를 바꾸지 않는다. 삭제 전용 — 수신기가 사유
   * "deleted"(4404)로 재검증하므로, 삭제가 아닌 접근 회수(제한·이동 등)에 재사용하려면 사유 필드를 먼저 추가할 것(WP-296).
   */
  public record WikiPageAccessRevokedEvent(
      long tenantId, long spaceId, List<Long> pageIds, Instant occurredAt) {}

  /**
   * 페이지(서브트리)가 다른 스페이스로 옮겨 갔다(WP-988) — 동기화 서버가 그 페이지들의 열린 연결을 모두 다시 판정해, 새 스페이스 멤버가 아닌 사람의 연결을 권한
   * 회수(4403)로 닫는다. pageIds 는 옮긴 서브트리 전체. tenantId 는 발행 시점에 담는다(비동기 리스너는 요청의 TenantContext 를 못 본다).
   */
  public record WikiPageSpaceChangedEvent(long tenantId, List<Long> pageIds) {}

  /**
   * 공유 링크로 열 수 있는 범위가 줄었다(WP-579) — 해제·재발급·대상 축소·사람 제외·권한 축소·만료 앞당김. 커밋 뒤 동기화 서버가 이 페이지들의 열린 연결을 다시
   * 판정해, 공유로 붙은 연결 중 이제 열 수 없는 것을 권한 회수(4403)로 닫는다(멤버로 붙은 연결은 공유 변경으로 권한이 바뀌지 않아 대상이 아니다). pageIds
   * 는 바뀌기 전 공유가 덮던 페이지 — 하위 포함이었으면 지금 서브트리 전체, 여러 공유를 함께 해제했으면(스페이스를 가로질러도) 그 합집합. 재검증은 페이지로만 연결을
   * 찾으므로 스페이스는 싣지 않는다. tenantId 는 발행 시점에 담는다(비동기 리스너는 요청의 TenantContext 를 못 본다).
   */
  public record WikiShareAccessChangedEvent(long tenantId, List<Long> pageIds) {}
}
