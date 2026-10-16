package com.workplace.file.exception;

/**
 * 스테이징 파일을 클레임할 수 없음(WP-421) — HTTP 400.
 *
 * <p>없는 파일·남의 파일·이미 영구가 된 파일·만료된 파일·ATTACHMENT 가 아닌 파일·이미 다른 곳에 묶인 파일을 모두 같은 예외로 다룬다. 원인을 나눠 알려 주면
 * 남의 파일 id 의 존재·상태를 떠볼 수 있으므로 사용자 문구는 하나로 두고, 어느 id 인지만 담는다(목록 입력에서 어느 파일을 다시 올릴지 가리키려고).
 */
public class StagedFileUnusableException extends RuntimeException {

  /** 사용자에게 보이는 고정 문구 — GlobalExceptionHandler 가 그대로 응답한다. */
  public static final String USER_MESSAGE = "첨부 파일을 사용할 수 없어요. 파일을 다시 올려 주세요.";

  private final long fileId;

  public StagedFileUnusableException(long fileId) {
    super(USER_MESSAGE + " (fileId: " + fileId + ")");
    this.fileId = fileId;
  }

  /** 첫 위반 파일 id(입력 순서 기준). */
  public long fileId() {
    return fileId;
  }
}
