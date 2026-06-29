package com.workplace.calendar.service;

import com.workplace.calendar.exception.ExternalCalendarWriteException;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.outbound.GraphCalendarClient;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEventWrite;
import com.workplace.mail.service.GraphTokenService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * M365_GRAPH 일정 역동기화 전송기. 토큰을 해석(별도 @Transactional 빈)해 GraphCalendarClient 쓰기 메서드에 위임한다.
 *
 * <p>토큰 해석·HTTP 는 호출자(CalendarEventService 오케스트레이터)의 트랜잭션 밖에서 실행된다(#232 커넥션 점유 회피). Graph
 * 실패(MailSendException 등)는 502 의미의 ExternalCalendarWriteException 으로 변환해 캐치올 500 회피.
 */
@Component
@RequiredArgsConstructor
public class GraphCalendarTransport implements CalendarTransport {

  private final GraphTokenService tokenService;
  private final GraphCalendarClient graphClient;

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
      throw new ExternalCalendarWriteException("Graph 일정 생성 실패", e);
    }
  }

  @Override
  public void updateEvent(
      long userId, EmailAccountResponse account, String externalEventId, GraphEventWrite body) {
    try {
      String token = tokenService.getAccessToken(userId, account.id());
      graphClient.updateEvent(token, externalEventId, body);
    } catch (RuntimeException e) {
      throw new ExternalCalendarWriteException("Graph 일정 수정 실패", e);
    }
  }

  @Override
  public void deleteEvent(long userId, EmailAccountResponse account, String externalEventId) {
    try {
      String token = tokenService.getAccessToken(userId, account.id());
      graphClient.deleteEvent(token, externalEventId);
    } catch (RuntimeException e) {
      throw new ExternalCalendarWriteException("Graph 일정 삭제 실패", e);
    }
  }
}
