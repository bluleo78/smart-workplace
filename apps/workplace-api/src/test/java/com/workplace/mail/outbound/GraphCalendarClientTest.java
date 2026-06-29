package com.workplace.mail.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * {@link GraphCalendarClient} 단위 테스트.
 *
 * <p>순수 Mockito — IntegrationTestBase 불필요. {@code GraphApiClient} 를 모킹해 페이지네이션·필드 매핑을 검증한다.
 */
class GraphCalendarClientTest {

  /**
   * @odata.nextLink 페이지네이션 2페이지 집계 검증.
   */
  @Test
  void listCalendarView_follows_nextLink_and_aggregates() throws Exception {
    GraphApiClient api = mock(GraphApiClient.class);

    // 1페이지: nextLink 있음, 2페이지: 종료
    String page1 =
        "{\"value\":[{\"id\":\"e1\",\"subject\":\"A\"}],"
            + "\"@odata.nextLink\":\"https://graph.microsoft.com/v1.0/next\"}";
    String page2 = "{\"value\":[{\"id\":\"e2\",\"subject\":\"B\"}]}";

    when(api.get(
            eq("tok"), contains("/calendarView"), eq(GraphCalendarClient.GraphEventPage.class)))
        .thenReturn(mapPage(page1));
    when(api.get(
            eq("tok"),
            eq("https://graph.microsoft.com/v1.0/next"),
            eq(GraphCalendarClient.GraphEventPage.class)))
        .thenReturn(mapPage(page2));

    GraphCalendarClient client = new GraphCalendarClient(api, MAPPER);
    List<GraphCalendarClient.GraphEvent> events =
        client.listCalendarView(
            "tok",
            "cal1",
            OffsetDateTime.parse("2026-06-01T00:00:00Z"),
            OffsetDateTime.parse("2026-09-01T00:00:00Z"));

    assertThat(events).extracting(GraphCalendarClient.GraphEvent::id).containsExactly("e1", "e2");
  }

  /** listCalendars 기본 매핑 검증. */
  @Test
  void listCalendars_returns_calendars() throws Exception {
    GraphApiClient api = mock(GraphApiClient.class);

    String page =
        "{\"value\":[{\"id\":\"c1\",\"name\":\"내 캘린더\",\"color\":\"auto\","
            + "\"hexColor\":\"#0078d4\",\"isDefaultCalendar\":true}]}";

    when(api.get(
            eq("tok"), contains("/me/calendars"), eq(GraphCalendarClient.GraphCalendarPage.class)))
        .thenReturn(mapCalPage(page));

    GraphCalendarClient client = new GraphCalendarClient(api, MAPPER);
    List<GraphCalendarClient.GraphCalendar> cals = client.listCalendars("tok");

    assertThat(cals).hasSize(1);
    assertThat(cals.get(0).id()).isEqualTo("c1");
    assertThat(cals.get(0).isDefaultCalendar()).isTrue();
  }

  // ── 헬퍼 ────────────────────────────────────────────────────────────────────

  private static final ObjectMapper MAPPER = new ObjectMapper();

  private GraphCalendarClient.GraphEventPage mapPage(String json) throws Exception {
    return MAPPER.readValue(json, GraphCalendarClient.GraphEventPage.class);
  }

  private GraphCalendarClient.GraphCalendarPage mapCalPage(String json) throws Exception {
    return MAPPER.readValue(json, GraphCalendarClient.GraphCalendarPage.class);
  }
}
