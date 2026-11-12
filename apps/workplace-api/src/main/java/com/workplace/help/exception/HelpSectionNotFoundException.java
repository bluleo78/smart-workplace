package com.workplace.help.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 매뉴얼 절 없음 → 404(WP-1510). 관리자 장을 관리자 아닌 이가 찾을 때도 같은 예외·같은 메시지를 써 그 절이 있다는 것조차 드러내지 않는다. 목록을 아직 못
 * 읽은 때(웹이 안 뜸)도 이것으로 답한다 — 서버 오류로 새지 않게.
 */
public class HelpSectionNotFoundException extends RuntimeException implements CodedException {

  public HelpSectionNotFoundException() {
    super("매뉴얼 절을 찾을 수 없습니다");
  }

  /** 응답 상태 — 항상 404. */
  @Override
  public HttpStatus status() {
    return HttpStatus.NOT_FOUND;
  }

  /** 응답 {@code errors} — 사유 코드가 따로 없다. */
  @Override
  public Map<String, String> errors() {
    return null;
  }
}
