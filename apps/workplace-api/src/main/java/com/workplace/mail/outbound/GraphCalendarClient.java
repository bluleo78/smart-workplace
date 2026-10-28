package com.workplace.mail.outbound;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
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

  /**
   * 일정 본문을 HTML 대신 텍스트로 받는 Prefer 헤더(WP-709). HTML→텍스트 변환을 Graph 가 해 주므로 변환기를 직접 만들지 않는다. nextLink
   * 로 이어지는 페이지에도 매번 붙여야 같은 형식으로 온다.
   */
  static final Map<String, String> BODY_AS_TEXT =
      Map.of("Prefer", "outlook.body-content-type=\"text\"");

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
   * @param owner 달력 주인 사서함(WP-716) — 기본 달력의 주인과 같으면 내 사서함 달력이다. 편집 권한으로 공유받은 동료 달력은 canEdit=true 여도
   *     주인이 다르다. 응답에 없으면 null
   */
  public record GraphCalendar(
      String id,
      String name,
      String color,
      String hexColor,
      boolean isDefaultCalendar,
      boolean canEdit,
      GraphEmail owner) {}

  /**
   * Graph 일정 항목.
   *
   * @param id 일정 고유 ID
   * @param subject 제목
   * @param bodyPreview 본문 미리보기(255자까지)
   * @param body 본문 전체 — listCalendarView 가 {@code Prefer: outlook.body-content-type="text"} 로 요청해
   *     텍스트로 온다
   * @param start 시작 시각
   * @param end 종료 시각
   * @param isAllDay 종일 일정 여부
   * @param location 위치
   * @param organizer 주최자
   * @param attendees 참석자 목록 (Graph 응답에 없으면 null)
   * @param isCancelled 취소 여부
   * @param iCalUId 공급자 표준 미팅 식별자 — 크로스소스 dedup 키
   * @param onlineMeeting 온라인 회의 정보 — joinUrl 만 사용(WP-710)
   * @param categories Outlook 범주 이름 목록(WP-714) — 캘린더 주인의 태그로 동기화한다. 응답에 없으면 null(태그를 건드리지 않음)
   * @param seriesMasterId 반복 회의 회차·예외 회차면 그 시리즈 마스터 id(WP-716), 단일 일정이면 null — 앱에서 태그를 바꿀 때 범주를 시리즈
   *     마스터에 써 넣는다
   * @param type Graph 일정 종류(WP-716) — singleInstance | occurrence | exception | seriesMaster. 태그를 써
   *     넣은 뒤 Outlook 이 실제로 바꿔 보일 로컬 행(같은 시리즈의 occurrence)을 고르는 데 쓴다. 응답에 없으면 null
   */
  public record GraphEvent(
      String id,
      String subject,
      String bodyPreview,
      GraphItemBody body,
      GraphDateTime start,
      GraphDateTime end,
      boolean isAllDay,
      GraphLocation location,
      GraphRecipient organizer,
      List<GraphEventAttendee> attendees,
      boolean isCancelled,
      String iCalUId,
      GraphOnlineMeeting onlineMeeting,
      List<String> categories,
      String seriesMasterId,
      String type) {}

  /** Graph onlineMeetingInfo 구조 — 참가 주소만 사용(WP-710). */
  public record GraphOnlineMeeting(String joinUrl) {}

  /** Graph dateTimeTimeZone 구조 — dateTime + timeZone 문자열 쌍. */
  public record GraphDateTime(String dateTime, String timeZone) {}

  /** Graph location 구조 — 표시 이름만 사용. */
  public record GraphLocation(String displayName) {}

  /** Graph recipient 구조 — emailAddress 중첩. */
  public record GraphRecipient(GraphEmail emailAddress) {}

  /** Graph emailAddress 구조 — 이름 + 주소. */
  public record GraphEmail(String name, String address) {}

  /** Graph attendee 항목 — emailAddress + status(응답상태) + type(required|optional). */
  public record GraphEventAttendee(
      GraphEmail emailAddress, GraphAttendeeStatus status, String type) {}

  /** Graph attendee 응답상태 — response(none|accepted|declined|tentativelyAccepted|notResponded). */
  public record GraphAttendeeStatus(String response, String time) {}

  /** Graph event body — contentType("text"|"html") + content. */
  public record GraphItemBody(String contentType, String content) {}

  /**
   * Graph 일정 쓰기 페이로드 — 생성/수정 공용.
   *
   * <p>{@code @JsonInclude(NON_NULL)} 필수: 본문/장소가 없는 일정은 {@code body}/{@code location} 이 null 인데,
   * Graph 는 {@code "body": null} 을 받으면 400 ErrorInvalidRequest("The body of the item is invalid") 로
   * 거부한다. null 필드는 직렬화에서 생략해 키 자체를 빼야 한다(라이브 스모크에서 적발). {@code attendees} 도 null 이면 생략 — 참석자 없는 일정
   * 생성 시 Graph 오류 방지.
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record GraphEventWrite(
      String subject,
      GraphItemBody body,
      GraphDateTime start,
      GraphDateTime end,
      boolean isAllDay,
      GraphLocation location,
      List<GraphAttendeeWrite> attendees) {}

  /** Graph 일정 쓰기 attendee — emailAddress + type("required"|"optional"). */
  public record GraphAttendeeWrite(GraphEmail emailAddress, String type) {}

  /**
   * attendees 만 갱신하는 부분 PATCH 봉투(제목·시각 등 다른 필드 미전송).
   *
   * <p>{@code @JsonInclude(NON_NULL)} 을 붙여 null attendees 가 직렬화되지 않도록 한다.
   */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record GraphAttendeesPatch(List<GraphAttendeeWrite> attendees) {}

  /**
   * 범주만 바꾸는 부분 PATCH 봉투(WP-716) — 제목·시각 등 다른 필드는 보내지 않는다.
   *
   * <p>빈 목록도 그대로 직렬화해야 한다({@code "categories":[]} = 모든 범주 떼기). 그래서 NON_EMPTY 가 아니라 기본 포함 규칙을 쓴다.
   */
  public record GraphCategoriesPatch(List<String> categories) {}

  /**
   * 범주 써 넣기 직전에 읽는 일정의 현재 상태(WP-716) — 앱이 마지막 동기화 뒤 모르는 Outlook 범주를 덮지 않도록 바뀐 것만 더하고 빼는 바탕이고, 써 넣을
   * 대상(회차면 시리즈 마스터)도 저장값이 아니라 이 값으로 정한다.
   *
   * @param id Graph 일정 id
   * @param type singleInstance | occurrence | exception | seriesMaster
   * @param seriesMasterId 반복 회의 회차·예외 회차면 시리즈 마스터 id
   * @param categories 지금 붙은 범주 이름 그대로(없으면 null 또는 빈 목록)
   */
  public record GraphEventCategoryState(
      String id, String type, String seriesMasterId, List<String> categories) {}

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
    String url = "/me/calendars?$select=id,name,color,hexColor,isDefaultCalendar,canEdit,owner";
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
            + "&$select=id,subject,bodyPreview,body,start,end,isAllDay,location,organizer,attendees,isCancelled,iCalUId,onlineMeeting,categories,seriesMasterId,type"
            + "&$top=50";
    while (url != null) {
      GraphEventPage page = api.get(accessToken, url, GraphEventPage.class, BODY_AS_TEXT);
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
   * 외부 일정의 참석자 컬렉션만 교체한다(PATCH /me/events/{id}, body={"attendees":[...]}).
   *
   * <p>제목·시각 등은 보내지 않아 Graph 측 다른 필드를 덮어쓰지 않는다(부분 PATCH).
   *
   * @param accessToken Graph API Bearer 토큰
   * @param externalEventId 수정할 Graph 일정 ID
   * @param attendees 새 참석자 목록
   */
  public void patchAttendees(
      String accessToken, String externalEventId, List<GraphAttendeeWrite> attendees) {
    String json = serializeAttendees(new GraphAttendeesPatch(attendees));
    api.patch(accessToken, "/me/events/" + externalEventId, json);
  }

  /**
   * 외부 일정의 Outlook 범주만 바꾼다(PATCH /me/events/{id}, body={"categories":[...]}) — 앱 태그 써 넣기(WP-716).
   *
   * <p>목록에 없는 범주(masterCategories 에 없는 이름)도 일정에는 붙고 Outlook 에서 색 없이 보인다. 범주 목록에 새로 만들려면 {@code
   * MailboxSettings.ReadWrite} 권한이 필요해 모든 사용자의 M365 재연결을 부르므로 만들지 않는다.
   *
   * @param accessToken Graph API Bearer 토큰
   * @param externalEventId 바꿀 Graph 일정 id(반복 회의면 시리즈 마스터 id)
   * @param categories 붙일 범주 이름 전체(빈 목록이면 모두 뗀다)
   */
  public void patchCategories(String accessToken, String externalEventId, List<String> categories) {
    String json;
    try {
      json = mapper.writeValueAsString(new GraphCategoriesPatch(categories));
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      // 메일 보내기 실패(MailSendException)로 보이지 않게 메일과 무관한 예외를 던진다. calendar 예외를 직접 쓰면
      // mail → calendar 패키지 순환이 생기므로, 502 변환은 GraphCalendarTransport 의 catch(RuntimeException)에
      // 맡긴다.
      throw new IllegalStateException("Graph 범주 직렬화 실패", e);
    }
    api.patch(accessToken, "/me/events/" + externalEventId, json);
  }

  /**
   * 일정 하나의 현재 종류·시리즈 마스터 id·범주를 읽는다(GET /me/events/{id}?$select=type,seriesMasterId,categories) —
   * 범주 써 넣기 직전(WP-716). 반복 회의 회차 id 로 읽어도 회차의 범주(= 마스터 범주)와 시리즈 마스터 id 가 온다.
   *
   * @param accessToken Graph API Bearer 토큰
   * @param externalEventId 읽을 Graph 일정 id
   */
  public GraphEventCategoryState getEventCategoryState(String accessToken, String externalEventId) {
    return api.get(
        accessToken,
        "/me/events/" + externalEventId + "?$select=id,type,seriesMasterId,categories",
        GraphEventCategoryState.class);
  }

  /**
   * WP-986: 초대 메일(eventMessage)에 이어진 내 일정의 Graph id. {@code
   * $expand=microsoft.graph.eventMessage/event} 는 Graph 문서의 eventMessage 조회 방식이다 — 메일 하나가 가리키는 일정을
   * UID 검색 없이 바로 얻는다(반복 회의도 시리즈 마스터). 이어진 일정이 없으면(이미 지워짐 등) 빈 값.
   */
  public Optional<String> findEventIdForMessage(String accessToken, String messageId) {
    JsonNode node =
        api.get(
            accessToken,
            "/me/messages/" + messageId + "?$select=id&$expand=microsoft.graph.eventMessage/event",
            JsonNode.class);
    if (node == null) return Optional.empty();
    String id = node.path("event").path("id").asText(null);
    return id == null || id.isBlank() ? Optional.empty() : Optional.of(id);
  }

  /**
   * WP-986: iCalendar UID 로 내 일정의 Graph id 를 찾는다 — 메일에 이어진 일정을 얻지 못했을 때의 대안. 값 안의 작은따옴표는 OData 규칙대로
   * 두 번 쓴다.
   */
  public Optional<String> findEventIdByICalUid(String accessToken, String iCalUid) {
    String filter = "iCalUId eq '" + iCalUid.replace("'", "''") + "'";
    JsonNode node =
        api.get(
            accessToken,
            "/me/events?$select=id&$top=1&$filter="
                + URLEncoder.encode(filter, StandardCharsets.UTF_8).replace("+", "%20"),
            JsonNode.class);
    if (node == null) return Optional.empty();
    String id = node.path("value").path(0).path("id").asText(null);
    return id == null || id.isBlank() ? Optional.empty() : Optional.of(id);
  }

  /**
   * WP-986: 일정 초대에 응답한다 — {@code POST /me/events/{id}/accept|tentativelyAccept|decline}, {@code
   * sendResponse=true} 라 Exchange 가 주최자에게 응답 메일을 보내고 내 일정 상태도 바꾼다.
   *
   * @param response ACCEPTED·TENTATIVE·DECLINED
   * @throws com.workplace.mail.exception.MailSendException Graph 오류
   */
  public void respondToEvent(String accessToken, String eventId, String response) {
    String action =
        switch (response) {
          case "ACCEPTED" -> "accept";
          case "TENTATIVE" -> "tentativelyAccept";
          case "DECLINED" -> "decline";
          default -> throw new IllegalArgumentException("알 수 없는 응답: " + response);
        };
    api.postNoContent(
        accessToken, "/me/events/" + eventId + "/" + action, "{\"sendResponse\":true}");
  }

  /**
   * Graph attendee responseStatus.response → 로컬 rsvp_status 문자열로 변환한다.
   *
   * <p>미인식·null 은 {@code "NEEDS_ACTION"} 으로 폴백한다.
   *
   * @param response Graph 응답 문자열
   *     (accepted|organizer|declined|tentativelyAccepted|none|notResponded|null)
   * @return "ACCEPTED"|"DECLINED"|"TENTATIVE"|"NEEDS_ACTION"
   */
  public static String rsvpFromGraphResponse(String response) {
    if (response == null) return "NEEDS_ACTION";
    return switch (response) {
      case "accepted", "organizer" -> "ACCEPTED";
      case "declined" -> "DECLINED";
      case "tentativelyAccepted" -> "TENTATIVE";
      default -> "NEEDS_ACTION"; // none, notResponded, 기타
    };
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

  /**
   * GraphAttendeesPatch 를 JSON 문자열로 직렬화한다.
   *
   * @throws com.workplace.mail.exception.MailSendException 직렬화 실패 시
   */
  private String serializeAttendees(GraphAttendeesPatch patch) {
    try {
      return mapper.writeValueAsString(patch);
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      throw new com.workplace.mail.exception.MailSendException("Graph 참석자 직렬화 실패", e);
    }
  }
}
