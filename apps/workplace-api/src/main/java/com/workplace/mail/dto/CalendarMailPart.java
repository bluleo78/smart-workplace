package com.workplace.mail.dto;

import java.util.List;

/**
 * WP-986: 메일에 실린 iCalendar 원문과 그 메일을 보낸 주소들. 초대 기록이 「주최자가 보낸 메일인가」를 판정하는 재료다 — iCalendar 의
 * ORGANIZER 는 아무나 적을 수 있어서, 메일 From·Sender 주소와 맞춰 봐야 위조 초대·취소를 거른다. IMAP·Graph 본문 적재가 같은 모양으로 넘긴다.
 *
 * @param ics iCalendar 원문(없으면 null)
 * @param senderEmails 메일 From·Sender 헤더의 주소(소문자, 중복 없음). 없으면 빈 목록
 */
public record CalendarMailPart(String ics, List<String> senderEmails) {

  public CalendarMailPart {
    senderEmails = senderEmails == null ? List.of() : List.copyOf(senderEmails);
  }
}
