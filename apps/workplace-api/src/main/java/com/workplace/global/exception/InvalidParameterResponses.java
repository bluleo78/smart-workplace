package com.workplace.global.exception;

import java.io.CharConversionException;
import java.nio.charset.CharacterCodingException;
import org.apache.tomcat.util.http.InvalidParameterException;
import org.springframework.http.HttpStatus;

/**
 * Tomcat 의 매개변수 파싱 실패(InvalidParameterException)에 내보낼 상태·한국어 문구를 한 곳에서 정한다(WP-1949).
 *
 * <p>전역 예외 핸들러와, 디스패처보다 먼저 매개변수를 읽는 필터(PublicRateLimitFilter)가 함께 쓴다. Tomcat 은 쿼리 디코딩 실패를 첫
 * getParameter 에서 한 번만 던지고 이후 읽기는 일부만 파싱된 값을 조용히 돌려주므로, 첫 읽기 주체가 누구든 같은 판정으로 바로 거절해야 하기 때문이다. 영어
 * 원문(컨테이너 내부 안내)은 어느 갈래에서도 내보내지 않는다.
 */
public final class InvalidParameterResponses {

  /** 깨진 퍼센트 인코딩 쿼리의 안내 문구 — Tomcat 영어 원문 대신 고정 한국어로 답한다. */
  public static final String INVALID_ENCODING_MESSAGE =
      "요청 주소의 매개변수 인코딩이 올바르지 않습니다. 특수문자(%)는 %25 로 인코딩해 주세요.";

  /** 매개변수 본문이 Tomcat 한도(maxPostSize·multipart 등)를 넘은 경우의 안내 문구. */
  public static final String TOO_LARGE_MESSAGE = "요청이 너무 큽니다. 보내는 내용을 줄여 다시 시도해 주세요.";

  /** 인코딩 문제가 아닌 그 밖의 매개변수 오류(개수 초과 등)의 안내 문구 — 인코딩 안내를 잘못 붙이지 않는다. */
  public static final String GENERIC_MESSAGE = "요청 매개변수를 처리할 수 없습니다. 매개변수 개수와 형식을 확인해 주세요.";

  /** 응답 상태와 문구 한 쌍. */
  public record Decision(HttpStatus status, String message) {}

  private InvalidParameterResponses() {}

  /**
   * 원인별 판정 — 오류 코드 413(본문 한도 초과) → 413 + 크기 안내, 원인 사슬에 디코딩 실패(CharConversionException·
   * CharacterCodingException) → 400 + %25 안내, 그 밖(개수 초과 등) → 400 + 일반 안내.
   */
  public static Decision decide(InvalidParameterException ex) {
    if (ex.getErrorCode() == HttpStatus.PAYLOAD_TOO_LARGE.value()) {
      return new Decision(HttpStatus.PAYLOAD_TOO_LARGE, TOO_LARGE_MESSAGE);
    }
    return new Decision(
        HttpStatus.BAD_REQUEST, isDecodingFailure(ex) ? INVALID_ENCODING_MESSAGE : GENERIC_MESSAGE);
  }

  /** 원인 사슬에 디코딩 실패가 있는지 — 디코딩 예외가 늘 가장 안쪽 원인이라는 보장이 없어 사슬 전체를 본다. */
  private static boolean isDecodingFailure(Throwable ex) {
    for (Throwable t = ex; t != null; t = t.getCause()) {
      if (t instanceof CharConversionException || t instanceof CharacterCodingException) {
        return true;
      }
    }
    return false;
  }
}
