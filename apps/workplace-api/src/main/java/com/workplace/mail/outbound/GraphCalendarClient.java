package com.workplace.mail.outbound;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;

/**
 * Microsoft Graph API 캘린더 읽기 클라이언트.
 *
 * <p>/me/calendars (달력 목록) 와 /me/calendars/{id}/calendarView (구간 내 일정) 를 조회하며, {@code
 * @odata.nextLink} 를 끝까지 따라가 모든 페이지를 집계한다.
 *
 * <p>OAuth scope {@code Calendars.Read} 필요 — M365GraphProperties.SCOPE 에서 관리.
 */
@RequiredArgsConstructor
public class GraphCalendarClient {

  private final GraphApiClient api;

  // ── 응답 봉투 ────────────────────────────────────────────────────────────────

  /**
   * Graph /me/calendars 페이지 응답 봉투.
   *
   * @param value 캘린더 목록
   * @param nextLink 다음 페이지 절대 URL (없으면 null)
   */
  public record GraphCalendarPage(
      @JsonProperty("value") List<GraphCalendar> value,
      @JsonProperty("@odata.nextLink") String nextLink) {}

  /**
   * Graph calendarView 페이지 응답 봉투.
   *
   * @param value 일정 목록
   * @param nextLink 다음 페이지 절대 URL (없으면 null)
   */
  public record GraphEventPage(
      @JsonProperty("value") List<GraphEvent> value,
      @JsonProperty("@odata.nextLink") String nextLink) {}

  // ── 도메인 레코드 ─────────────────────────────────────────────────────────────

  /**
   * Graph 캘린더 개요.
   *
   * @param id 캘린더 고유 ID
   * @param name 표시 이름
   * @param color Graph 색상 키워드 (예: "auto", "lightBlue")
   * @param hexColor 16진수 색상 코드 (예: "#0078d4")
   * @param isDefaultCalendar 기본 캘린더 여부
   */
  public record GraphCalendar(
      String id, String name, String color, String hexColor, boolean isDefaultCalendar) {}

  /**
   * Graph 일정 항목.
   *
   * @param id 일정 고유 ID
   * @param subject 제목
   * @param bodyPreview 본문 미리보기
   * @param start 시작 시각
   * @param end 종료 시각
   * @param isAllDay 종일 일정 여부
   * @param location 위치
   * @param organizer 주최자
   * @param isCancelled 취소 여부
   */
  public record GraphEvent(
      String id,
      String subject,
      String bodyPreview,
      GraphDateTime start,
      GraphDateTime end,
      boolean isAllDay,
      GraphLocation location,
      GraphRecipient organizer,
      boolean isCancelled) {}

  /** Graph dateTimeTimeZone 구조 — dateTime + timeZone 문자열 쌍. */
  public record GraphDateTime(String dateTime, String timeZone) {}

  /** Graph location 구조 — 표시 이름만 사용. */
  public record GraphLocation(String displayName) {}

  /** Graph recipient 구조 — emailAddress 중첩. */
  public record GraphRecipient(GraphEmail emailAddress) {}

  /** Graph emailAddress 구조 — 이름 + 주소. */
  public record GraphEmail(String name, String address) {}

  // ── 조회 메서드 ───────────────────────────────────────────────────────────────

  /**
   * 본인 소유 달력 목록 조회 (/me/calendars).
   *
   * <p>{@code @odata.nextLink} 를 끝까지 따라가 모든 페이지를 집계한다.
   *
   * @param accessToken Graph API Bearer 토큰
   * @return 캘린더 목록 (빈 경우 빈 리스트)
   */
  public List<GraphCalendar> listCalendars(String accessToken) {
    List<GraphCalendar> all = new ArrayList<>();
    String url = "/me/calendars?$select=id,name,color,hexColor,isDefaultCalendar";
    while (url != null) {
      GraphCalendarPage page = api.get(accessToken, url, GraphCalendarPage.class);
      if (page.value() != null) all.addAll(page.value());
      url = page.nextLink(); // 절대 URL — GraphApiClient.get() 이 직접 수락
    }
    return all;
  }

  /**
   * 달력별 구간 내 일정 조회 (/me/calendars/{calendarId}/calendarView).
   *
   * <p>반복 일정은 occurrence 단위로 펼쳐진다(Graph calendarView 기본 동작). {@code @odata.nextLink} 를 끝까지 따라가 모든
   * 페이지를 집계한다.
   *
   * @param accessToken Graph API Bearer 토큰
   * @param calendarId 대상 캘린더 ID
   * @param from 구간 시작 (UTC OffsetDateTime)
   * @param to 구간 종료 (UTC OffsetDateTime)
   * @return 구간 내 일정 목록 (빈 경우 빈 리스트)
   */
  public List<GraphEvent> listCalendarView(
      String accessToken, String calendarId, OffsetDateTime from, OffsetDateTime to) {
    List<GraphEvent> all = new ArrayList<>();
    String start = URLEncoder.encode(from.toString(), StandardCharsets.UTF_8);
    String end = URLEncoder.encode(to.toString(), StandardCharsets.UTF_8);
    String url =
        "/me/calendars/"
            + calendarId
            + "/calendarView"
            + "?startDateTime="
            + start
            + "&endDateTime="
            + end
            + "&$select=id,subject,bodyPreview,start,end,isAllDay,location,organizer,isCancelled"
            + "&$top=200";
    while (url != null) {
      GraphEventPage page = api.get(accessToken, url, GraphEventPage.class);
      if (page.value() != null) all.addAll(page.value());
      url = page.nextLink(); // 절대 URL — GraphApiClient.get() 이 직접 수락
    }
    return all;
  }
}
