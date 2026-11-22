package com.workplace.global.exception;

import com.workplace.global.util.ExceptionCauses;
import jakarta.servlet.http.HttpServletRequest;
import java.io.CharConversionException;
import java.nio.charset.CharacterCodingException;
import org.apache.tomcat.util.http.InvalidParameterException;
import org.slf4j.Logger;
import org.springframework.http.HttpStatus;

/**
 * Tomcat 의 매개변수 파싱 실패(InvalidParameterException)에 내보낼 상태·한국어 문구를 한 곳에서 정한다(WP-1949).
 *
 * <p>전역 예외 핸들러와, 디스패처보다 먼저 매개변수를 읽는 필터(PublicRateLimitFilter)가 함께 쓴다. Tomcat 은 쿼리 디코딩 실패를 첫
 * getParameter 에서 한 번만 던지고 이후 읽기는 일부만 파싱된 값을 조용히 돌려주므로, 첫 읽기 주체가 누구든 같은 판정으로 바로 거절해야 하기 때문이다. 영어
 * 원문(컨테이너 내부 안내)은 어느 갈래에서도 내보내지 않는다.
 *
 * <p>매개변수는 쿼리스트링에서도 폼 본문에서도 오므로 문구에 「주소」를 쓰지 않고, 무엇이 틀렸는지 알 수 있게 원인(깨진 % 인코딩·UTF-8 이 아닌 바이트· 크기·그
 * 밖)마다 따로 안내한다(WP-1949 리뷰 후속).
 */
public final class InvalidParameterResponses {

  /** 거절 원인 — 응답 상태·고정 한국어 문구를 함께 든다. */
  public enum Cause {
    /** 본문 한도 초과(Tomcat 오류 코드 413) — 컨테이너 단계 413 과 같은 문구. */
    TOO_LARGE(HttpStatus.PAYLOAD_TOO_LARGE, GlobalExceptionHandler.PAYLOAD_TOO_LARGE_MESSAGE),
    /** 깨진 % 인코딩(% 뒤에 16진수 두 자리가 아님 — UDecoder 의 CharConversionException). */
    INVALID_PERCENT_ENCODING(
        HttpStatus.BAD_REQUEST, "요청 매개변수의 퍼센트(%) 인코딩이 올바르지 않습니다. 특수문자 %는 %25 로 인코딩해 주세요."),
    /** % 인코딩은 맞지만 풀어 낸 바이트를 UTF-8 로 읽을 수 없음(CharacterCodingException) — %25 안내는 도움이 되지 않는다. */
    INVALID_CHARSET(
        HttpStatus.BAD_REQUEST, "요청 매개변수에 UTF-8 로 읽을 수 없는 문자가 있습니다. 매개변수를 UTF-8 로 인코딩해 보내 주세요."),
    /** 그 밖(매개변수 개수 초과 등) — 인코딩 안내를 잘못 붙이지 않는다. */
    OTHER(HttpStatus.BAD_REQUEST, "요청 매개변수를 처리할 수 없습니다. 매개변수 개수와 형식을 확인해 주세요.");

    private final HttpStatus status;
    private final String message;

    Cause(HttpStatus status, String message) {
      this.status = status;
      this.message = message;
    }

    /** 응답 상태. */
    public HttpStatus status() {
      return status;
    }

    /** 응답에 싣는 고정 한국어 문구. */
    public String message() {
      return message;
    }
  }

  private InvalidParameterResponses() {}

  /**
   * 원인을 판정하고 거절 사실을 debug 로그로 남긴다 — 응답에는 원인을 싣지 않으므로 운영 추적용이다. 매개변수 값이 든 예외 메시지·스택은 남기지 않고 클래스 이름
   * 사슬만 남긴다. 거절하는 곳(핸들러·필터)이 모두 이것을 불러 로그 형식이 한 곳에 있다.
   *
   * @param origin 거절한 곳(로그 구분용, 예: 「전역 핸들러」)
   */
  public static Cause reject(
      Logger log, String origin, HttpServletRequest request, InvalidParameterException ex) {
    Cause cause = decide(ex);
    if (log.isDebugEnabled()) {
      log.debug(
          "잘못된 요청 매개변수 거절({}) — {} {} 원인 {} ({})",
          origin,
          request.getMethod(),
          request.getRequestURI(),
          cause,
          ExceptionCauses.classChain(ex));
    }
    return cause;
  }

  /**
   * 원인별 판정 — 오류 코드 413 → 크기 안내, 원인 사슬에 % 디코딩 실패(CharConversionException) → %25 안내, 문자셋 디코딩
   * 실패(CharacterCodingException) → UTF-8 안내, 그 밖(개수 초과 등) → 일반 안내.
   */
  static Cause decide(InvalidParameterException ex) {
    if (ex.getErrorCode() == HttpStatus.PAYLOAD_TOO_LARGE.value()) {
      return Cause.TOO_LARGE;
    }
    // 디코딩 예외가 늘 가장 안쪽 원인이라는 보장이 없어 사슬 전체를 본다. 두 타입이 함께 있으면 바깥쪽(먼저 만나는) 것으로 정한다 — Tomcat 11 은
    // 디코딩 단계마다 하나만 원인으로 감싸 실제로는 함께 오지 않는다.
    for (Throwable t = ex; t != null; t = t.getCause()) {
      if (t instanceof CharConversionException) {
        return Cause.INVALID_PERCENT_ENCODING;
      }
      if (t instanceof CharacterCodingException) {
        return Cause.INVALID_CHARSET;
      }
    }
    return Cause.OTHER;
  }
}
