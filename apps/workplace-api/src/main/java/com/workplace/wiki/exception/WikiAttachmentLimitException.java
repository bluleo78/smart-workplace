package com.workplace.wiki.exception;

/** 페이지당 첨부 개수 한도를 초과했을 때 — HTTP 409 매핑. */
public class WikiAttachmentLimitException extends RuntimeException {

  private WikiAttachmentLimitException(String message) {
    super(message);
  }

  /**
   * 해소 가능한 상한(본문 참조 ∪ 임시). 사용자가 본문에서 이미지를 지우고 저장하면 즉시 풀린다(#757).
   *
   * <p>아래 실링과 메시지를 다르게 두는 이유: 둘 다 409 라 클라이언트가 구분할 수 없으면 통하지 않는 조치를 안내하게 된다.
   */
  public static WikiAttachmentLimitException resolvable(long pageId, int limit) {
    return new WikiAttachmentLimitException(
        "페이지당 첨부 한도 초과: pageId="
            + pageId
            + " limit="
            + limit
            + " — 본문에서 사용하지 않는 이미지를 지우고 저장하면 다시 올릴 수 있습니다.");
  }

  /** 매핑 총개수 하드 실링(#759). 본문을 정리해도 풀리지 않고, 참조가 빠진 첨부의 유예가 끝나 회수돼야 풀린다. */
  public static WikiAttachmentLimitException ceiling(long pageId, int limit) {
    return new WikiAttachmentLimitException(
        "페이지당 첨부 누적 한도 초과: pageId="
            + pageId
            + " ceiling="
            + limit
            + " — 지운 이미지가 정리될 때까지 이 페이지에는 더 올릴 수 없습니다.");
  }
}
