package com.workplace.wiki.dto;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 공유 창이 여는 상태(WP-579) — 웹 {@code WikiPageShareState} 와 같은 모양.
 *
 * @param share 이 페이지 자신의 공유(없으면 null)
 * @param externalShareEnabled 관리자가 외부 공유를 허용했는지 — 꺼져 있으면 공유 창이 「외부」 선택지를 막는다
 * @param inheritedFrom 이 페이지를 이미 보이게 하는 가장 가까운 상위 페이지의 하위 포함 공유(없으면 null)
 * @param accessRequests 이 공유에 들어온 대기 중 접근 요청(공유가 없으면 빈 목록)
 */
public record WikiPageShareStateResponse(
    WikiPageShareResponse share,
    boolean externalShareEnabled,
    Inherited inheritedFrom,
    List<AccessRequest> accessRequests) {

  /** 상위 페이지 공유 — 공유 창의 「「제목」 공유에 포함되어 링크로 보입니다」 안내와 그 페이지로 가기. */
  public record Inherited(long pageId, String title, String audience) {}

  /** 대기 중 접근 요청 한 건. */
  public record AccessRequest(long id, WikiSharePerson requester, OffsetDateTime requestedAt) {}
}
