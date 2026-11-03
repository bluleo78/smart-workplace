package com.workplace.mail.util;

import java.util.Locale;

/**
 * 메일 첨부 메타 크기 → 실제(원본) 바이트 추정(WP-1329).
 *
 * <p>IMAP 서버에서 받아 파싱한 첨부의 content_attachment.size_bytes 는 {@code part.getSize()} — 전송 인코딩(대개
 * base64)된 본문 크기라 실제 파일보다 약 1.37배 크다. 저장값을 바꾸면 그 값을 인코딩 크기로 보고 보정하는 원본 받기 판정({@code
 * MailAttachmentResolver.exceedsBeforeFetch})이 이중 보정되고 기존 행 마이그레이션도 필요해, 저장값은 그대로 두고 읽는 쪽(작성창
 * 사전검증·메일 상세 첨부 목록·임시저장 상세)에서만 이 추정을 쓴다. 발송 시 실제 바이트 누적(MailComposeService.Budget)이 최종 판정이다.
 *
 * <p>Graph 첨부와 이 앱이 보낸 메일의 첨부(MailSentAttachmentRecorder — 실제 바이트 길이로 기록)는 이미 실제 크기라 보정하지 않는다. 둘 다
 * email_message.imap_uid 가 NULL 이고, IMAP 서버에서 받은 메일만 UID 를 가진다 — 그래서 보정 기준을 공급자가 아니라 UID 유무로 잡는다.
 */
public final class MailAttachmentSizes {

  private MailAttachmentSizes() {}

  /**
   * 메타 크기를 실제 바이트 추정으로 바꾼다.
   *
   * <p>표준 MIME base64 는 원본 57바이트를 76자 + CRLF = 78바이트로 싣는다 — 그래서 ×57/78. 단순 ×3/4 는 줄바꿈을 빼먹어 약 2.6%
   * 크게 잡아 실제 24.4~25MB 파일을 여전히 거절한다. 약간 작게 잡는 쪽은 안전하다(발송 때 실제 바이트로 다시 센다).
   *
   * @param storedBytes content_attachment.size_bytes(NULL 이면 0 으로 넘긴다)
   * @param fromImapServer IMAP 서버에서 받아 파싱한 메일의 첨부인가(email_message.imap_uid IS NOT NULL)
   * @return 실제 바이트 추정치
   */
  public static long estimatedRawBytes(long storedBytes, boolean fromImapServer) {
    if (!fromImapServer || storedBytes <= 0) {
      return Math.max(storedBytes, 0);
    }
    // 마지막 짧은 줄(4자 단위 패딩 + CRLF)이 최대 약 3.4바이트 크게 잡히게 해 4바이트를 빼 둔다 — 실제 25MB 정확히가 넘침으로 보이지 않게.
    // 아주 작은 첨부(1~3바이트 → "AQ==\r\n")가 0 B 로 보이지 않게 최소 1바이트.
    return Math.max(storedBytes * 57 / 78 - 4, 1);
  }

  /** 바이트 → 「25.0MB」(MiB, 소수 한 자리) — 크기 초과 안내 문구용(WP-1329). 상한(1024×1024 단위)과 같은 단위로 맞춘다. */
  public static String formatMb(long bytes) {
    // 0.1MB 단위로 올림 — 한도를 몇 바이트 넘은 크기가 「25.0MB」로 보여 「25MB까지」와 어긋나 보이지 않게.
    double tenths = Math.ceil(bytes / (1024.0 * 1024.0) * 10.0) / 10.0;
    return String.format(Locale.ROOT, "%.1fMB", tenths);
  }

  /** {@link #formatMb} 와 같되 0.1MB 단위로 내림 — 한도를 적을 때 쓴다(넘은 크기와 같은 수로 보이지 않게, WP-1329 리뷰). */
  public static String formatMbFloor(long bytes) {
    double tenths = Math.floor(bytes / (1024.0 * 1024.0) * 10.0) / 10.0;
    return String.format(Locale.ROOT, "%.1fMB", tenths);
  }
}
