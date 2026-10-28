package com.workplace.global.ical;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.ical.IcsInvite.Person;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;

/** IcsParser 단위 테스트(WP-986) — Outlook·Google 초대 샘플, 줄 접기, TZID, 종일, 취소, 깨진 입력. */
class IcsParserTest {

  /** Outlook(Exchange) 초대 — Windows 시간대 이름 TZID, VTIMEZONE, 따옴표 CN, 접힌 줄. */
  static final String OUTLOOK =
      String.join(
          "\r\n",
          "BEGIN:VCALENDAR",
          "METHOD:REQUEST",
          "PRODID:Microsoft Exchange Server 2010",
          "VERSION:2.0",
          "BEGIN:VTIMEZONE",
          "TZID:Korea Standard Time",
          "BEGIN:STANDARD",
          "DTSTART:16010101T000000",
          "TZOFFSETFROM:+0900",
          "TZOFFSETTO:+0900",
          "END:STANDARD",
          "END:VTIMEZONE",
          "BEGIN:VEVENT",
          "ORGANIZER;CN=\"김, 주최\":mailto:Boss@Corp.com",
          "ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=나:mailto:me@corp.com",
          "ATTENDEE;ROLE=OPT-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=동료:mailto:peer@corp.c",
          " om",
          "DESCRIPTION;LANGUAGE=ko-KR:안건\\n1. 예산",
          "UID:040000008200E00074C5B7101A82E00800000000ABCDEF",
          "SUMMARY;LANGUAGE=ko-KR:주간 회의\\, 예산 검토",
          "DTSTART;TZID=Korea Standard Time:20261103T100000",
          "DTEND;TZID=Korea Standard Time:20261103T110000",
          "CLASS:PUBLIC",
          "SEQUENCE:2",
          "LOCATION;LANGUAGE=ko-KR:3층 회의실",
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          "TRIGGER:-PT15M",
          "DESCRIPTION:REMINDER",
          "END:VALARM",
          "END:VEVENT",
          "END:VCALENDAR",
          "");

  /** Google Calendar 초대 — IANA TZID, LF 줄 끝, 75옥텟 접힌 CN. */
  static final String GOOGLE =
      String.join(
          "\n",
          "BEGIN:VCALENDAR",
          "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
          "VERSION:2.0",
          "CALSCALE:GREGORIAN",
          "METHOD:REQUEST",
          "BEGIN:VEVENT",
          "DTSTART;TZID=America/New_York:20261105T090000",
          "DTEND;TZID=America/New_York:20261105T093000",
          "DTSTAMP:20261028T010203Z",
          "ORGANIZER;CN=organizer@gmail.com:mailto:organizer@gmail.com",
          "UID:abc123@google.com",
          "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE",
          " ;CN=organizer@gmail.com;X-NUM-GUESTS=0:mailto:organizer@gmail.com",
          "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=",
          " TRUE;CN=box@test.local;X-NUM-GUESTS=0:mailto:box@test.local",
          "SEQUENCE:0",
          "STATUS:CONFIRMED",
          "SUMMARY:Sync",
          "END:VEVENT",
          "END:VCALENDAR");

  @Test
  void parsesOutlookInvite_windowsTzid_foldedLines_escapes() {
    IcsInvite inv = IcsParser.parse(OUTLOOK).orElseThrow();
    assertThat(inv.method()).isEqualTo("REQUEST");
    assertThat(inv.uid()).isEqualTo("040000008200E00074C5B7101A82E00800000000ABCDEF");
    assertThat(inv.sequence()).isEqualTo(2);
    assertThat(inv.summary()).isEqualTo("주간 회의, 예산 검토");
    assertThat(inv.location()).isEqualTo("3층 회의실");
    assertThat(inv.allDay()).isFalse();
    assertThat(inv.start().toInstant())
        .isEqualTo(OffsetDateTime.parse("2026-11-03T10:00:00+09:00").toInstant());
    assertThat(inv.end().toInstant())
        .isEqualTo(OffsetDateTime.parse("2026-11-03T11:00:00+09:00").toInstant());
    assertThat(inv.organizer()).isEqualTo(new Person("boss@corp.com", "김, 주최", null));
    // 접힌 줄은 잇고, VALARM 의 DESCRIPTION 은 일정 값으로 섞이지 않는다
    assertThat(inv.attendees())
        .extracting(Person::email)
        .containsExactly("me@corp.com", "peer@corp.com");
    assertThat(inv.attendees().get(0).partStat()).isEqualTo("NEEDS-ACTION");
    assertThat(inv.isCancel()).isFalse();
  }

