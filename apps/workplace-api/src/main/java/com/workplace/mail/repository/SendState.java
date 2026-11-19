package com.workplace.mail.repository;

/**
 * 임시보관 행의 발송 상태(mail_draft.send_state, WP-1786) 이름 — 저장소·서비스가 같은 말을 쓰도록 한곳에 둔다.
 *
 * <p>일반 임시보관은 NULL(저장소의 상태 조회는 빈 문자열로 돌려준다). 보내기를 누르면 QUEUED(되돌릴 수 있음), 스케줄러가 집으면 SENDING, 보내지 못하면
 * FAILED. 보내는 중(QUEUED·SENDING)인 행은 고치거나 지울 수 없다.
 */
public final class SendState {

  /** 보내기 대기 — send_at 이 되면 스케줄러가 집는다. 그 전까지 되돌릴 수 있다. */
  public static final String QUEUED = "QUEUED";

  /** 스케줄러가 집어 보내는 중. */
  public static final String SENDING = "SENDING";

  /** 보내지 못함 — send_error 에 사유. 저장하면 일반 임시보관으로 돌아간다. */
  public static final String FAILED = "FAILED";

  /** 발송 중 멈춰 결과를 모를 때 FAILED 행에 남기는 사유(send_error). */
  public static final String UNKNOWN_ERROR = "UNKNOWN";

  private SendState() {}

  /**
   * 보내는 중(QUEUED·SENDING)인가 — 이 상태의 행은 고치기·지우기를 거절한다(409 DRAFT_SENDING). null·빈 문자열(일반)·FAILED 는
   * 아니다.
   */
  public static boolean isInFlight(String state) {
    return QUEUED.equals(state) || SENDING.equals(state);
  }
}
