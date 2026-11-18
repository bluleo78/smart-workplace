package com.workplace.mail.exception;

import com.workplace.mail.service.MailServerErrors;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 휴지통 완전히 삭제·비우기(WP-1682) 실패 — 사유 코드마다 HTTP 상태와 화면 문구가 정해져 있다. 응답은 표준 ErrorResponse 에 {@code
 * errors.code} 로 코드를 싣는다(웹이 코드로 가려 「지원하지 않음」이면 메일함 목록을 다시 받는 등 다르게 다룬다). 코드 값은 상수 이름 그대로다. 비우기 작업
 * 상태의 FAILED 사유({@code errorCode}·{@code error})도 같은 표({@link #messageOf})를 쓴다.
 */
public class MailTrashException extends RuntimeException {

  /** 휴지통 밖 메일이 섞였다(아무것도 지우지 않았다). */
  public static final String NOT_IN_TRASH = "NOT_IN_TRASH";

  /** IMAP 서버가 UIDPLUS 를 지원하지 않아 그 메일만 골라 지울 수 없다. */
  public static final String PERMANENT_DELETE_UNSUPPORTED = "PERMANENT_DELETE_UNSUPPORTED";

  /** 계정에 휴지통 메일함 행이 없다. */
  public static final String NO_TRASH = "NO_TRASH";

  /** 지난 목록 갱신 뒤 서버 휴지통이 다른 메일함으로 바뀌었다. */
  public static final String TRASH_CHANGED = "TRASH_CHANGED";

  /** 메일 서버에 연결하지 못했다. */
  public static final String SERVER_UNREACHABLE = "SERVER_UNREACHABLE";

  /** 앱 서버가 다시 시작되어 비우기가 멈췄다. */
  public static final String INTERRUPTED = "INTERRUPTED";

  /** 비우기 작업을 더 받을 수 없다(실행기 포화). */
  public static final String TRASH_EMPTY_BUSY = "TRASH_EMPTY_BUSY";

  /** 비우는 도중 메일 계정 연결이 해제됐다. */
  public static final String ACCOUNT_GONE = "ACCOUNT_GONE";

  /** 코드별 응답 상태와 화면 문구(spec 「문구」 표 글자 그대로). */
  private record Spec(HttpStatus status, String message) {}

  private static final Map<String, Spec> SPECS =
      Map.of(
          NOT_IN_TRASH,
          new Spec(HttpStatus.BAD_REQUEST, "휴지통에 있는 메일만 완전히 삭제할 수 있습니다"),
          PERMANENT_DELETE_UNSUPPORTED,
          new Spec(HttpStatus.BAD_REQUEST, "이 메일 서버는 완전히 삭제를 지원하지 않습니다"),
          NO_TRASH,
          new Spec(HttpStatus.BAD_REQUEST, "메일 서버에 휴지통이 없습니다"),
          TRASH_EMPTY_BUSY,
          new Spec(HttpStatus.SERVICE_UNAVAILABLE, "지금은 비울 수 없습니다 — 잠시 뒤 다시 시도해 주세요"),
          TRASH_CHANGED,
          new Spec(HttpStatus.BAD_GATEWAY, "메일 서버 휴지통이 바뀌었습니다 — 새로 고친 뒤 다시 시도해 주세요"),
          SERVER_UNREACHABLE,
          // 메일별 접속 실패 문구와 같은 글자 — 한 곳(MailServerErrors)에 둔다
          new Spec(HttpStatus.BAD_GATEWAY, MailServerErrors.CONNECT_FAILED),
          INTERRUPTED,
          new Spec(HttpStatus.BAD_GATEWAY, "서버가 다시 시작되어 멈췄습니다"),
          ACCOUNT_GONE,
          new Spec(HttpStatus.NOT_FOUND, "메일 계정 연결이 해제되어 멈췄습니다"));

  private final String code;
  private final HttpStatus status;

  private MailTrashException(String code, Spec spec) {
    super(spec.message());
    this.code = code;
    this.status = spec.status();
  }

  /** 코드에 맞는 상태·문구의 예외. 표에 없는 코드는 프로그래밍 오류다. */
  public static MailTrashException of(String code) {
    return new MailTrashException(code, spec(code));
  }

  /** 코드의 화면 문구 — 메일별 결과·비우기 FAILED 사유처럼 예외를 던지지 않고 문구만 담을 때 쓴다. */
  public static String messageOf(String code) {
    return spec(code).message();
  }

  private static Spec spec(String code) {
    Spec spec = SPECS.get(code);
    if (spec == null) {
      throw new IllegalArgumentException("알 수 없는 휴지통 오류 코드: " + code);
    }
    return spec;
  }

  /** 응답 HTTP 상태. */
  public HttpStatus status() {
    return status;
  }

  /** errors.code 로 싣는 사유 코드. */
  public String code() {
    return code;
  }
}
