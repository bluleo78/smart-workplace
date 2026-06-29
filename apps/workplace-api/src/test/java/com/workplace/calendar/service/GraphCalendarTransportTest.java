package com.workplace.calendar.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.calendar.exception.ExternalCalendarWriteException;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.outbound.GraphCalendarClient;
import com.workplace.mail.outbound.GraphCalendarClient.GraphDateTime;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEventWrite;
import com.workplace.mail.service.GraphTokenService;
import org.junit.jupiter.api.Test;

/** GraphCalendarTransport 단위 테스트 — 토큰 해석·client 위임·실패 502 변환을 검증. */
class GraphCalendarTransportTest {

  private final GraphTokenService tokens = mock(GraphTokenService.class);
  private final GraphCalendarClient client = mock(GraphCalendarClient.class);
  private final GraphCalendarTransport transport = new GraphCalendarTransport(tokens, client);

  private EmailAccountResponse account() {
    return new EmailAccountResponse(
        7L,
        "u@iacloud.kr",
        "U",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        false,
        null,
        MailProvider.M365_GRAPH);
  }

  private GraphEventWrite body() {
    return new GraphEventWrite(
        "t",
        null,
        new GraphDateTime("2026-07-10T09:00:00", "UTC"),
        new GraphDateTime("2026-07-10T10:00:00", "UTC"),
        false,
        null);
  }

  @Test
  void provider_is_graph() {
    assertThat(transport.provider()).isEqualTo(MailProvider.M365_GRAPH);
  }

  @Test
  void createEvent_resolves_token_and_delegates() {
    when(tokens.getAccessToken(1L, 7L)).thenReturn("tok");
    when(client.createEvent(eq("tok"), eq("gcal"), any())).thenReturn("EXT1");
    String id = transport.createEvent(1L, account(), "gcal", body());
    assertThat(id).isEqualTo("EXT1");
    verify(client).createEvent(eq("tok"), eq("gcal"), any());
  }

  @Test
  void createEvent_wraps_graph_failure_as_502() {
    when(tokens.getAccessToken(1L, 7L)).thenReturn("tok");
    doThrow(new MailSendException("Graph post 실패: 503"))
        .when(client)
        .createEvent(any(), any(), any());
    assertThatThrownBy(() -> transport.createEvent(1L, account(), "gcal", body()))
        .isInstanceOf(ExternalCalendarWriteException.class);
  }

  /** updateEvent 가 토큰을 해석하고 GraphCalendarClient.updateEvent 에 정확히 위임하는지 검증. */
  @Test
  void updateEvent_resolves_token_and_delegates() {
    when(tokens.getAccessToken(1L, 7L)).thenReturn("tok");
    transport.updateEvent(1L, account(), "EXT1", body());
    verify(client).updateEvent(eq("tok"), eq("EXT1"), eq(body()));
  }

  /** deleteEvent 가 토큰을 해석하고 GraphCalendarClient.deleteEvent 에 정확히 위임하는지 검증. */
  @Test
  void deleteEvent_resolves_token_and_delegates() {
    when(tokens.getAccessToken(1L, 7L)).thenReturn("tok");
    transport.deleteEvent(1L, account(), "EXT1");
    verify(client).deleteEvent(eq("tok"), eq("EXT1"));
  }

  /**
   * GraphCalendarClient.deleteEvent 가 정상 반환(404 삼킴 포함)하면 transport 레벨에서 예외가 발생하지 않아야 한다. Task 1 에서
   * GraphApiClient.delete 가 404 를 삼키므로 transport 는 성공 경로를 그대로 노출한다.
   */
  @Test
  void deleteEvent_on_404_does_not_throw() {
    when(tokens.getAccessToken(1L, 7L)).thenReturn("tok");
    // client.deleteEvent 는 정상 반환(404 는 이미 GraphApiClient 레벨에서 삼킴)
    org.assertj.core.api.Assertions.assertThatNoException()
        .isThrownBy(() -> transport.deleteEvent(1L, account(), "EXT_GONE"));
  }
}
