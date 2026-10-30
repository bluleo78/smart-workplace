package com.workplace.user.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * 아바타 이미지 처리 자리가 다 찼다(WP-1222) — 업로드가 몰려 동시 처리 상한을 넘었다. 공용 처리기가 선언된 상태(429)와 이 문구로 응답한다(홈 채팅 동시 생성
 * 상한과 같은 429). 사용자 잘못이 아닌 일시적 혼잡이라 다시 시도하면 된다.
 */
@ResponseStatus(HttpStatus.TOO_MANY_REQUESTS)
public class AvatarProcessingBusyException extends RuntimeException {
  public AvatarProcessingBusyException() {
    super("아바타 처리 요청이 몰려 있습니다. 잠시 후 다시 시도해 주세요");
  }
}
