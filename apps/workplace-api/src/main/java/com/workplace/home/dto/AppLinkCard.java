package com.workplace.home.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.global.dto.UserSummary;
import java.time.Instant;
import java.util.List;

/**
 * 채팅 본문의 우리 앱 링크 카드(WP-896) — 링크를 보는 사람의 권한으로 그 순간 채운다(저장하지 않는다). 종류마다 쓰는 칸만 싣는다.
 *
 * @param kind ISSUE | PAGE | FILE | MESSAGE | EVENT | MAIL
 * @param title 이슈 제목 / 노트 제목 / 파일 이름 / 메시지 본문 미리보기 / 일정 제목 / 메일 제목
 * @param issueKey ISSUE — KEY-N
 * @param statusName ISSUE — 상태 이름
 * @param statusCategory ISSUE — 상태 범주(TODO·IN_PROGRESS·DONE·CANCELED — 배지 색, 다른 이슈 화면과 같다)
 * @param assignees ISSUE — 담당자
 * @param priority ISSUE — 우선순위(HIGHEST·HIGH·MID·LOW·LOWEST)
 * @param spaceName PAGE — 노트 스페이스 이름
 * @param channelName MESSAGE — 채널 이름. DM 이면 보는 사람 기준 상대 이름(대화 목록과 같은 표기)
 * @param channelKind MESSAGE — CHANNEL | DM
 * @param authorName MESSAGE — 보낸 사람 이름 / MAIL — 보낸 사람 표시 이름(없으면 주소)
 * @param sentAt MESSAGE — 보낸 시각 / MAIL — 메일 날짜(Date 헤더, 없으면 받은 시각)
 * @param startAt EVENT — 시작 시각
 * @param endAt EVENT — 끝 시각
 * @param allDay EVENT — 종일 일정인지
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
    String spaceName,
    String channelName,
    String channelKind,
    String authorName,
    Instant sentAt,
    Instant startAt,
    Instant endAt,
    Boolean allDay) {

  /** 이슈 카드. */
  public static AppLinkCard issue(
      String issueKey,
      String title,
      String statusName,
      String statusCategory,
      List<UserSummary> assignees,
      String priority) {
    return new AppLinkCard(
        "ISSUE",
        title,
        issueKey,
        statusName,
        statusCategory,
        assignees,
        priority,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null);
  }

  /** 노트 카드. */
  public static AppLinkCard page(String title, String spaceName) {
    return new AppLinkCard(
        "PAGE", title, null, null, null, null, null, spaceName, null, null, null, null, null, null,
        null);
  }

  /** 파일 카드. */
  public static AppLinkCard file(String name) {
    return new AppLinkCard(
        "FILE", name, null, null, null, null, null, null, null, null, null, null, null, null, null);
  }

  /** 채널·DM 메시지 카드(WP-1236) — 본문 미리보기·대화 이름·보낸 사람·보낸 시각. */
  public static AppLinkCard message(
      String preview, String channelName, String channelKind, String authorName, Instant sentAt) {
    return new AppLinkCard(
        "MESSAGE",
        preview,
        null,
        null,
        null,
        null,
        null,
        null,
        channelName,
        channelKind,
        authorName,
        sentAt,
        null,
        null,
        null);
  }

  /** 일정 카드(WP-1236) — 제목·시작·끝·종일 여부. */
  public static AppLinkCard event(String title, Instant startAt, Instant endAt, boolean allDay) {
    return new AppLinkCard(
        "EVENT", title, null, null, null, null, null, null, null, null, null, null, startAt, endAt,
        allDay);
  }

  /** 메일 카드(WP-1236) — 제목·보낸 사람·메일 날짜. 본문은 싣지 않는다. */
  public static AppLinkCard mail(String subject, String fromName, Instant sentAt) {
    return new AppLinkCard(
        "MAIL", subject, null, null, null, null, null, null, null, null, fromName, sentAt, null,
        null, null);
  }
}
