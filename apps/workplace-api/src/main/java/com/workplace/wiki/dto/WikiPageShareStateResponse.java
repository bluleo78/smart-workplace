package com.workplace.wiki.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 공유 창이 여는 상태(WP-579) — 웹 {@code WikiPageShareState} 와 같은 모양.
 *
 * @param share 이 페이지 자신의 공유(없으면 null)
 * @param externalShareEnabled 관리자가 외부 공유를 허용했는지 — 꺼져 있으면 공유 창이 「외부」 선택지를 막는다
 * @param inheritedFrom 이 페이지가 상속받는 가장 가까운 상위 페이지의 하위 포함 공유(없으면 null) — 이 페이지가 제외 표시를 달았어도 보인다
 * @param accessRequests 이 공유에 들어온 대기 중 접근 요청(공유가 없으면 빈 목록)
 * @param excludedFromParent 이 페이지에 「이 페이지와 하위는 상위 공유에서 제외」 표시가 있는지(WP-987)
 * @param excludedPages 이 페이지의 하위 포함 공유에서 제외된 하위 페이지(공유가 없거나 하위 포함이 아니면 빈 목록, WP-987)
 */
public record WikiPageShareStateResponse(
    WikiPageShareResponse share,
    boolean externalShareEnabled,
    Inherited inheritedFrom,
    List<AccessRequest> accessRequests,
    boolean excludedFromParent,
    List<ExcludedPage> excludedPages) {

  /**
   * 상위 페이지 공유 — 공유 창의 「상위 공유에서 받은 권한」 상자(WP-987): 범위·권한과 그 페이지로 가기, 「이 페이지 링크 복사」. token 은 상위 공유의
   * 지금 토큰이다 — 링크 {@code /wiki/share/<token>/pages/<이 페이지>} 를 만든다. 공유 창 상태는 EDITOR 이상만 받으므로 상위 공유
   * 창에서 볼 수 있는 토큰과 같은 범위다.
   */
  public record Inherited(
      long pageId, String title, String audience, String permission, String token) {}

  /** 상위 공유에서 제외된 하위 페이지 — 상위 공유 창의 「제외: … [제외 풀기]」. */
  public record ExcludedPage(long pageId, String title) {}

  /** 대기 중 접근 요청 한 건. */
  public record AccessRequest(long id, WikiSharePerson requester, OffsetDateTime requestedAt) {}
}