  @Test
  void parsesGoogleInvite_ianaTzid_lfLineEndings() {
    IcsInvite inv = IcsParser.parse(GOOGLE).orElseThrow();
    assertThat(inv.uid()).isEqualTo("abc123@google.com");
    assertThat(inv.sequence()).isZero();
    assertThat(inv.start().toInstant())
        .isEqualTo(OffsetDateTime.parse("2026-11-05T09:00:00-05:00").toInstant());
    assertThat(inv.attendees())
        .extracting(Person::email)
        .containsExactly("organizer@gmail.com", "box@test.local");
    assertThat(inv.attendees().get(1).name()).isEqualTo("box@test.local");
  }

  /** 종일(VALUE=DATE) — UTC 자정, 끝은 배타 날짜. */
  @Test
  void allDay_isUtcMidnight() {
    String ics =
        "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:d1\r\n"
            + "DTSTART;VALUE=DATE:20261110\r\nDTEND;VALUE=DATE:20261111\r\nSUMMARY:워크숍\r\n"
            + "END:VEVENT\r\nEND:VCALENDAR\r\n";
    IcsInvite inv = IcsParser.parse(ics).orElseThrow();
    assertThat(inv.allDay()).isTrue();
    assertThat(inv.start()).isEqualTo(OffsetDateTime.parse("2026-11-10T00:00:00Z"));
    assertThat(inv.end()).isEqualTo(OffsetDateTime.parse("2026-11-11T00:00:00Z"));
  }

  /** UTC(Z) 시각과 DURATION, 알 수 없는 TZID 는 VTIMEZONE 오프셋으로. */
  @Test
  void utcAndDuration_andUnknownTzidFallsBackToVtimezoneOffset() {
    String utc =
        "BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:u1\nDTSTART:20261103T010000Z\n"
            + "DURATION:PT1H30M\nEND:VEVENT\nEND:VCALENDAR";
    IcsInvite a = IcsParser.parse(utc).orElseThrow();
    assertThat(a.start()).isEqualTo(OffsetDateTime.parse("2026-11-03T01:00:00Z"));
    assertThat(a.end()).isEqualTo(OffsetDateTime.parse("2026-11-03T02:30:00Z"));

    String custom =
        "BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VTIMEZONE\nTZID:Custom Zone\nBEGIN:STANDARD\n"
            + "TZOFFSETTO:+0530\nEND:STANDARD\nEND:VTIMEZONE\nBEGIN:VEVENT\nUID:u2\n"
            + "DTSTART;TZID=\"Custom Zone\":20261103T100000\nEND:VEVENT\nEND:VCALENDAR";
    IcsInvite b = IcsParser.parse(custom).orElseThrow();
    assertThat(b.start().toInstant())
        .isEqualTo(OffsetDateTime.parse("2026-11-03T10:00:00+05:30").toInstant());
    assertThat(b.end()).isNull();
  }

  /** METHOD:CANCEL — 취소. */
  @Test
  void cancel() {
    String ics =
        OUTLOOK.replace("METHOD:REQUEST", "METHOD:CANCEL").replace("SEQUENCE:2", "SEQUENCE:3");
    IcsInvite inv = IcsParser.parse(ics).orElseThrow();
    assertThat(inv.method()).isEqualTo("CANCEL");
    assertThat(inv.sequence()).isEqualTo(3);
    assertThat(inv.isCancel()).isTrue();
  }

