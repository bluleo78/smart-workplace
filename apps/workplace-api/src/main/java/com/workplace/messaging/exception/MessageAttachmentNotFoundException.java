package com.workplace.messaging.exception;

/**
 * 메시지 첨부 읽기(/content·/preview·/text·/view)에서 그 메시지에 붙어 있지 않은 파일 id. → 404
 *
 * <p>왜 404 인가(WP-1679): 메시지 수정에서 뺀 파일은 그 메시지의 다운로드·미리 보기 주소로 열면 「없는 첨부」여야 한다(완료 기준 5). 원래 이 경우는 업로드
 * 바인딩 검증과 같은 400({@link InvalidMessageAttachmentException})이었는데, 읽기 쪽 「없음」은 요청이 잘못된 게 아니라 대상이 없는
 * 것이라 404 로 가른다. 처음부터 붙은 적 없는 id·삭제된 메시지의 첨부도 같은 거절이다 — 경우별로 코드가 갈리면 파일이 한때 붙어 있었는지가 드러난다.
 */
public class MessageAttachmentNotFoundException extends RuntimeException {
  public MessageAttachmentNotFoundException(long fileId) {
    super("첨부 파일을 찾을 수 없습니다");
  }
}
