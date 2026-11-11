package com.workplace.agentaccount.usage;

/**
 * 사용량 조회 실패. code 는 TOKEN_EXPIRED·UNAUTHORIZED·HTTP_&lt;code&gt;·NETWORK·BAD_RESPONSE·BAD_SECRET 중
 * 하나이고, userMessage 는 짧은 한국어 문구다. 토큰·auth.json 원문은 메시지·원인 어디에도 싣지 않는다.
 */
public class UsageProbeException extends Exception {

  private final String code;
  private final String userMessage;

  public UsageProbeException(String code, String userMessage) {
    // 예외 메시지에도 코드와 안전한 문구만 — 원인 예외는 일부러 연결하지 않는다(URL·헤더 노출 방지).
    super(code + ": " + userMessage);
    this.code = code;
    this.userMessage = userMessage;
  }

  /** 실패 코드. */
  public String code() {
    return code;
  }

  /** 사용자에게 보일 짧은 한국어 사유. */
  public String userMessage() {
    return userMessage;
  }

  /**
   * 예외와 원인 체인의 클래스 이름만 「A <- B <- C」 꼴로 잇는다(WP-1487 실패 로그용). 메시지는 URL·응답 조각을 담을 수 있어 읽지 않는다. 순환 원인에
   * 갇히지 않게 깊이를 제한한다.
   */
  static String causeChain(Throwable e) {
    StringBuilder sb = new StringBuilder();
    Throwable t = e;
    for (int depth = 0; t != null && depth < 8; depth++) {
      if (depth > 0) sb.append(" <- ");
      sb.append(t.getClass().getName());
      if (t.getCause() == t) break;
      t = t.getCause();
    }
    return sb.toString();
  }
}
