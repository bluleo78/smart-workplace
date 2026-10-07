package com.workplace.wiki.exception;

/**
 * 동기화 서버가 API 의 요청 자체를 거부했다(404·410 을 제외한 4xx — 잘못된 본문·인증 토큰 불일치·본문 상한 초과 등).
 *
 * <p>일시 장애가 아니라 재시도해도 같은 결과가 나오는 API 쪽 결함·설정 오류라 503 으로 "잠시 후 재시도"를 유도하지 않는다. 별도 핸들러 없이 캐치올(500)로
 * 떨어뜨려 서버 오류로 드러나게 한다.
 */
public class CollabRequestRejectedException extends RuntimeException {
  public CollabRequestRejectedException(String message, Throwable cause) {
    super(message, cause);
  }
}
