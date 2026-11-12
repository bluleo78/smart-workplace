package com.workplace.project.dto;

import java.time.Instant;

/**
 * 리포지토리 → 서비스 전달용 내부 row. 외부 응답에는 {@link ProjectResponse} 사용. repositoryUrl·repositoryBranch 는 연결된
 * 저장소(WP-1011, 없으면 null). nonMemberComment 는 OPEN 프로젝트에서 비멤버의 댓글을 허용하는 설정(WP-1495).
 * statusSummaryInterval 은 개요 「프로젝트 상태」 AI 요약의 갱신 간격(H1|H2|H4|DAILY, WP-1479).
 */
public record ProjectRow(
    Long id,
    String key,
    String name,
    String description,
    Long ownerId,
    String type,
    boolean isDefault,
    Instant createdAt,
    Instant updatedAt,
    String repositoryUrl,
    String repositoryBranch,
    boolean nonMemberComment,
    String statusSummaryInterval) {

  /** 개인 프로젝트인가 — 소유자만 보고, 다른 프로젝트와 관계를 맺지 않으며, 가져오기 대상이 아니다. */
  public boolean isPersonal() {
    return "PERSONAL".equals(type);
  }

  /**
   * 비멤버도 댓글을 달 수 있는 프로젝트인가(WP-1495) — 설정은 OPEN(접수함)에서만 뜻이 있다. 권한 가드와 이슈 상세 플래그가 이 한 곳의 규칙을 함께 써서
   * 화면의 입력 표시와 서버 판정이 어긋나지 않게 한다.
   */
  public boolean allowsNonMemberComment() {
    return "OPEN".equals(type) && nonMemberComment;
  }
}
