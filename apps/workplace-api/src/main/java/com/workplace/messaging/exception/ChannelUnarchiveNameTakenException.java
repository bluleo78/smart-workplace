package com.workplace.messaging.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 보관 해제하려는 채널과 같은 이름의 활성 채널이 이미 있음 — 409 와 사유 코드 CHANNEL_NAME_TAKEN (WP-1084). 보관한 채널의 이름은 새 채널이 다시
 * 쓸 수 있어(#688) 해제가 이름 유일성에 걸린다. 공용 처리기는 「이미 있는 항목과 겹쳐 처리하지 못했습니다」만 내보내 할 일을 알 수 없었다 — 웹은 이 코드로 새
 * 이름을 받는 대화창을 연다.
 */
public class ChannelUnarchiveNameTakenException extends RuntimeException implements CodedException {

  /** 응답 errors.code — 웹이 새 이름 대화창을 여는 기준. */
  public static final String CODE = "CHANNEL_NAME_TAKEN";

  public ChannelUnarchiveNameTakenException() {
    super("같은 이름의 채널이 있어 보관을 해제할 수 없습니다. 새 이름으로 해제해 주세요.");
  }

  /** 응답 상태 — 항상 409. */
  @Override
  public HttpStatus status() {
    return HttpStatus.CONFLICT;
  }

  /** 응답 {@code errors} — 사유 코드 하나. */
  @Override
  public Map<String, String> errors() {
    return Map.of("code", CODE);
  }
}
