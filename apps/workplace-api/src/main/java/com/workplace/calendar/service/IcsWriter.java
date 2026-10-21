package com.workplace.calendar.service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/**
 * 작은 RFC 5545(iCalendar) 문장 생성기(WP-715) — 태그 구독 주소가 내보내는 VCALENDAR 한 덩어리를 만든다.
 *
 * <p>무거운 라이브러리를 들이지 않으려고 필요한 만큼만 직접 쓴다: 줄 끝은 CRLF, 한 줄은 75옥텟에서 접고(이어지는 줄은 공백 하나로 시작, UTF-8 한 글자를
 * 쪼개지 않음), TEXT 값은 {@code \ ; , 줄바꿈} 을 이스케이프하고, 매개변수 값(CN)은 큰따옴표로 감싸 따옴표·제어 문자를 뺀다. 시각은 모두 UTC
 * ({@code yyyyMMdd'T'HHmmss'Z'}), 종일은 {@code VALUE=DATE}.
 */
public final class IcsWriter {
  /** UTC 날짜·시각 형식(RFC 5545 FORM #2). */
  public static final DateTimeFormatter UTC_FMT =
      DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);

  private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyyMMdd");

  /** 한 줄 최대 옥텟(줄 끝 CRLF 제외) — RFC 5545 3.1. */
  private static final int MAX_OCTETS = 75;

  private final StringBuilder out = new StringBuilder();

  /** 이름:값 한 줄을 그대로(값 이스케이프 없이) 쓴다 — 값이 이미 형식에 맞을 때(날짜·mailto·고정 문자열). */
  public IcsWriter raw(String nameAndParams, String value) {
    return line(nameAndParams + ":" + value);
  }

  /** TEXT 값 한 줄 — 이스케이프한다. 값이 비면 쓰지 않는다. */
  public IcsWriter text(String name, String value) {
    if (value == null || value.isBlank()) return this;
    return line(name + ":" + escapeText(value));
  }

  /** UTC 시각 한 줄(DTSTART·DTEND·DTSTAMP). */
  public IcsWriter utc(String name, Instant t) {
    return line(name + ":" + UTC_FMT.format(t));
  }

  /** 날짜 한 줄(종일 DTSTART·DTEND). */
  public IcsWriter date(String name, LocalDate d) {
    return line(name + ";VALUE=DATE:" + DATE_FMT.format(d));
  }

  /**
   * 사람 한 줄(ORGANIZER·ATTENDEE) — {@code NAME;CN="이름";PARTSTAT=…:mailto:주소}. 주소가 없으면 쓰지 않는다(이메일로만
   * 사람을 가린다).
   *
   * @param partStat ATTENDEE 응답 상태(ACCEPTED 등). ORGANIZER 이거나 모르면 null
   */
  public IcsWriter person(String name, String displayName, String email, String partStat) {
    if (email == null || email.isBlank()) return this;
    StringBuilder sb = new StringBuilder(name);
    if (displayName != null && !displayName.isBlank()) {
      sb.append(";CN=\"").append(paramValue(displayName)).append('"');
    }
    if (partStat != null) sb.append(";PARTSTAT=").append(partStat);
    sb.append(":mailto:").append(email.strip());
    return line(sb.toString());
  }

  /** 완성된 본문. */
  public String build() {
    return out.toString();
  }

  /** 한 논리 줄을 75옥텟에서 접어 CRLF 로 끝낸다. */
  private IcsWriter line(String content) {
    out.append(fold(content)).append("\r\n");
    return this;
  }

  /**
   * 75옥텟 접기(RFC 5545 3.1) — UTF-8 바이트로 세되 한 글자(서로게이트 쌍 포함)를 쪼개지 않는다. 이어지는 줄은 공백 하나로 시작하고 그 공백도
   * 75옥텟에 든다.
   */
  static String fold(String content) {
    StringBuilder sb = new StringBuilder();
    int lineOctets = 0;
    int i = 0;
    while (i < content.length()) {
      int cp = content.codePointAt(i);
      int len = Character.charCount(cp);
      int octets = utf8Length(cp);
      if (lineOctets + octets > MAX_OCTETS) {
        sb.append("\r\n ");
        lineOctets = 1;
      }
      sb.appendCodePoint(cp);
      lineOctets += octets;
      i += len;
    }
    return sb.toString();
  }

  /**
   * 코드 포인트 하나의 UTF-8 바이트 수 — 글자마다 String·byte[] 를 만들지 않으려고 범위로 센다. 짝 없는 서로게이트는 실제 인코딩('?' 1바이트)보다
   * 크게(3) 세지만, 그러면 조금 일찍 접힐 뿐 75옥텟을 넘지는 않는다.
   */
  static int utf8Length(int cp) {
    if (cp < 0x80) return 1;
    if (cp < 0x800) return 2;
    if (cp < 0x10000) return 3;
    return 4;
  }

  /** TEXT 이스케이프(RFC 5545 3.3.11) — 역슬래시·세미콜론·쉼표·줄바꿈. CR 은 버린다. */
  static String escapeText(String v) {
    StringBuilder sb = new StringBuilder(v.length());
    for (int i = 0; i < v.length(); i++) {
      char c = v.charAt(i);
      switch (c) {
        case '\\' -> sb.append("\\\\");
        case ';' -> sb.append("\\;");
        case ',' -> sb.append("\\,");
        case '\n' -> sb.append("\\n");
        case '\r' -> {
          // CRLF 는 \n 하나로, 홀로 있는 CR 도 줄바꿈으로 본다
          if (i + 1 >= v.length() || v.charAt(i + 1) != '\n') sb.append("\\n");
        }
        default -> {
          if (c >= 0x20 || c == '\t') sb.append(c);
        }
      }
    }
    return sb.toString();
  }

  /** 매개변수 값(따옴표 안) — 큰따옴표와 제어 문자는 쓸 수 없어 뺀다(RFC 5545 3.1 QSAFE-CHAR). */
  static String paramValue(String v) {
    StringBuilder sb = new StringBuilder(v.length());
    for (int i = 0; i < v.length(); i++) {
      char c = v.charAt(i);
      if (c == '"' || (c < 0x20 && c != '\t') || c == 0x7f) continue;
      sb.append(c);
    }
    return sb.toString().strip();
  }
}
