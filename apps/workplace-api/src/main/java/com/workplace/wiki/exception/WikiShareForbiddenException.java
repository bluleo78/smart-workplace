package com.workplace.wiki.exception;

/**
 * 지정한 사람(PEOPLE) 공유 링크를 지정되지 않은 로그인 사용자가 열 때(403, WP-579). 없는 링크·범위 밖 페이지(404)와 달리 링크 자체는 유효하므로 받는
 * 화면이 「접근 요청」을 띄울 수 있다(403 자체가 요청 가능). 응답 body 에 이미 대기 중인 요청이 있는지({@code requested})와 같은 공유에 최근
 * 거절됐는지({@code denied})를 싣는다.
 */
public class WikiShareForbiddenException extends RuntimeException {
  private final boolean requested;
  private final boolean denied;

  /**
   * @param requested 이 사용자가 이 공유 페이지에 대기 중인 접근 요청을 이미 보냈는지
   * @param denied 이 사용자의 요청이 같은 공유에 24시간 안에 거절됐는지 — 받는 화면이 「거절됨」을 보이고 다시 요청하지 않게
   */
  public WikiShareForbiddenException(boolean requested, boolean denied) {
    super("이 링크를 열 수 있는 사람으로 지정되지 않았습니다");
    this.requested = requested;
    this.denied = denied;
  }

  public boolean requested() {
    return requested;
  }

  public boolean denied() {
    return denied;
  }
}
