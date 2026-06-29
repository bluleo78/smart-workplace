package com.workplace.mail.outbound;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;

/**
 * Microsoft Graph API 캘린더 읽기·쓰기 클라이언트.
 *
 * <p>/me/calendars (달력 목록) 와 /me/calendars/{id}/calendarView (구간 내 일정) 조회, 일정 생성·수정·삭제를 담당하며,
 * {@code @odata.nextLink} 를 끝까지 따라가 모든 페이지를 집계한다.
 *
 * <p>OAuth scope {@code Calendars.ReadWrite} 필요 — M365GraphProperties.SCOPE 에서 관리.
 */
@RequiredArgsConstructor
public class GraphCalendarClient {

  private final GraphApiClient api;
  private final ObjectMapper mapper; // GraphEventWrite 직렬화용

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
   * @param canEdit 편집 가능 여부 (공휴일·생일 캘린더는 false)
   */
  public record GraphCalendar(
      String id,
      String name,
      String color,
      String hexColor,
      boolean isDefaultCalendar,
      boolean canEdit) {}

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

  /** Graph event body — contentType("text"|"html") + content. */
  public record GraphItemBody(String contentType, String content) {}

  /**
   * Graph 일정 쓰기 페이로드 — 생성/수정 공용. 참석자·반복은 미포함(#547/#546).
   *
   * <p>{@code @JsonInclude(NON_NULL)} 필수: 본문/장소가 없는 일정은 {@code body}/{@code location} 이 null 인데,
   * Graph 는 {@code "body": null} 을 받으면 400 ErrorInvalidRequest("The body of the item is invalid") 로
   * 거부한다. null 필드는 직렬화에서 생략해 키 자체를 빼야 한다(라이브 스모크에서 적발).
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record GraphEventWrite(
      String subject,
      GraphItemBody body,
      GraphDateTime start,
      GraphDateTime end,
      boolean isAllDay,
      GraphLocation location) {}

  /** Graph 일정 생성 응답 — id 만 사용. */
  public record GraphEventCreated(@JsonProperty("id") String id) {}

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
    String url = "/me/calendars?$select=id,name,color,hexColor,isDefaultCalendar,canEdit";
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

  // ── 쓰기 메서드 ───────────────────────────────────────────────────────────────

  /**
   * 외부 캘린더에 일정을 생성한다(POST /me/calendars/{calendarId}/events).
   *
   * @param accessToken Graph API Bearer 토큰
   * @param externalCalendarId 대상 캘린더 Graph ID
   * @param body 생성 페이로드 (제목·본문·시작·종료·종일·장소)
   * @return 생성된 Graph 일정 id (역동기화 external_id 로 로컬 저장)
   */
  public String createEvent(String accessToken, String externalCalendarId, GraphEventWrite body) {
    String json = serialize(body);
    GraphEventCreated created =
        api.post(
            accessToken,
            "/me/calendars/" + externalCalendarId + "/events",
            json,
            GraphEventCreated.class);
    return created.id();
  }

  /**
   * 외부 일정을 수정한다(PATCH /me/events/{id}).
   *
   * <p>종일 일정 start/end 는 DB 저장값(half-open) 그대로 전송 — minusDays(1) 변환 금지.
   *
   * @param accessToken Graph API Bearer 토큰
   * @param externalEventId 수정할 Graph 일정 ID
   * @param body 수정 페이로드
   */
  public void updateEvent(String accessToken, String externalEventId, GraphEventWrite body) {
    api.patch(accessToken, "/me/events/" + externalEventId, serialize(body));
  }

  /**
   * 외부 일정을 삭제한다(DELETE /me/events/{id}).
   *
   * <p>404 는 {@link GraphApiClient} 가 성공으로 처리한다.
   *
   * @param accessToken Graph API Bearer 토큰
   * @param externalEventId 삭제할 Graph 일정 ID
   */
  public void deleteEvent(String accessToken, String externalEventId) {
    api.delete(accessToken, "/me/events/" + externalEventId);
  }

  /**
   * GraphEventWrite 를 JSON 문자열로 직렬화한다.
   *
   * @throws com.workplace.mail.exception.MailSendException 직렬화 실패 시
   */
  private String serialize(GraphEventWrite body) {
    try {
      return mapper.writeValueAsString(body);
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      throw new com.workplace.mail.exception.MailSendException("Graph 일정 직렬화 실패", e);
    }
  }
}
