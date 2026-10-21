package com.workplace.wiki.outbound;

import java.util.List;

/**
 * 노트 공유가 사람에게 알려야 할 일(WP-579) — 알림(notify 모듈)이 커밋 뒤에 받아 인박스에 넣는다. 공유 서비스는 알림 모듈을 직접 알지 못하고 이 이벤트만
 * 발행한다(도메인 간 통신은 이벤트). tenantId 는 발행 시점에 담는다 — 커밋 뒤 비동기 리스너는 요청의 TenantContext 를 볼 수 없다.
 */
public final class WikiShareNotifyEvents {
  private WikiShareNotifyEvents() {}

  /**
   * 공유하는 사람이 「알림 보내기」를 켜고 지정한 사람을 <b>새로</b> 추가했다 — 받는 사람마다 「○○님이 노트 「제목」을 공유했습니다」(링크 = 공유 링크).
   *
   * @param actorId 공유한 사람
   * @param recipientIds 이번 저장에서 새로 추가된 사람만(이미 있던 사람은 제외)
   * @param message 공유하는 사람이 덧붙인 메시지(없으면 null)
   */
  public record WikiSharedWithPeopleEvent(
      long tenantId, long pageId, long actorId, List<Long> recipientIds, String message) {}

  /**
   * 지정한 사람이 아닌 사람이 접근을 요청했다 — 공유를 만든 사람에게 알린다(링크 = 그 페이지 + 공유 창 열기).
   *
   * @param pageId 공유 루트 페이지
   * @param sharerId 공유를 만든 사람(알림 받는 사람)
   */
  public record WikiShareAccessRequestedEvent(
      long tenantId, long pageId, long requesterId, long sharerId) {}

  /**
   * 접근 요청이 승인됐다 — 요청자에게 알린다(링크 = 공유 링크).
   *
   * @param approverId 승인한 사람
   */
  public record WikiShareAccessApprovedEvent(
      long tenantId, long pageId, long approverId, long requesterId) {}
}
