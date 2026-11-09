package com.workplace.agentaccount.refresh;

/**
 * ChatGPT 토큰 갱신 실패. permanent 면 같은 갱신 토큰으로는 다시 해도 소용없다(401·invalid_grant·토큰 만료/재사용/폐기) — 사람이 다시
 * 로그인해야 한다. 아니면 일시 실패(네트워크·5xx 등)라 다음 주기에 다시 시도한다. 메시지에는 코드만 싣는다 — 응답 본문·토큰은 넣지 않는다.
 */
public class ChatgptTokenRefreshException extends Exception {

  private final boolean permanent;
  private final String code;

  public ChatgptTokenRefreshException(boolean permanent, String code) {
    super(code);
    this.permanent = permanent;
    this.code = code;
  }

  /** 영구 실패인가. */
  public boolean permanent() {
    return permanent;
  }

  /** 실패 코드(짧은 영문 식별자 — 기록·로그용). */
  public String code() {
    return code;
  }
}
