package com.workplace.calendar.service;

import com.workplace.mail.dto.MailProvider;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 공급자 → 일정 역동기화 전송기 해소(WP-716 리뷰) — 일정 쓰기(CalendarEventService)와 태그 → Outlook 범주 써
 * 넣기(CalendarTagService)가 같은 규칙으로 고르게 한 곳에 둔다.
 */
@Component
@RequiredArgsConstructor
public class CalendarTransports {
  // 등록된 모든 전송기 — 공급자별 분기는 호출 시점에 해소한다(구성 시 캐싱 금지).
  private final List<CalendarTransport> transports;

  /** 공급자의 전송기. 없으면 IllegalStateException(라우팅 누락 가드). */
  public CalendarTransport forProvider(MailProvider provider) {
    return transports.stream()
        .filter(t -> t.provider() == provider)
        .findFirst()
        .orElseThrow(() -> new IllegalStateException("일정 역동기화 전송기 없음: " + provider));
  }
}
