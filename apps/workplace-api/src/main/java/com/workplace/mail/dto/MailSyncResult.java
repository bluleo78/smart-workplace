package com.workplace.mail.dto;

/**
 * 수동/스케줄 동기화 1회 결과 요약.
 *
 * @param fetched 공급자에서 처리한 항목 수
 * @param saved 새로 적재한 메일 수(본문 백필·새 메일 SSE 근거)
 * @param seenChanged 서버 읽음 상태를 따라 로컬 seen 을 바꾼 기존 메일 수(WP-148). 새 메일이 아니므로 saved 에 섞지 않는다.
 * @param removed 서버에서 다른 폴더로 옮겨졌거나 지워져 로컬에서도 지운 메일 수(WP-959). 목록·안 읽은 수가 바뀌므로 변경 알림 근거다.
 * @param sentSaved 서버 보낸편지함에서 새로 적재한 메일 수(WP-950). 「새 메일 N건」 안내는 받은편지함 기준이라 saved 에 섞지 않고, 목록 갱신
 *     신호에만 쓴다.
 */
public record MailSyncResult(int fetched, int saved, int seenChanged, int removed, int sentSaved) {

  /** 삭제 반영·보낸편지함 동기화가 없는 결과(받은 메일·읽음 변화만). */
  public MailSyncResult(int fetched, int saved, int seenChanged) {
    this(fetched, saved, seenChanged, 0, 0);
  }

  /** 보낸편지함을 동기화하지 않는 결과(받은편지함 삭제 반영 포함). */
  public MailSyncResult(int fetched, int saved, int seenChanged, int removed) {
    this(fetched, saved, seenChanged, removed, 0);
  }

  /** 목록·카운트를 바꾼 변화가 있었는지 — 소유자에게 변경 알림을 보낼지 판단한다. 서버 보낸편지함의 새 메일(WP-950)도 보낸편지함 목록을 바꾼다. */
  public boolean changed() {
    return saved > 0 || seenChanged > 0 || removed > 0 || sentSaved > 0;
  }

  /** 받은편지함 결과에 보낸편지함 결과를 더한 사본 — 새로 적재한 보낸 메일은 sentSaved 로, 읽음 변화·삭제 반영은 각각 더한다(보낸편지함 목록 갱신 신호). */
  public MailSyncResult withSent(MailSyncResult sent) {
    return new MailSyncResult(
        fetched, saved, seenChanged + sent.seenChanged(), removed + sent.removed(), sent.saved());
  }
}
