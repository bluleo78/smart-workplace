package com.workplace.notify.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * 그 항목에 없는 행위자 열을 바꾸려 했다(예: 「답변 필요」의 「사람이」 칸) → 400. 칸이 없는 쪽은 화면에 「–」로만 보이므로 정상 클라이언트는 보내지 않는다 —
 * 저장하면 판정에 쓰이지 않는 유령 값이 남으므로 거절한다.
 */
@ResponseStatus(HttpStatus.BAD_REQUEST)
public class NotificationSettingCellNotFoundException extends RuntimeException {
  public NotificationSettingCellNotFoundException() {
    super("없는 알림 설정 칸입니다");
  }
}
