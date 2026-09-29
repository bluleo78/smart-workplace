package com.workplace.notify.push;

import java.util.Map;

/** 암호화된 푸시 본문을 endpoint 로 전송하는 HTTP 추상화. 테스트에서 가짜 구현으로 교체해 발송을 캡처한다. */
public interface PushGateway {

  /**
   * 전송 후 HTTP 상태코드를 반환한다. 4xx/5xx 도 예외 없이 코드로 돌려주고, 네트워크 오류·타임아웃은 -1.
   *
   * @param headers TTL, Urgency, Content-Encoding, Content-Type, Authorization
   */
  int deliver(String endpoint, byte[] body, Map<String, String> headers);
}
