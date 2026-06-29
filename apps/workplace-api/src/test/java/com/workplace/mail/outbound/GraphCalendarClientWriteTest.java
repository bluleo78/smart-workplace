package com.workplace.mail.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.mail.outbound.GraphCalendarClient.GraphDateTime;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEventCreated;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEventWrite;
import com.workplace.mail.outbound.GraphCalendarClient.GraphItemBody;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** GraphCalendarClient 쓰기 경로 단위 테스트 — GraphApiClient 를 모킹해 경로·직렬화를 검증한다. */
class GraphCalendarClientWriteTest {

  private final GraphApiClient api = mock(GraphApiClient.class);
  private final GraphCalendarClient client = new GraphCalendarClient(api, new ObjectMapper());

  private GraphEventWrite timed() {
    return new GraphEventWrite(
        "회의",
        new GraphItemBody("text", "본문"),
        new GraphDateTime("2026-07-10T09:00:00", "UTC"),
        new GraphDateTime("2026-07-10T10:00:00", "UTC"),
        false,
        null);
  }

  @Test
  void createEvent_posts_to_calendar_events_and_returns_id() {
    when(api.post(
            eq("tok"),
            eq("/me/calendars/gcal/events"),
            org.mockito.ArgumentMatchers.anyString(),
            eq(GraphEventCreated.class)))
        .thenReturn(new GraphEventCreated("NEW1"));
    String id = client.createEvent("tok", "gcal", timed());
    assertThat(id).isEqualTo("NEW1");

    ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
    verify(api)
        .post(
            eq("tok"),
            eq("/me/calendars/gcal/events"),
            json.capture(),
            eq(GraphEventCreated.class));
    // 직렬화 JSON 에 핵심 필드 포함 — dateTime/timeZone 분리·isAllDay
    assertThat(json.getValue()).contains("\"subject\":\"회의\"");
    assertThat(json.getValue()).contains("\"dateTime\":\"2026-07-10T09:00:00\"");
    assertThat(json.getValue()).contains("\"timeZone\":\"UTC\"");
    assertThat(json.getValue()).contains("\"isAllDay\":false");
  }

  /**
   * 본문/장소 없는 일정 직렬화 — body/location 이 null 이면 JSON 키 자체를 생략해야 한다. Graph 는 {@code "body": null} 을
   * 400 ErrorInvalidRequest 로 거부하므로(라이브 스모크 적발), {@code @JsonInclude(NON_NULL)} 동작을 고정한다.
   */
  @Test
  void createEvent_omits_null_body_and_location() {
    GraphEventWrite noBodyNoLocation =
        new GraphEventWrite(
            "[스모크] 시각 일정 생성",
            null, // body 없음
            new GraphDateTime("2026-06-29T01:51:00", "UTC"),
            new GraphDateTime("2026-06-29T02:51:00", "UTC"),
            false,
            null); // location 없음
    when(api.post(
            eq("tok"),
            eq("/me/calendars/gcal/events"),
            org.mockito.ArgumentMatchers.anyString(),
            eq(GraphEventCreated.class)))
        .thenReturn(new GraphEventCreated("NEW2"));
    client.createEvent("tok", "gcal", noBodyNoLocation);

    ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
    verify(api)
        .post(
            eq("tok"),
            eq("/me/calendars/gcal/events"),
            json.capture(),
            eq(GraphEventCreated.class));
    // null 필드 키가 통째로 빠져야 함 — "body":null / "location":null 금지(Graph 400 유발).
    assertThat(json.getValue()).doesNotContain("\"body\"");
    assertThat(json.getValue()).doesNotContain("\"location\"");
    assertThat(json.getValue()).doesNotContain("null");
    // 존재 필드는 정상 직렬화.
    assertThat(json.getValue()).contains("\"subject\":\"[스모크] 시각 일정 생성\"");
    assertThat(json.getValue()).contains("\"isAllDay\":false");
  }

  @Test
  void updateEvent_patches_event_path() {
    client.updateEvent("tok", "EV9", timed());
    verify(api).patch(eq("tok"), eq("/me/events/EV9"), org.mockito.ArgumentMatchers.anyString());
  }

  @Test
  void deleteEvent_deletes_event_path() {
    client.deleteEvent("tok", "EV9");
    verify(api).delete("tok", "/me/events/EV9");
  }

  /** 종일 일정 직렬화 무변환 계약 — isAllDay=true 일 때 종료일(half-open end)을 minusDays 하지 않고 그대로 전송해야 한다. */
  @Test
  void createEvent_allDay_serializes_verbatim_no_date_adjustment() {
    GraphEventWrite allDay =
        new GraphEventWrite(
            "워크숍",
            new GraphItemBody("text", ""),
            new GraphDateTime("2026-07-10T00:00:00", "UTC"),
            new GraphDateTime("2026-07-11T00:00:00", "UTC"), // half-open, 그대로
            true,
            null);
    when(api.post(
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.anyString(),
            eq(GraphEventCreated.class)))
        .thenReturn(new GraphEventCreated("X1"));
    client.createEvent("tok", "gcal", allDay);
    ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
    verify(api)
        .post(
            org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any(),
            json.capture(),
            eq(GraphEventCreated.class));
    assertThat(json.getValue()).contains("\"isAllDay\":true");
    assertThat(json.getValue()).contains("\"dateTime\":\"2026-07-11T00:00:00\""); // no minusDays
  }
}
