package com.workplace.mail.dto;

/**
 * 수동/스케줄 동기화 1회 결과 요약.
 *
 * @param fetched 공급자에서 처리한 항목 수
 * @param saved 새로 적재한 메일 수(본문 백필·새 메일 SSE 근거)
 * @param seenChanged 서버 읽음 상태를 따라 로컬 seen 을 바꾼 기존 메일 수(WP-148). 새 메일이 아니므로 saved 에 섞지 않는다.
 */
public record MailSyncResult(int fetched, int saved, int seenChanged) {

  /** 읽음 동기화를 하지 않은 경로(동시 실행 가드 반환 등)용 — seenChanged=0. */
  public MailSyncResult(int fetched, int saved) {
    this(fetched, saved, 0);
  }
}
