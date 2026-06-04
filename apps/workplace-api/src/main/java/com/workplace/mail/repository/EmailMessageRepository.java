package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailAttachmentMeta;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.dto.ReplyContext;
import com.workplace.mail.outbound.MailAiMessages;
import java.time.Instant;
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

  /** 기존 호출 호환(받은편지함). 폴더 미지정은 INBOX 로 스코프. */
  public List<EmailMessageSummary> listByAccount(long accountId, String query, int limit) {
    return listByAccount(accountId, "INBOX", query, limit);
  }

  /**
   * 계정 + 폴더(INBOX/SENT) 스코프 목록(최신순, 본문 제외). query 가 있으면 제목/보낸사람/스니펫 부분일치. 폴더 분리를 위해 email_folder 와
   * 조인해 folder.name 으로 필터한다. 소유 검증은 호출 측에서 수행.
   */
  public List<EmailMessageSummary> listByAccount(
      long accountId, String folderName, String query, int limit) {
    Condition where = EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId).and(EMAIL_FOLDER.NAME.eq(folderName));
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
            EMAIL_MESSAGE.HAS_ATTACHMENT,
            EMAIL_MESSAGE.AI_CATEGORY,
            EMAIL_MESSAGE.AI_NEEDS_REPLY)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .where(where)
        .orderBy(EMAIL_MESSAGE.RECEIVED_AT.desc().nullsLast(), EMAIL_MESSAGE.ID.desc())
        .limit(limit)
        .fetch(this::toSummary);
  }

  /** 로컬에서 작성한 보낸메일 1건 저장(imap_uid=NULL, seen=true). 생성된 id 반환. */
  public long insertSent(long accountId, long folderId, OutgoingMail m) {
    Instant sentAt = m.sentAt();
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.IMAP_UID, (Long) null)
        .set(EMAIL_MESSAGE.MESSAGE_ID, m.messageId())
        .set(EMAIL_MESSAGE.THREAD_ID, m.threadId())
        .set(EMAIL_MESSAGE.IN_REPLY_TO, m.inReplyTo())
        .set(EMAIL_MESSAGE.MAIL_REFERENCES, m.references())
        .set(EMAIL_MESSAGE.FROM_ADDRESS, m.fromAddress())
        .set(EMAIL_MESSAGE.FROM_NAME, m.fromName())
        .set(EMAIL_MESSAGE.TO_ADDRESSES, joinOrNull(m.to()))
        .set(EMAIL_MESSAGE.CC_ADDRESSES, joinOrNull(m.cc()))
        .set(EMAIL_MESSAGE.BCC_ADDRESSES, joinOrNull(m.bcc()))
        .set(EMAIL_MESSAGE.SUBJECT, m.subject())
        .set(EMAIL_MESSAGE.SENT_AT, toOffset(sentAt))
        .set(EMAIL_MESSAGE.RECEIVED_AT, toOffset(sentAt))
        .set(EMAIL_MESSAGE.SEEN, true)
        .set(EMAIL_MESSAGE.HAS_ATTACHMENT, false)
        .set(EMAIL_MESSAGE.BODY_TEXT, m.bodyText())
        .set(EMAIL_MESSAGE.BODY_HTML, m.bodyHtml())
        .set(EMAIL_MESSAGE.SNIPPET, m.snippet())
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .get(EMAIL_MESSAGE.ID);
  }

  /** 답장 헤더/스레드 구성용 부모 컨텍스트(thread_id, 부모 Message-ID, 부모 References). 소유 검증 포함. */
  public Optional<ReplyContext> findReplyContextByIdAndUser(long userId, long messageId) {
    return dsl.select(
            EMAIL_MESSAGE.THREAD_ID, EMAIL_MESSAGE.MESSAGE_ID, EMAIL_MESSAGE.MAIL_REFERENCES)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .fetchOptional(
            r ->
                new ReplyContext(
                    r.get(EMAIL_MESSAGE.THREAD_ID),
                    r.get(EMAIL_MESSAGE.MESSAGE_ID),
                    r.get(EMAIL_MESSAGE.MAIL_REFERENCES)));
  }

  /** 주소 리스트를 쉼표로 합침. 비어있으면 null(TEXT 컬럼). */
  private static String joinOrNull(List<String> addrs) {
    return (addrs == null || addrs.isEmpty()) ? null : String.join(", ", addrs);
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
                EMAIL_MESSAGE.BCC_ADDRESSES,
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

  /** 분류 결과 저장(동기화 잡, best-effort). */
  public void updateClassification(long messageId, String category, boolean needsReply) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.AI_CATEGORY, category)
        .set(EMAIL_MESSAGE.AI_NEEDS_REPLY, needsReply)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .execute();
  }

  /** 요약 캐시 저장. */
  public void updateSummary(long messageId, String summary) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.AI_SUMMARY, summary)
        .set(EMAIL_MESSAGE.AI_SUMMARIZED_AT, OffsetDateTime.now())
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .execute();
  }

  /** 본문/스니펫/첨부플래그 저장 + body_fetched_at 갱신(적재 완료 표시). */
  public void updateBody(
      long messageId, String bodyText, String bodyHtml, String snippet, boolean hasAttachment) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.BODY_TEXT, bodyText)
        .set(EMAIL_MESSAGE.BODY_HTML, bodyHtml)
        .set(EMAIL_MESSAGE.SNIPPET, snippet)
        .set(EMAIL_MESSAGE.HAS_ATTACHMENT, hasAttachment)
        .set(EMAIL_MESSAGE.BODY_FETCHED_AT, OffsetDateTime.now())
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .execute();
  }

  /** 본문 미적재 대상(account 별, 최근순). imap_uid 없는 로컬 보낸메일 제외. */
  public List<BodyTarget> listMissingBody(long accountId, int limit) {
    return dsl.select(
            EMAIL_MESSAGE.ID,
            EMAIL_MESSAGE.ACCOUNT_ID,
            EMAIL_MESSAGE.IMAP_UID,
            EMAIL_FOLDER.NAME,
            EMAIL_MESSAGE.BODY_FETCHED_AT)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_MESSAGE.BODY_FETCHED_AT.isNull())
        .and(EMAIL_MESSAGE.IMAP_UID.isNotNull())
        .orderBy(EMAIL_MESSAGE.RECEIVED_AT.desc().nullsLast())
        .limit(limit)
        .fetch(this::toBodyTarget);
  }

  /** 본문 미적재 건수(account 별). 진행률 total 산정용. */
  public int countMissingBody(long accountId) {
    return dsl.fetchCount(
        dsl.selectFrom(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
            .and(EMAIL_MESSAGE.BODY_FETCHED_AT.isNull())
            .and(EMAIL_MESSAGE.IMAP_UID.isNotNull()));
  }

  /** 단건 본문 적재 대상 조회(account 기준 — 호출 측에서 소유 검증 선행). */
  public Optional<BodyTarget> findBodyTarget(long accountId, long messageId) {
    return dsl.select(
            EMAIL_MESSAGE.ID,
            EMAIL_MESSAGE.ACCOUNT_ID,
            EMAIL_MESSAGE.IMAP_UID,
            EMAIL_FOLDER.NAME,
            EMAIL_MESSAGE.BODY_FETCHED_AT)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .and(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
        .fetchOptional(this::toBodyTarget);
  }

  /** Record → BodyTarget. imap_uid null→0L, body_fetched_at null→null else Instant. */
  private BodyTarget toBodyTarget(Record r) {
    Long uid = r.get(EMAIL_MESSAGE.IMAP_UID);
    OffsetDateTime fetched = r.get(EMAIL_MESSAGE.BODY_FETCHED_AT);
    return new BodyTarget(
        r.get(EMAIL_MESSAGE.ID),
        r.get(EMAIL_MESSAGE.ACCOUNT_ID),
        uid == null ? 0L : uid,
        r.get(EMAIL_FOLDER.NAME),
        fetched == null ? null : fetched.toInstant());
  }

  /** AI 요약/답장용 컨텍스트(계정 ai_enabled·본인 이메일 + 메시지 본문/요약). 소유 검증 포함. */
  public Optional<AiContext> findAiContextByIdAndUser(long userId, long messageId) {
    return dsl.select(
            EMAIL_ACCOUNT.AI_ENABLED,
            EMAIL_ACCOUNT.EMAIL_ADDRESS,
            EMAIL_MESSAGE.SUBJECT,
            EMAIL_MESSAGE.FROM_ADDRESS,
            EMAIL_MESSAGE.BODY_TEXT,
            EMAIL_MESSAGE.BODY_HTML,
            EMAIL_MESSAGE.AI_SUMMARY)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .fetchOptional(
            r ->
                new AiContext(
                    Boolean.TRUE.equals(r.get(EMAIL_ACCOUNT.AI_ENABLED)),
                    r.get(EMAIL_ACCOUNT.EMAIL_ADDRESS),
                    r.get(EMAIL_MESSAGE.SUBJECT),
                    r.get(EMAIL_MESSAGE.FROM_ADDRESS),
                    r.get(EMAIL_MESSAGE.BODY_TEXT),
                    r.get(EMAIL_MESSAGE.BODY_HTML),
                    r.get(EMAIL_MESSAGE.AI_SUMMARY)));
  }

  /** 메시지가 속한 스레드 전체(시간순) — 답장 초안 컨텍스트. 소유 검증 포함. */
  public List<MailAiMessages.ThreadMessage> findThreadByIdAndUser(long userId, long messageId) {
    String threadId =
        dsl.select(EMAIL_MESSAGE.THREAD_ID)
            .from(EMAIL_MESSAGE)
            .join(EMAIL_ACCOUNT)
            .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
            .where(EMAIL_MESSAGE.ID.eq(messageId))
            .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
            .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
            .fetchOne(EMAIL_MESSAGE.THREAD_ID);
    if (threadId == null) {
      return List.of();
    }
    return dsl.select(
            EMAIL_MESSAGE.FROM_ADDRESS, EMAIL_MESSAGE.RECEIVED_AT, EMAIL_MESSAGE.BODY_TEXT)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
        .where(EMAIL_MESSAGE.THREAD_ID.eq(threadId))
        .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .orderBy(EMAIL_MESSAGE.RECEIVED_AT.asc().nullsFirst(), EMAIL_MESSAGE.ID.asc())
        .fetch(
            r ->
                new MailAiMessages.ThreadMessage(
                    r.get(EMAIL_MESSAGE.FROM_ADDRESS),
                    r.get(EMAIL_MESSAGE.RECEIVED_AT) == null
                        ? ""
                        : r.get(EMAIL_MESSAGE.RECEIVED_AT).toString(),
                    r.get(EMAIL_MESSAGE.BODY_TEXT) == null ? "" : r.get(EMAIL_MESSAGE.BODY_TEXT)));
  }

  /**
   * 분류 입력 컨텍스트(subject/from/snippet) 조회. 본문 적재 후 messageId 로 분류할 때 사용. 소유 검증을 위해 email_account 와
   * 조인해 account.user_id = userId 인 경우만 반환.
   */
  public Optional<ClassifyContext> findClassifyContextByIdAndUser(long userId, long messageId) {
    return dsl.select(EMAIL_MESSAGE.SUBJECT, EMAIL_MESSAGE.FROM_ADDRESS, EMAIL_MESSAGE.SNIPPET)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .fetchOptional(
            r ->
                new ClassifyContext(
                    r.get(EMAIL_MESSAGE.SUBJECT),
                    r.get(EMAIL_MESSAGE.FROM_ADDRESS),
                    r.get(EMAIL_MESSAGE.SNIPPET)));
  }

  /** 분류 입력 행(제목/보낸사람/미리보기). */
  public record ClassifyContext(String subject, String fromAddress, String snippet) {}

  /** AI 컨텍스트 행. */
  public record AiContext(
      boolean aiEnabled,
      String selfAddress,
      String subject,
      String fromAddress,
      String bodyText,
      String bodyHtml,
      String summary) {}

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
        Boolean.TRUE.equals(r.get(EMAIL_MESSAGE.HAS_ATTACHMENT)),
        r.get(EMAIL_MESSAGE.AI_CATEGORY),
        r.get(EMAIL_MESSAGE.AI_NEEDS_REPLY));
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
        r.get(EMAIL_MESSAGE.BCC_ADDRESSES),
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
        d.bccAddresses(),
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
