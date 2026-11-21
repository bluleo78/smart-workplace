package com.workplace.calendar.service;

import com.workplace.calendar.exception.ExternalCalendarWriteException;
import com.workplace.global.util.Texts;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.exception.MailCredentialUnreadableException;
import com.workplace.mail.outbound.GraphCalendarClient;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEventWrite;
import com.workplace.mail.service.GraphTokenService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * M365_GRAPH 일정 역동기화 전송기. 토큰을 해석(별도 @Transactional 빈)해 GraphCalendarClient 쓰기 메서드에 위임한다.
 *
 * <p>토큰 해석·HTTP 는 호출자(CalendarEventService 오케스트레이터)의 트랜잭션 밖에서 실행된다(#232 커넥션 점유 회피). Graph
 * 실패(MailSendException 등)는 502 의미의 ExternalCalendarWriteException 으로 변환해 캐치올 500 회피. 토큰 복호화 실패
 * (MailCredentialUnreadableException, WP-1907)는 「계정 다시 연결」 안내 502 라 감싸지 않고 그대로 내보낸다.
 */
@Component
@RequiredArgsConstructor
public class GraphCalendarTransport implements CalendarTransport {

  private final GraphTokenService tokenService;
  private final GraphCalendarClient graphClient;

  /**
   * Graph 호출 실패를 일정 쓰기 실패(502)로 바꾼다. 토큰 복호화 실패(MailCredentialUnreadableException)는 「계정을 다시 연결」 안내를
   * 가진 502 이므로 감싸지 않고 그대로 돌려준다(WP-1907) — 감싸면 안내 문구가 가려진다.
   */
  private static RuntimeException wrap(RuntimeException e, String message) {
    return e instanceof MailCredentialUnreadableException
        ? e
        : new ExternalCalendarWriteException(message, e);
  }

  @Override
  public MailProvider provider() {
    return MailProvider.M365_GRAPH;
  }

  @Override
  public String createEvent(
      long userId, EmailAccountResponse account, String externalCalendarId, GraphEventWrite body) {
    try {
      String token = tokenService.getAccessToken(userId, account.id());
      return graphClient.createEvent(token, externalCalendarId, body);
    } catch (RuntimeException e) {
      throw wrap(e, "Graph 일정 생성 실패");
    }
  }

  @Override
  public void updateEvent(
      long userId, EmailAccountResponse account, String externalEventId, GraphEventWrite body) {
    try {
      String token = tokenService.getAccessToken(userId, account.id());
      graphClient.updateEvent(token, externalEventId, body);
    } catch (RuntimeException e) {
      throw wrap(e, "Graph 일정 수정 실패");
    }
  }

  @Override
  public void deleteEvent(long userId, EmailAccountResponse account, String externalEventId) {
    try {
      String token = tokenService.getAccessToken(userId, account.id());
      graphClient.deleteEvent(token, externalEventId);
    } catch (RuntimeException e) {
      throw wrap(e, "Graph 일정 삭제 실패");
    }
  }

  @Override
  public void updateAttendees(
      long userId,
      EmailAccountResponse account,
      String externalEventId,
      java.util.List<com.workplace.mail.outbound.GraphCalendarClient.GraphAttendeeWrite>
          attendees) {
    try {
      String token = tokenService.getAccessToken(userId, account.id());
      graphClient.patchAttendees(token, externalEventId, attendees);
    } catch (RuntimeException e) {
      throw wrap(e, "Graph 참석자 갱신 실패");
    }
  }

  @Override
  public LiveCategories readCategories(
      long userId, EmailAccountResponse account, String externalEventId) {
    try {
      String token = tokenService.getAccessToken(userId, account.id());
      var state = graphClient.getEventCategoryState(token, externalEventId);
      return new LiveCategories(
          state.type(),
          Texts.blankToNull(state.seriesMasterId()),
          state.categories() == null ? java.util.List.of() : state.categories());
    } catch (RuntimeException e) {
      throw wrap(e, "Graph 범주 읽기 실패");
    }
  }

  @Override
  public void updateCategories(
      long userId,
      EmailAccountResponse account,
      String externalEventId,
      java.util.List<String> categories) {
    try {
      String token = tokenService.getAccessToken(userId, account.id());
      graphClient.patchCategories(token, externalEventId, categories);
    } catch (RuntimeException e) {
      throw wrap(e, "Graph 범주 갱신 실패");
    }
  }
}
