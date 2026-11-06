package com.workplace.mail.api;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.MAIL_ATTACHMENT_BLOB;

import org.jooq.Condition;
import org.jooq.impl.DSL;

/**
 * mail_attachment_blob 행을 가르는 조건 — 다른 모듈(drive 쿼터)이 mail 서비스를 import 하지 않고 같은 판별을 쓰도록
 * 공개한다(WP-1391).
 *
 * <p>판별을 한곳에 두는 까닭: 메일 blob GC({@code MailAttachmentBlobGcSweeper})가 TTL 로 지우지 않는 blob 과 저장 공간 사용량에
 * 넣는 blob 이 같아야 한다. 각자 복사해 두면 한쪽만 바뀌었을 때 「지우지 않는데 세지도 않는」 blob 이 생긴다.
 */
public final class MailBlobConditions {

  private MailBlobConditions() {}

  /**
   * 이 blob(바깥 쿼리의 {@code mail_attachment_blob} 행)을 로컬 보낸 메일(WP-574)의 첨부가 참조하는지.
   *
   * <p>로컬 보낸 메일 행은 imap_uid·provider_message_id 가 모두 NULL 이다(V141 과 같은 판별). 그런 blob 은 원본 서버에서 다시 받을
   * 좌표가 없는 유일 사본이라 TTL 로 퇴거하지 않고, 저장 공간 사용량에 넣는다. {@code MAIL_ATTACHMENT_BLOB} 을 FROM 에 둔 쿼리 안에서만
   * 쓴다.
   */
  public static Condition localSent() {
    return DSL.exists(
        DSL.selectOne()
            .from(CONTENT_ATTACHMENT)
            .join(EMAIL_MESSAGE)
            .on(EMAIL_MESSAGE.CONTENT_ID.eq(CONTENT_ATTACHMENT.CONTENT_ID))
            .where(CONTENT_ATTACHMENT.CONTENT_HASH.eq(MAIL_ATTACHMENT_BLOB.CONTENT_HASH))
            .and(EMAIL_MESSAGE.IMAP_UID.isNull())
            .and(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID.isNull()));
  }
}
