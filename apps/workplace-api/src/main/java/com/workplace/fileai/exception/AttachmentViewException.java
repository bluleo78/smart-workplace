package com.workplace.fileai.exception;

import java.util.Map;

/**
 * 첨부를 모델 입력용 이미지로 보여 주지 못한 이유(WP-250). 상태 코드·오류 코드·(범위 밖이면) PDF 쪽수를 싣는다.
 *
 * <p>메시지는 생성 시 코드로 정한다 — HTTP 응답(GlobalExceptionHandler)뿐 아니라 이 예외를 직접 받는 AI 도구 경로에서도 같은 한국어 안내가
 * 나가게 하려는 것이다. 메시지는 모델이 읽고 다음 행동을 고르는 안내문이라, 사용자에게 다시 올려 달라고 하면 안 되는 경우(손상·암호)를 분명히 적는다.
 */
public class AttachmentViewException extends RuntimeException {

  /** 워커 장애·서버 쪽 결함을 하나로 모은 코드 — 모델에게는 "잠시 후 다시"만 안내한다. */
  public static final String WORKER_UNAVAILABLE = "WORKER_UNAVAILABLE";

  /** 코드별 HTTP 상태 — 워커가 돌려주는 사용자 쪽 오류 코드와 API 자체 검사 코드를 함께 둔다. */
  private static final Map<String, Integer> STATUS =
      Map.of(
          "PAGE_OUT_OF_RANGE",
          400,
          "PAGE_REQUIRED",
          400,
          "PAGE_NOT_ALLOWED",
          400,
          "NOT_FOUND",
          404,
          "TOO_LARGE",
          413,
          "UNSUPPORTED",
          415,
          "UNREADABLE",
          422,
          WORKER_UNAVAILABLE,
          503);

  private final String code;
  private final Integer pageCount;

  /**
   * 상태는 코드에서 정한다({@link #statusOf}) — 호출자가 상태와 코드를 따로 넘겨 어긋나는 일이 없게 한 곳의 표만 쓴다.
   *
   * @param code 오류 코드(표에 없으면 503 · WORKER_UNAVAILABLE 안내)
   * @param pageCount PDF 전체 쪽수 — PAGE_OUT_OF_RANGE 에서만 의미가 있다(모르면 null)
   */
  public AttachmentViewException(String code, Integer pageCount) {
    super(messageOf(code, pageCount));
    this.code = code;
    this.pageCount = pageCount;
  }

  /** 페이지 수가 필요 없는 코드용. */
  public AttachmentViewException(String code) {
    this(code, null);
  }

  /** 워커 장애·타임아웃·서버 쪽 결함 — 503 WORKER_UNAVAILABLE. */
  public static AttachmentViewException workerUnavailable() {
    return new AttachmentViewException(WORKER_UNAVAILABLE);
  }

  /**
   * 워커가 돌려준 오류 코드를 그대로 전할 수 있는지 — 표에 있는 사용자 쪽 코드만 전한다. BAD_KEY 처럼 API 가 만든 값의 결함이나 모르는 코드는 호출자가
   * {@link #workerUnavailable()} 로 모은다(모델이 고칠 수 없는 원인을 고치라고 안내하지 않게).
   */
  public static boolean isPassThrough(String code) {
    return code != null && STATUS.containsKey(code) && !WORKER_UNAVAILABLE.equals(code);
  }

  /** 코드의 HTTP 상태 — 코드↔상태의 유일한 표. 워커 응답 상태도 이 표로 다시 정한다. 모르는 코드는 503. */
  public static int statusOf(String code) {
    return code == null ? 503 : STATUS.getOrDefault(code, 503);
  }

  private static String messageOf(String code, Integer pageCount) {
    return switch (code == null ? "" : code) {
      case "PAGE_OUT_OF_RANGE" ->
          pageCount != null
              ? "이 PDF 는 " + pageCount + "쪽입니다. 1~" + pageCount + " 사이 페이지를 지정하세요."
              // 쪽수를 아직 모르는 경우(page < 1 을 워커 전에 거른 때) — "null쪽" 이 나가지 않게 따로 둔다.
              : "페이지는 1 이상이어야 합니다.";
      case "PAGE_REQUIRED" -> "PDF 는 page 로 볼 페이지를 지정해야 합니다.";
      case "PAGE_NOT_ALLOWED" -> "page 는 PDF 에만 쓸 수 있습니다.";
      case "UNSUPPORTED" -> "PDF·이미지만 이미지로 볼 수 있습니다(SVG 는 볼 수 없습니다).";
      case "TOO_LARGE" -> "25MB 를 넘는 파일은 이미지로 만들 수 없습니다.";
      case "UNREADABLE" -> "파일을 열 수 없습니다(손상·암호). 사용자에게 다시 올려 달라고 하지 마세요.";
      case "NOT_FOUND" -> "원본 파일을 찾을 수 없습니다.";
      default -> "페이지 이미지를 만들지 못했습니다. 잠시 후 다시 시도하세요.";
    };
  }

  /** HTTP 상태 — 코드에서 정한다({@link #statusOf}). */
  public int status() {
    return statusOf(code);
  }

  public String code() {
    return code;
  }

  /** PDF 전체 쪽수 — PAGE_OUT_OF_RANGE 에서만 싣는다(모르면 null). */
  public Integer pageCount() {
    return pageCount;
  }
}