  /** 반복 예외 VEVENT(RECURRENCE-ID)가 먼저 와도 마스터를 대표로 고른다. */
  @Test
  void prefersMasterOverRecurrenceException() {
    String ics =
        "BEGIN:VCALENDAR\nMETHOD:REQUEST\n"
            + "BEGIN:VEVENT\nUID:r1\nRECURRENCE-ID:20261110T010000Z\nDTSTART:20261110T020000Z\n"
            + "SUMMARY:예외\nEND:VEVENT\n"
            + "BEGIN:VEVENT\nUID:r1\nDTSTART:20261103T010000Z\nRRULE:FREQ=WEEKLY\nSUMMARY:마스터\n"
            + "END:VEVENT\nEND:VCALENDAR";
    assertThat(IcsParser.parse(ics).orElseThrow().summary()).isEqualTo("마스터");
  }

  /** UID·DTSTART 가 없거나 깨진 입력은 초대가 아니다. */
  @Test
  void invalidInput_isEmpty() {
    assertThat(IcsParser.parse(null)).isEmpty();
    assertThat(IcsParser.parse("hello")).isEmpty();
    assertThat(IcsParser.parse("BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:x\nEND:VEVENT")).isEmpty();
    assertThat(
            IcsParser.parse(
                "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART:garbage\nEND:VEVENT\nEND:VCALENDAR"))
        .isEmpty();
  }

  /** 제어 문자(NUL 포함)는 모든 글자 값에서 지운다 — PostgreSQL 이 NUL 을 받지 못해 저장이 깨지지 않게. */
  @Test
  void stripsControlCharacters() {
    String ics =
        "BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:u\u00001\nDTSTART:20261103T010000Z\n"
            + "SUMMARY:분기\u0000 계획\u0007\nLOCATION:3\u001b층\n"
            + "ORGANIZER;CN=주\u0000최:mailto:bo\u0000ss@x.com\n"
            + "ATTENDEE:mailto:m\u0000e@x.com\nEND:VEVENT\nEND:VCALENDAR";
    IcsInvite inv = IcsParser.parse(ics).orElseThrow();
    assertThat(inv.uid()).isEqualTo("u1");
    assertThat(inv.summary()).isEqualTo("분기 계획");
    assertThat(inv.location()).isEqualTo("3층");
    assertThat(inv.organizer()).isEqualTo(new Person("boss@x.com", "주최", null));
    assertThat(inv.attendees()).extracting(Person::email).containsExactly("me@x.com");
  }

  /** 아주 큰 DURATION·범위 밖 DTEND 는 끝을 버린다(끝 없음). */
  @Test
  void hugeDurationOrOutOfRangeEnd_dropsEnd() {
    String base =
        "BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:d\nDTSTART:20261103T010000Z\n";
    for (String tail :
        new String[] {
          "DURATION:P99999999W",
          "DURATION:P3000000D",
          "DURATION:PT99999999999999999999H",
          "DTEND:99991231T235959Z\nDURATION:PT1H",
          "DTEND:00010101T000000Z"
        }) {
      IcsInvite inv = IcsParser.parse(base + tail + "\nEND:VEVENT\nEND:VCALENDAR").orElseThrow();
      if (tail.startsWith("DTEND:9999")) {
        assertThat(inv.end()).as(tail).isNotNull(); // 9999년은 범위 안
      } else {
        assertThat(inv.end()).as(tail).isNull();
      }
    }
  }

  /** 시작이 1900~9999년 밖이면 초대가 아니다. */
  @Test
  void outOfRangeStart_isEmpty() {
    assertThat(
            IcsParser.parse(
                "BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:x\nDTSTART:00010101T000000Z\n"
                    + "END:VEVENT\nEND:VCALENDAR"))
        .isEmpty();
    assertThat(
            IcsParser.parse(
                "BEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:x\nDTSTART;VALUE=DATE:18991231\n"
                    + "END:VEVENT\nEND:VCALENDAR"))
        .isEmpty();
  }
}
