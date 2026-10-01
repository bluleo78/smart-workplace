package com.workplace.notify.push;

import java.util.Map;

/** 암호화된 푸시 본문을 endpoint 로 전송하는 HTTP 추상화. 테스트에서 가짜 구현으로 교체해 발송을 캡처한다. */
public interface PushGateway {

  /**
   * 전송 후 결과를 반환한다. 4xx/5xx 도 예외 없이 상태코드로 돌려주고, 네트워크 오류·타임아웃은 -1. 로그는 남기지 않는다 — 상태 해석과 기록은
   * PushSender 가 한다.
   *
   * @param headers TTL, Urgency, Content-Encoding, Content-Type, Authorization
   */
  Result deliver(String endpoint, byte[] body, Map<String, String> headers);

  /**
   * 발송 결과. reason 은 실패 원인 요약(푸시 서비스 응답 본문 앞부분 — Apple {"reason":"BadJwtToken"} 등 — 또는 예외 원인)이며, 구독
   * 토큰인 endpoint 경로는 담지 않는다. 성공이면 빈 문자열.
   */
  record Result(int status, String reason) {

    public static Result of(int status) {
      return new Result(status, "");
    }
  }
}
