package com.workplace.mail.dto;

/**
 * 수동/스케줄 동기화 1회 결과 요약.
 *
 * @param fetched 공급자에서 처리한 항목 수
 * @param saved 새로 적재한 메일 수(본문 백필·새 메일 SSE 근거)
 * @param seenChanged 서버 읽음 상태를 따라 로컬 seen 을 바꾼 기존 메일 수(WP-148). 새 메일이 아니므로 saved 에 섞지 않는다.
 * @param removed 서버에서 다른 폴더로 옮겨졌거나 지워져 로컬에서도 지운 메일 수(WP-959). 목록·안 읽은 수가 바뀌므로 변경 알림 근거다.
 */
public record MailSyncResult(int fetched, int saved, int seenChanged, int removed) {

  /** 삭제 반영이 없는 결과(받은 메일·읽음 변화만). */
  public MailSyncResult(int fetched, int saved, int seenChanged) {
    this(fetched, saved, seenChanged, 0);
  }

  /** 목록·카운트를 바꾼 변화가 있었는지 — 소유자에게 변경 알림을 보낼지 판단한다. */
  public boolean changed() {
    return saved > 0 || seenChanged > 0 || removed > 0;
  }
}
