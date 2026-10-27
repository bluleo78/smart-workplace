package com.workplace.wiki.dto;

import java.util.List;

/**
 * 페이지를 다른 스페이스로 옮기기 전에 보여 주는 영향(WP-988) — 이동 대화상자의 경고 상자.
 *
 * @param pageCount 함께 옮겨 가는 페이지 수(옮길 페이지 자신 + 모든 하위)
 * @param lostMemberCount 원본 스페이스에만 있어 옮긴 뒤 더는 볼 수 없게 되는 멤버 수(대상 스페이스 멤버는 제외)
 * @param gainedMemberCount 대상 스페이스에만 있어 옮긴 뒤 새로 볼 수 있게 되는 멤버 수(노출 범위가 넓어지는 정도)
 * @param keptShares 토큰 그대로 함께 옮겨 가는 링크 공유
 * @param revokedShares 만든 사람이 대상 스페이스 편집자가 아니라 옮기면서 해제되는 링크 공유
 */
public record WikiMovePreviewResponse(
    int pageCount,
    int lostMemberCount,
    int gainedMemberCount,
    List<SharedPage> keptShares,
    List<SharedPage> revokedShares) {

  /** 공유가 걸린 페이지 — 공유 루트 id 와 제목(빈 제목이면 빈 문자열). */
  public record SharedPage(long pageId, String title) {}
}
