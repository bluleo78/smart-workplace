package com.workplace.mail.dto;

import java.time.OffsetDateTime;

/**
 * 내 메일 서명(WP-1517). 서명이 아직 없으면 {@code ("", true, false, null, 0)}.
 *
 * @param html 서버가 정리한 서명 HTML. 빈 서명은 ''. 이미지 src 는 {@code /api/v1/mail/signature/images/{id}}
 * @param autoNew 새 메일에 자동으로 넣는다
 * @param autoReply 답장·전달에 자동으로 넣는다
 * @param updatedAt 마지막 저장 시각(없으면 null)
 * @param droppedImageCount 이번 저장에서 가져오지 못해 뺀 {@code <img>} 수. 조회는 항상 0
 */
public record MailSignatureResponse(
    String html,
    boolean autoNew,
    boolean autoReply,
    OffsetDateTime updatedAt,
    int droppedImageCount) {

  /** 서명이 아직 없을 때의 기본값 — 새 메일 켬, 답장·전달 끔. */
  public static MailSignatureResponse empty() {
    return new MailSignatureResponse("", true, false, null, 0);
  }
}
