package com.workplace.wiki.dto;

/**
 * 노트 첨부 업로드·클레임 응답. url 은 본문 마크다운에 그대로 삽입되는 정본 경로다.
 *
 * <p>{@code image} 는 매직바이트로 확인된 이미지(PNG·JPEG·GIF·WebP)인지다(WP-1545) — 참이면 본문에 {@code ![alt](url)} 로,
 * 거짓이면 파일 링크 {@code [이름](url)} 로 넣는다. 원본 이름·MIME·크기는 파일 칩 표시용이다.
 */
public record WikiAttachmentResponse(
    Long fileId, String url, String originalName, String mimeType, long sizeBytes, boolean image) {

  /**
   * 본문 마크다운에 저장되는 정본 경로.
   *
   * <p>이 형태만 promote 파서(WikiAttachmentService.ATTACHMENT_URL)가 인식한다. 형태를 바꾸면 이미 저장된 본문의 이미지가 영구화되지
   * 못하고 만료 수거된다 — 반드시 파서와 함께 바꿀 것.
   */
  public static String urlOf(long pageId, long fileId) {
    return "/api/v1/wiki/pages/" + pageId + "/attachments/" + fileId + "/content";
  }
}
