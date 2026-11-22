package com.workplace.global.util;

/**
 * 예외 원인 사슬을 로그에 안전하게 남기는 도우미.
 *
 * <p>예외 메시지에는 URL·응답 조각·디코딩에 실패한 매개변수 값(비밀번호·토큰 조각일 수 있음) 같은 민감한 글이 들 수 있어, 로그에는 클래스 이름 사슬만
 * 남긴다(WP-1487 사용량 조회 실패 로그에서 시작, WP-1949 매개변수 거절 로그가 함께 쓴다).
 */
public final class ExceptionCauses {

  /** 순환 원인·지나치게 긴 사슬에 갇히지 않게 보는 최대 깊이. */
  private static final int MAX_DEPTH = 8;

  private ExceptionCauses() {}

  /** 예외와 원인 사슬의 클래스 이름만 「A <- B <- C」 꼴로 잇는다. 메시지는 읽지 않는다. */
  public static String classChain(Throwable e) {
    StringBuilder sb = new StringBuilder();
    Throwable t = e;
    for (int depth = 0; t != null && depth < MAX_DEPTH; depth++) {
      if (depth > 0) sb.append(" <- ");
      sb.append(t.getClass().getName());
      if (t.getCause() == t) break;
      t = t.getCause();
    }
    return sb.toString();
  }
}
