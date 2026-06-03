package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import com.workplace.mail.dto.EmailAttachmentMeta;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.ParsedMessage;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/**
 * email_message jOOQ 리포지토리. 목록/검색은 account 스코프, 상세는 소유 검증을 위해 email_account 와 조인한다. 첨부 메타는 message
 * 의 자식이라 상세 조립 시 함께 읽는다.
 */
@Repository
@RequiredArgsConstructor
public class EmailMessageRepository {

  private final DSLContext dsl;

  /** UIDVALIDITY 변경 시 폴더의 기존 메시지를 모두 삭제(서버가 UID 를 재사용하므로 stale 충돌 방지). */
  public void deleteByFolder(long folderId) {
    dsl.deleteFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.FOLDER_ID.eq(folderId)).execute();
  }

  /**
   * 파싱된 메시지를 저장. (account_id, folder_id, imap_uid) 유니크 충돌 시 무시(재동기화 멱등성). 새로 삽입되면 생성 id 를, 이미 있으면
   * empty 를 반환한다.
   */
  public Optional<Long> insertIgnoreConflict(long accountId, long folderId, ParsedMessage m) {
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.IMAP_UID, m.imapUid())
        .set(EMAIL_MESSAGE.MESSAGE_ID, m.messageId())
        .set(EMAIL_MESSAGE.THREAD_ID, m.threadId())
        .set(EMAIL_MESSAGE.IN_REPLY_TO, m.inReplyTo())
        .set(EMAIL_MESSAGE.MAIL_REFERENCES, m.references())
        .set(EMAIL_MESSAGE.FROM_ADDRESS, m.fromAddress())
        .set(EMAIL_MESSAGE.FROM_NAME, m.fromName())
        .set(EMAIL_MESSAGE.TO_ADDRESSES, m.toAddresses())
        .set(EMAIL_MESSAGE.CC_ADDRESSES, m.ccAddresses())
        .set(EMAIL_MESSAGE.SUBJECT, m.subject())
        .set(EMAIL_MESSAGE.SENT_AT, toOffset(m.sentAt()))
        .set(EMAIL_MESSAGE.RECEIVED_AT, toOffset(m.receivedAt()))
        .set(EMAIL_MESSAGE.SEEN, m.seen())
        .set(EMAIL_MESSAGE.HAS_ATTACHMENT, m.hasAttachment())
        .set(EMAIL_MESSAGE.BODY_TEXT, m.bodyText())
        .set(EMAIL_MESSAGE.BODY_HTML, m.bodyHtml())
        .set(EMAIL_MESSAGE.SNIPPET, m.snippet())
        .onConflictDoNothing()
        .returning(EMAIL_MESSAGE.ID)
        .fetchOptional()
        .map(r -> r.get(EMAIL_MESSAGE.ID));
  }

  /**
   * 계정의 메시지 목록(최신 수신순, 본문 제외). query 가 있으면 제목/보낸사람/스니펫에 대소문자 무시 부분일치로 필터한다. 소유 검증은 호출 측(서비스)에서 계정
   * 소유 확인 후 호출하므로 여기서는 account_id 스코프만 적용한다.
   */
  public List<EmailMessageSummary> listByAccount(long accountId, String query, int limit) {
    Condition where = EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId);
    if (query != null && !query.isBlank()) {
      String like = "%" + query.trim() + "%";
      where =
          where.and(
              EMAIL_MESSAGE
                  .SUBJECT
                  .likeIgnoreCase(like)
                  .or(EMAIL_MESSAGE.FROM_ADDRESS.likeIgnoreCase(like))
                  .or(EMAIL_MESSAGE.FROM_NAME.likeIgnoreCase(like))
                  .or(EMAIL_MESSAGE.SNIPPET.likeIgnoreCase(like)));
    }
    return dsl.select(
            EMAIL_MESSAGE.ID,
            EMAIL_MESSAGE.THREAD_ID,
            EMAIL_MESSAGE.FROM_ADDRESS,
            EMAIL_MESSAGE.FROM_NAME,
            EMAIL_MESSAGE.SUBJECT,
            EMAIL_MESSAGE.SNIPPET,
            EMAIL_MESSAGE.RECEIVED_AT,
            EMAIL_MESSAGE.SEEN,
            EMAIL_MESSAGE.HAS_ATTACHMENT)
        .from(EMAIL_MESSAGE)
        .where(where)
        .orderBy(EMAIL_MESSAGE.RECEIVED_AT.desc().nullsLast(), EMAIL_MESSAGE.ID.desc())
        .limit(limit)
        .fetch(this::toSummary);
  }

  /**
   * 메시지 단건 상세(본문 + 첨부 메타). 소유 검증을 위해 email_account 와 조인해 account.user_id = userId 인 경우만 반환. 타인/없음이면
   * empty(컨트롤러에서 404).
   */
  public Optional<EmailMessageDetail> findDetailByIdAndUser(long userId, long messageId) {
    Optional<EmailMessageDetail> base =
        dsl.select(
                EMAIL_MESSAGE.ID,
                EMAIL_MESSAGE.THREAD_ID,
                EMAIL_MESSAGE.MESSAGE_ID,
                EMAIL_MESSAGE.FROM_ADDRESS,
                EMAIL_MESSAGE.FROM_NAME,
                EMAIL_MESSAGE.TO_ADDRESSES,
                EMAIL_MESSAGE.CC_ADDRESSES,
                EMAIL_MESSAGE.SUBJECT,
                EMAIL_MESSAGE.SENT_AT,
                EMAIL_MESSAGE.RECEIVED_AT,
                EMAIL_MESSAGE.SEEN,
                EMAIL_MESSAGE.BODY_TEXT,
                EMAIL_MESSAGE.BODY_HTML)
            .from(EMAIL_MESSAGE)
            .join(EMAIL_ACCOUNT)
            .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
            .where(EMAIL_MESSAGE.ID.eq(messageId))
            .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
            .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
            .fetchOptional(r -> toDetail(r, List.of()));
    if (base.isEmpty()) {
      return base;
    }
    List<EmailAttachmentMeta> attachments = listAttachments(messageId);
    EmailMessageDetail d = base.get();
    return Optional.of(toDetail(d, attachments));
  }

  /** 메시지의 첨부 메타 목록. */
  private List<EmailAttachmentMeta> listAttachments(long messageId) {
    return dsl.select(
            EMAIL_ATTACHMENT.ID,
            EMAIL_ATTACHMENT.FILENAME,
            EMAIL_ATTACHMENT.CONTENT_TYPE,
            EMAIL_ATTACHMENT.SIZE_BYTES,
            EMAIL_ATTACHMENT.CONTENT_ID)
        .from(EMAIL_ATTACHMENT)
        .where(EMAIL_ATTACHMENT.MESSAGE_ID.eq(messageId))
        .orderBy(EMAIL_ATTACHMENT.ID.asc())
        .fetch(
            r ->
                new EmailAttachmentMeta(
                    r.get(EMAIL_ATTACHMENT.ID),
                    r.get(EMAIL_ATTACHMENT.FILENAME),
                    r.get(EMAIL_ATTACHMENT.CONTENT_TYPE),
                    r.get(EMAIL_ATTACHMENT.SIZE_BYTES) == null
                        ? 0L
                        : r.get(EMAIL_ATTACHMENT.SIZE_BYTES),
                    r.get(EMAIL_ATTACHMENT.CONTENT_ID)));
  }

  private EmailMessageSummary toSummary(Record r) {
    OffsetDateTime received = r.get(EMAIL_MESSAGE.RECEIVED_AT);
    return new EmailMessageSummary(
        r.get(EMAIL_MESSAGE.ID),
        r.get(EMAIL_MESSAGE.THREAD_ID),
        r.get(EMAIL_MESSAGE.FROM_ADDRESS),
        r.get(EMAIL_MESSAGE.FROM_NAME),
        r.get(EMAIL_MESSAGE.SUBJECT),
        r.get(EMAIL_MESSAGE.SNIPPET),
        received == null ? null : received.toInstant(),
        Boolean.TRUE.equals(r.get(EMAIL_MESSAGE.SEEN)),
        Boolean.TRUE.equals(r.get(EMAIL_MESSAGE.HAS_ATTACHMENT)));
  }

  private EmailMessageDetail toDetail(Record r, List<EmailAttachmentMeta> attachments) {
    OffsetDateTime sent = r.get(EMAIL_MESSAGE.SENT_AT);
    OffsetDateTime received = r.get(EMAIL_MESSAGE.RECEIVED_AT);
    return new EmailMessageDetail(
        r.get(EMAIL_MESSAGE.ID),
        r.get(EMAIL_MESSAGE.THREAD_ID),
        r.get(EMAIL_MESSAGE.MESSAGE_ID),
        r.get(EMAIL_MESSAGE.FROM_ADDRESS),
        r.get(EMAIL_MESSAGE.FROM_NAME),
        r.get(EMAIL_MESSAGE.TO_ADDRESSES),
        r.get(EMAIL_MESSAGE.CC_ADDRESSES),
        r.get(EMAIL_MESSAGE.SUBJECT),
        sent == null ? null : sent.toInstant(),
        received == null ? null : received.toInstant(),
        Boolean.TRUE.equals(r.get(EMAIL_MESSAGE.SEEN)),
        r.get(EMAIL_MESSAGE.BODY_TEXT),
        r.get(EMAIL_MESSAGE.BODY_HTML),
        attachments);
  }

  /** 이미 조회한 상세에 첨부 목록만 채워 새 레코드로 반환. */
  private EmailMessageDetail toDetail(EmailMessageDetail d, List<EmailAttachmentMeta> attachments) {
    return new EmailMessageDetail(
        d.id(),
        d.threadId(),
        d.messageId(),
        d.fromAddress(),
        d.fromName(),
        d.toAddresses(),
        d.ccAddresses(),
        d.subject(),
        d.sentAt(),
        d.receivedAt(),
        d.seen(),
        d.bodyText(),
        d.bodyHtml(),
        attachments);
  }

  private static OffsetDateTime toOffset(java.time.Instant instant) {
    return instant == null ? null : OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
  }
}
