package com.workplace.wiki.report;

import com.workplace.wiki.report.dto.PersonalReportConflictResponse;

/**
 * 「보고서 만들기」를 지금 받을 수 없다(WP-1486, 409) — 비서 없음·같은 회차 보고가 이미 있음·만드는 중. 공용 오류 본문에는 pageId·title·id 를
 * 실을 칸이 없어 {@link PersonalReportController} 가 이 예외의 본문을 그대로 409 로 답한다.
 */
public class PersonalReportConflictException extends RuntimeException {

  /** 비서가 없을 때(설정 창·만들기 창 경고와 같은 문구). */
  static final String NO_ASSISTANT = "AI 비서가 없어 보고를 만들 수 없어요";

  private final transient PersonalReportConflictResponse body;

  private PersonalReportConflictException(PersonalReportConflictResponse body) {
    super(body.message());
    this.body = body;
  }

  /** 409 본문. */
  public PersonalReportConflictResponse body() {
    return body;
  }

  /** 보고를 쓸 AI 비서가 없다. */
  static PersonalReportConflictException noAssistant() {
    return new PersonalReportConflictException(
        new PersonalReportConflictResponse("NO_ASSISTANT", NO_ASSISTANT, null, null, null));
  }

  /** 같은 회차에 이미 만든 노트가 있다 — 「이미 있음 — {제목}」. */
  static PersonalReportConflictException exists(long pageId, String title) {
    return new PersonalReportConflictException(
        new PersonalReportConflictResponse("REPORT_EXISTS", "이미 만든 보고가 있어요", null, pageId, title));
  }

  /**
   * 같은 회차를 만드는 중이다 — 그 회차 id 를 알려 화면이 이어서 기다리게 한다. id 가 null 이면(예약 경쟁으로 진행 중 행을 못 찾음) 화면은 문구만 보인다.
   */
  static PersonalReportConflictException inProgress(Long id) {
    return new PersonalReportConflictException(
        new PersonalReportConflictResponse("REPORT_IN_PROGRESS", "보고를 만드는 중이에요", id, null, null));
  }
}
