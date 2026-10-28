package com.workplace.home.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.global.dto.UserSummary;
import java.util.List;

/**
 * 채팅 본문의 우리 앱 링크 카드(WP-896) — 링크를 보는 사람의 권한으로 그 순간 채운다(저장하지 않는다). 종류마다 쓰는 칸만 싣는다.
 *
 * @param kind ISSUE | PAGE | FILE
 * @param title 이슈 제목 / 노트 제목 / 파일 이름
 * @param issueKey ISSUE — KEY-N
 * @param statusName ISSUE — 상태 이름
 * @param statusCategory ISSUE — 상태 범주(TODO·IN_PROGRESS·DONE·CANCELED — 배지 색, 다른 이슈 화면과 같다)
 * @param assignees ISSUE — 담당자
 * @param priority ISSUE — 우선순위(HIGHEST·HIGH·MID·LOW·LOWEST)
 * @param spaceName PAGE — 노트 스페이스 이름
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AppLinkCard(
    String kind,
    String title,
    String issueKey,
    String statusName,
    String statusCategory,
    List<UserSummary> assignees,
    String priority,
    String spaceName) {

  /** 이슈 카드. */
  public static AppLinkCard issue(
      String issueKey,
      String title,
      String statusName,
      String statusCategory,
      List<UserSummary> assignees,
      String priority) {
    return new AppLinkCard(
        "ISSUE", title, issueKey, statusName, statusCategory, assignees, priority, null);
  }

  /** 노트 카드. */
  public static AppLinkCard page(String title, String spaceName) {
    return new AppLinkCard("PAGE", title, null, null, null, null, null, spaceName);
  }

  /** 파일 카드. */
  public static AppLinkCard file(String name) {
    return new AppLinkCard("FILE", name, null, null, null, null, null, null);
  }
}
