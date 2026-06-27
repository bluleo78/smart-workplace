package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.EmailAttachmentMeta;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.dto.ReadSyncLocator;
import com.workplace.mail.dto.ReplyContext;
import com.workplace.mail.outbound.MailAiMessages;
import com.workplace.mail.util.MailBodyText;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * email_message jOOQ 리포지토리. 목록/검색은 account 스코프, 상세는 소유 검증을 위해 email_account 와 조인한다. 첨부 메타는 message
 * 의 자식이라 상세 조립 시 함께 읽는다.
 */
@Repository
@RequiredArgsConstructor
public class EmailMessageRepository {

  private final DSLContext dsl;

  /** email_content 공유 저장소 — sync 단계에서 envelope 에 content_id 를 연결할 때 사용한다. */
  private final EmailContentRepository contentRepo;

  /** UIDVALIDITY 변경 시 폴더의 기존 메시지를 모두 삭제(서버가 UID 를 재사용하므로 stale 충돌 방지). */
  public void deleteByFolder(long folderId) {
    // envelope 삭제 전 영향받을 content_id 를 수집 — FK ON DELETE RESTRICT 이므로 envelope 먼저 삭제한 뒤 GC
    List<Long> affectedContentIds =
        dsl.selectDistinct(EMAIL_MESSAGE.CONTENT_ID)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.FOLDER_ID.eq(folderId))
            .and(EMAIL_MESSAGE.CONTENT_ID.isNotNull())
            .fetchInto(Long.class);

    dsl.deleteFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.FOLDER_ID.eq(folderId)).execute();

    // 마지막 envelope 가 사라진 content 만 삭제(다른 envelope 가 참조 중이면 유지)
    contentRepo.deleteOrphans(affectedContentIds);
  }

  /**
   * 파싱된 메시지를 저장. (account_id, folder_id, imap_uid) 유니크 충돌 시 무시(재동기화 멱등성). 새로 삽입되면 생성 id 를, 이미 있으면
   * empty 를 반환한다.
   */
  public Optional<Long> insertIgnoreConflict(long accountId, long folderId, ParsedMessage m) {
    // 현재 GUC 와 일치하는 테넌트 ID 로 email_content 를 공유 생성(find-or-create).
    // TenantContext.get() 은 TenantAwareTransactionManager 가 GUC 로 주입한 값과 동일하다.
    long tenantId = requireTenantId();
    long contentId = contentRepo.findOrCreate(tenantId, m);
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
        // subject 는 email_content.subject 에 저장(Task9: envelope 중복 제거)
        .set(EMAIL_MESSAGE.SENT_AT, toOffset(m.sentAt()))
        .set(EMAIL_MESSAGE.RECEIVED_AT, toOffset(m.receivedAt()))
        .set(EMAIL_MESSAGE.SEEN, m.seen())
        .set(EMAIL_MESSAGE.HAS_ATTACHMENT, m.hasAttachment())
        .set(EMAIL_MESSAGE.CONTENT_ID, contentId)
        .onConflictDoNothing()
        .returning(EMAIL_MESSAGE.ID)
        .fetchOptional()
        .map(r -> r.get(EMAIL_MESSAGE.ID));
  }

  /**
   * Graph provider_message_id 키로 메시지를 UPSERT 한다.
   *
   * <p>부분 유니크 {@code (account_id, provider_message_id) WHERE provider_message_id IS NOT NULL} 충돌 시
   * NO-OP(멱등). 슬라이스1: read-state delta(isRead 변경 등) 갱신은 미구현 — 충돌 시 DO NOTHING 으로 첫 삽입만 유효.
   *
   * <p>imapUid 는 Graph 계정에서 사용하지 않으므로 null 저장(IMAP 분기와 구별).
   *
   * @param accountId 계정 id
   * @param folderId 폴더 id
   * @param m 매핑된 ParsedMessage(imapUid 는 무시됨)
   * @param providerMessageId Graph 메시지 id
   * @return 신규 삽입이면 true, 이미 존재(충돌 무시)하면 false
   */
  public boolean upsertByProviderId(
      long accountId, long folderId, ParsedMessage m, String providerMessageId) {
    // Graph 경로도 동일하게 email_content 공유(find-or-create).
    long tenantId = requireTenantId();
    long contentId = contentRepo.findOrCreate(tenantId, m);
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.IMAP_UID, (Long) null) // Graph 계정: IMAP UID 없음
        .set(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID, providerMessageId)
        .set(EMAIL_MESSAGE.MESSAGE_ID, m.messageId())
        .set(EMAIL_MESSAGE.THREAD_ID, m.threadId())
        .set(EMAIL_MESSAGE.IN_REPLY_TO, m.inReplyTo())
        .set(EMAIL_MESSAGE.MAIL_REFERENCES, m.references())
        .set(EMAIL_MESSAGE.FROM_ADDRESS, m.fromAddress())
        .set(EMAIL_MESSAGE.FROM_NAME, m.fromName())
        .set(EMAIL_MESSAGE.TO_ADDRESSES, m.toAddresses())
        .set(EMAIL_MESSAGE.CC_ADDRESSES, m.ccAddresses())
        // subject 는 email_content.subject 에 저장(Task9: envelope 중복 제거)
        .set(EMAIL_MESSAGE.SENT_AT, toOffset(m.sentAt()))
        .set(EMAIL_MESSAGE.RECEIVED_AT, toOffset(m.receivedAt()))
        .set(EMAIL_MESSAGE.SEEN, m.seen())
        .set(EMAIL_MESSAGE.HAS_ATTACHMENT, m.hasAttachment())
        .set(EMAIL_MESSAGE.CONTENT_ID, contentId)
        .onConflictDoNothing()
        .returning(EMAIL_MESSAGE.ID)
        .fetchOptional()
        .isPresent();
  }

  /**
   * Graph provider_message_id 로 메시지를 삭제한다.
   *
   * <p>Graph delta 에서 {@code @removed} 마커가 있는 항목을 DB 에서 제거한다. 이미 없는 경우(멱등) 무시한다.
   *
   * @param accountId 계정 id(타 계정 메시지 차단)
   * @param providerMessageId 삭제할 Graph 메시지 id
   */
  public void deleteByProviderId(long accountId, String providerMessageId) {
    // envelope 삭제 전 영향받을 content_id 를 수집
    List<Long> affectedContentIds =
        dsl.selectDistinct(EMAIL_MESSAGE.CONTENT_ID)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
            .and(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID.eq(providerMessageId))
            .and(EMAIL_MESSAGE.CONTENT_ID.isNotNull())
            .fetchInto(Long.class);

    dsl.deleteFrom(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID.eq(providerMessageId))
        .execute();

    // 마지막 envelope 가 사라진 content 만 삭제
    contentRepo.deleteOrphans(affectedContentIds);
  }

  /**
   * 테스트용 — provider_message_id 로 메시지 id(PK)를 조회한다.
   *
   * <p>fetchNewMessages_appliesDeltaAndRemovals 에서 G1/G2 존재 여부를 단언할 때 사용.
   *
   * @param accountId 계정 id
   * @param providerMessageId Graph 메시지 id
   * @return 존재하면 메시지 PK, 없으면 empty
   */
  public Optional<Long> findByProviderId(long accountId, String providerMessageId) {
    return dsl.select(EMAIL_MESSAGE.ID)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID.eq(providerMessageId))
        .fetchOptional(EMAIL_MESSAGE.ID);
  }

  /** 기존 호출 호환(받은편지함). 폴더 미지정은 INBOX 로 스코프. */
  public List<EmailMessageSummary> listByAccount(long accountId, String query, int limit) {
    return listByAccount(accountId, "INBOX", query, limit);
  }

  /** 기존 호출 호환 — unread 필터 없이(모든 메일) 조회. */
  public List<EmailMessageSummary> listByAccount(
      long accountId, String folderName, String query, int limit) {
    return listByAccount(accountId, folderName, query, false, limit);
  }

  /** 기존 5-arg → 신규 7-arg 위임(하위호환). */
  public List<EmailMessageSummary> listByAccount(
      long accountId, String folderName, String query, boolean unreadOnly, int limit) {
    return listByAccount(accountId, folderName, query, unreadOnly, null, false, limit);
  }

  /**
   * P2: 계정 + 폴더 스코프 목록(최신순, 본문 제외). category/needsReply 필터 추가. 회신필요는 통일 술어(ai_needs_reply IS TRUE
   * AND done_at IS NULL). query 가 있으면 제목/보낸사람/스니펫 부분일치. unreadOnly=true 면 seen=false(안 읽은) 메일만
   * 반환한다. 소유 검증은 호출 측에서 수행.
   *
   * <p>Task6: subject·snippet SELECT 를 email_content 로 전환. 검색 WHERE 는 Task8 에서 전환(현재 email_message
   * 컬럼 유지).
   */
  public List<EmailMessageSummary> listByAccount(
      long accountId,
      String folderName,
      String query,
      boolean unreadOnly,
      String category,
      boolean needsReply,
      int limit) {
    Condition where = EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId).and(EMAIL_FOLDER.NAME.eq(folderName));
    if (unreadOnly) {
      where = where.and(EMAIL_MESSAGE.SEEN.isFalse());
    }
    if (category != null && !category.isBlank()) {
      where = where.and(EMAIL_MESSAGE.AI_CATEGORY.eq(category));
    }
    if (needsReply) {
      // 회신필요 통일 술어: AI 판정=true + 사용자 처리완료 아님
      where =
          where
              .and(EMAIL_MESSAGE.AI_NEEDS_REPLY.isTrue())
              .and(EMAIL_MESSAGE.NEEDS_REPLY_DONE_AT.isNull());
    }
    if (query != null && !query.isBlank()) {
      // Task8: email_content.search_tv(tsvector) 를 FTS 로 검색.
      // 'simple' 토크나이저는 공백 분리 + 소문자화만 수행(한국어 형태소 미지원, 영문·고유명사 단어 일치).
      // plainto_tsquery 는 & 연산자로 단어 연결 — 인젝션 방지를 위해 파라미터 바인딩({0}) 사용.
      // 발신자(from_address/from_name) 검색은 LIKE 로 보존(FTS 토크나이저가 이메일 주소를 토큰 분리하지 않아
      // "user@domain.com" 같은 패턴은 FTS 로 매칭이 불가함).
      String q = query.trim();
      String like = "%" + q + "%";
      Condition ftsCond =
          DSL.condition("email_content.search_tv @@ plainto_tsquery('simple', {0})", q);
      Condition envelopeCond =
          EMAIL_MESSAGE
              .FROM_ADDRESS
              .likeIgnoreCase(like)
              .or(EMAIL_MESSAGE.FROM_NAME.likeIgnoreCase(like));
      where = where.and(ftsCond.or(envelopeCond));
    }
    return dsl.select(
            EMAIL_MESSAGE.ID,
            EMAIL_MESSAGE.ACCOUNT_ID,
            EMAIL_MESSAGE.THREAD_ID,
            EMAIL_MESSAGE.FROM_ADDRESS,
            EMAIL_MESSAGE.FROM_NAME,
            EMAIL_CONTENT.SUBJECT, // content 에서 읽음
            EMAIL_CONTENT.SNIPPET, // content 에서 읽음
            EMAIL_MESSAGE.RECEIVED_AT,
            EMAIL_MESSAGE.SEEN,
            EMAIL_MESSAGE.HAS_ATTACHMENT,
            EMAIL_MESSAGE.AI_CATEGORY,
            EMAIL_MESSAGE.AI_NEEDS_REPLY,
            EMAIL_MESSAGE.NEEDS_REPLY_DONE_AT) // P2
        .from(EMAIL_MESSAGE)
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .leftJoin(EMAIL_CONTENT) // subject·snippet 을 content 에서 읽기 위한 LEFT JOIN
        .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .where(where)
        .orderBy(EMAIL_MESSAGE.RECEIVED_AT.desc().nullsLast(), EMAIL_MESSAGE.ID.desc())
        .limit(limit)
        .fetch(this::toSummary);
  }

  /**
   * 홈 위젯용 — 사용자 본인 INBOX 의 안읽은 메일 건수. 소유 검증을 위해 email_account 와 조인(user_id = callerId, 비활성 제외)하고,
   * INBOX 스코프를 위해 email_folder 와 조인(folder.name = 'INBOX')한다. seen = false 만 집계.
   */
  public long countUnread(long callerId) {
    return dsl.fetchCount(
        dsl.selectOne()
            .from(EMAIL_MESSAGE)
            .join(EMAIL_ACCOUNT)
            .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
            .join(EMAIL_FOLDER)
            .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
            .where(EMAIL_ACCOUNT.USER_ID.eq(callerId))
            .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
            .and(EMAIL_FOLDER.NAME.eq("INBOX"))
            .and(EMAIL_MESSAGE.SEEN.isFalse()));
  }

  /**
   * 홈 위젯용 — 사용자 본인 INBOX 의 "회신 필요" 메일 건수(#474).
   *
   * <p>countUnread 와 동일한 소유·INBOX·seen=false 조건에 {@code ai_needs_reply = true} 를 추가한다.
   * pending(null) 과 false 는 제외된다 — isTrue() 가 null-safe FALSE 처리를 포함한다.
   */
  public long countNeedsReply(long callerId) {
    return dsl.fetchCount(
        dsl.selectOne()
            .from(EMAIL_MESSAGE)
            .join(EMAIL_ACCOUNT)
            .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
            .join(EMAIL_FOLDER)
            .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
            .where(EMAIL_ACCOUNT.USER_ID.eq(callerId))
            .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
            .and(EMAIL_FOLDER.NAME.eq("INBOX"))
            .and(EMAIL_MESSAGE.SEEN.isFalse())
            .and(EMAIL_MESSAGE.AI_NEEDS_REPLY.isTrue())
            .and(EMAIL_MESSAGE.NEEDS_REPLY_DONE_AT.isNull())); // P2: 처리완료 제외(통일 술어)
  }

  /**
   * 홈 위젯용 — 사용자 본인 INBOX 의 최근 안읽은 메일 N건(최신순). countUnread 와 동일한 소유·INBOX·seen=false 필터를 쓰고,
   * listByAccount 의 select 컬럼/정렬/매퍼(toSummary)를 그대로 재사용해 DTO 를 동일하게 만든다.
   *
   * <p>Task6: subject·snippet 을 email_content LEFT JOIN 으로 읽는다.
   */
  public List<EmailMessageSummary> listRecentUnread(long callerId, int limit) {
    return dsl.select(
            EMAIL_MESSAGE.ID,
            EMAIL_MESSAGE.ACCOUNT_ID,
            EMAIL_MESSAGE.THREAD_ID,
            EMAIL_MESSAGE.FROM_ADDRESS,
            EMAIL_MESSAGE.FROM_NAME,
            EMAIL_CONTENT.SUBJECT, // content 에서 읽음
            EMAIL_CONTENT.SNIPPET, // content 에서 읽음
            EMAIL_MESSAGE.RECEIVED_AT,
            EMAIL_MESSAGE.SEEN,
            EMAIL_MESSAGE.HAS_ATTACHMENT,
            EMAIL_MESSAGE.AI_CATEGORY,
            EMAIL_MESSAGE.AI_NEEDS_REPLY,
            EMAIL_MESSAGE.NEEDS_REPLY_DONE_AT) // P2: toSummary 매퍼에서 필요
        .from(EMAIL_MESSAGE)
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .leftJoin(EMAIL_CONTENT) // subject·snippet 을 content 에서 읽기 위한 LEFT JOIN
        .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .where(EMAIL_ACCOUNT.USER_ID.eq(callerId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .and(EMAIL_FOLDER.NAME.eq("INBOX"))
        .and(EMAIL_MESSAGE.SEEN.isFalse())
        // 회신필요(aiNeedsReply=true) 우선 → 최신순. 적은 회신필요 메일이 항상 상위 N 에 끼게 해
        // 홈 위젯/필터가 전역 needsReplyCount 와 어긋나지 않도록 한다(분류 off 면 전부 null → 최신순).
        .orderBy(
            EMAIL_MESSAGE.AI_NEEDS_REPLY.desc().nullsLast(),
            EMAIL_MESSAGE.RECEIVED_AT.desc().nullsLast(),
            EMAIL_MESSAGE.ID.desc())
        .limit(limit)
        .fetch(this::toSummary);
  }

  /**
   * 로컬에서 작성한 보낸메일 1건 저장(imap_uid=NULL, seen=true). 생성된 id 반환.
   *
   * <p>본문은 envelope 에 직접 저장하지 않고 email_content 에 기록한 뒤 content_id 로 연결한다(수신 sync 경로와 동일). 보낸메일은 전송
   * 시점에 본문이 확정되므로 findOrCreate 직후 updateBody 를 호출해 즉시 적재한다.
   */
  public long insertSent(long accountId, long folderId, OutgoingMail m) {
    Instant sentAt = m.sentAt();

    // 보낸메일용 ParsedMessage: imapUid=0(사용하지 않음), 첨부 빈 목록
    // threadId 는 OutgoingMail 에서 이미 설정된 값 사용(null 가능 — content 는 허용)
    ParsedMessage sentAsMsg =
        new ParsedMessage(
            0L,
            m.messageId(),
            m.threadId() != null ? m.threadId() : "sent:" + m.messageId(),
            m.inReplyTo(),
            m.references(),
            m.fromAddress(),
            m.fromName(),
            joinOrNull(m.to()),
            joinOrNull(m.cc()),
            m.subject(),
            sentAt,
            sentAt,
            true,
            false,
            null, // 본문은 아래 updateBody 로 적재
            null,
            null,
            List.of());

    // email_content find-or-create + 본문 즉시 적재(보낸메일은 전송 시점에 본문 확정)
    long tenantId = requireTenantId();
    long contentId = contentRepo.findOrCreate(tenantId, sentAsMsg);
    contentRepo.updateBody(contentId, m.bodyText(), m.bodyHtml(), m.snippet());

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
        // subject 는 email_content.subject 에 저장(Task9: envelope 중복 제거)
        .set(EMAIL_MESSAGE.SENT_AT, toOffset(sentAt))
        .set(EMAIL_MESSAGE.RECEIVED_AT, toOffset(sentAt))
        .set(EMAIL_MESSAGE.SEEN, true)
        .set(EMAIL_MESSAGE.HAS_ATTACHMENT, false)
        .set(EMAIL_MESSAGE.CONTENT_ID, contentId)
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
   *
   * <p>Task5(부분 Task6): 본문은 email_content LEFT JOIN 으로 읽는다 — lazy fetch 이후
   * email_message.body_text/html 이 미설정된 경우에도 content 에서 올바른 본문을 반환한다. Task6 에서 나머지 reader 도 동일하게
   * 마이그레이션 예정.
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
                EMAIL_CONTENT.SUBJECT, // subject 는 email_content 에서 읽음(Task9)
                EMAIL_MESSAGE.SENT_AT,
                EMAIL_MESSAGE.RECEIVED_AT,
                EMAIL_MESSAGE.SEEN,
                EMAIL_CONTENT.BODY_TEXT,
                EMAIL_CONTENT.BODY_HTML)
            .from(EMAIL_MESSAGE)
            .join(EMAIL_ACCOUNT)
            .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
            .leftJoin(EMAIL_CONTENT)
            .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
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

  /**
   * per-envelope 본문 적재 완료 마커(V97). 이 envelope 의 본문/첨부 적재가 완료됐음을 기록한다. 공유
   * email_content.body_fetched_at 과 분리된 per-envelope 게이트로, 같은 message_id 를 수신한 다른 수신자의 fetch 가 이
   * envelope 를 건너뛰지 않도록 보장한다.
   */
  public void markFetched(long messageId) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.FETCHED_AT, OffsetDateTime.now())
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .execute();
  }

  /**
   * 읽음 역동기화 식별자 조회(테넌트 RLS 스코프).
   *
   * <p>email_message → email_account(provider) → email_folder(name) 조인으로 역동기화에 필요한 식별자를 한 번에 조회한다.
   *
   * @param messageId 메시지 id
   * @return 역동기화 식별자; 메시지가 없으면 empty
   */
  public Optional<ReadSyncLocator> findReadSyncLocator(long messageId) {
    return dsl.select(
            EMAIL_MESSAGE.ACCOUNT_ID,
            EMAIL_ACCOUNT.PROVIDER,
            EMAIL_MESSAGE.PROVIDER_MESSAGE_ID,
            EMAIL_MESSAGE.IMAP_UID,
            EMAIL_FOLDER.NAME)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .fetchOptional(
            r ->
                new ReadSyncLocator(
                    r.value1(),
                    MailProvider.valueOf(r.value2()),
                    r.value3(),
                    r.value4(),
                    r.value5()));
  }

  /** 메시지 읽음 처리 — seen=true 로 업데이트. 이미 읽은 건은 스킵(SEEN.isFalse 조건). */
  public void markSeen(long messageId) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.SEEN, true)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .and(EMAIL_MESSAGE.SEEN.isFalse())
        .execute();
  }

  /** 분류 결과 저장(동기화 잡, best-effort). */
  public void updateClassification(long messageId, String category, boolean needsReply) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.AI_CATEGORY, category)
        .set(EMAIL_MESSAGE.AI_NEEDS_REPLY, needsReply)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .execute();
  }

  /** P2: 회신필요 처리완료(해결) 마커 기록. 계정 소유 스코프(account_id)로 타 계정 메시지 차단. 반환값=갱신된 행 수(1=성공, 0=미존재). */
  public int markNeedsReplyDone(long messageId, long accountId) {
    return dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.NEEDS_REPLY_DONE_AT, OffsetDateTime.now())
        .where(EMAIL_MESSAGE.ID.eq(messageId).and(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId)))
        .execute();
  }

  /** P2: 처리완료 되돌리기. done_at 을 null 로. 반환값=갱신된 행 수(1=성공, 0=미존재). */
  public int clearNeedsReplyDone(long messageId, long accountId) {
    return dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.NEEDS_REPLY_DONE_AT, (OffsetDateTime) null)
        .where(EMAIL_MESSAGE.ID.eq(messageId).and(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId)))
        .execute();
  }

  /** P2: 사이드바용 — 특정 계정 INBOX 의 미처리 회신필요 건수. 목록 필터(needsReply)와 일치해야 하므로 seen 무관(seen 축 제외). */
  public long countNeedsReplyForAccount(long accountId) {
    return dsl.fetchCount(
        dsl.selectOne()
            .from(EMAIL_MESSAGE)
            .join(EMAIL_FOLDER)
            .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
            .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
            .and(EMAIL_FOLDER.NAME.eq("INBOX"))
            .and(EMAIL_MESSAGE.AI_NEEDS_REPLY.isTrue())
            .and(EMAIL_MESSAGE.NEEDS_REPLY_DONE_AT.isNull()));
  }

  /** 요약 캐시 저장. */
  public void updateSummary(long messageId, String summary) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.AI_SUMMARY, summary)
        .set(EMAIL_MESSAGE.AI_SUMMARIZED_AT, OffsetDateTime.now())
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .execute();
  }

  /**
   * 첨부플래그(has_attachment)만 envelope 에 기록한다. Task5 이후 본문·스니펫은 email_content 에 저장하고, 첨부 존재 여부만
   * envelope 속성으로 남긴다(수신자별로 동일 메일도 첨부 보기 상태가 다를 수 있으므로 envelope 컬럼 유지).
   */
  public void markHasAttachment(long messageId, boolean hasAttachment) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.HAS_ATTACHMENT, hasAttachment)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .execute();
  }

  /** 선제 배치 요약 대상 — INBOX 안읽음 중 미요약(ai_summary IS NULL) 최근 limit건. */
  public List<Long> listRecentUnreadUnsummarizedIds(long accountId, int limit) {
    return dsl.select(EMAIL_MESSAGE.ID)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_FOLDER.NAME.eq("INBOX"))
        .and(EMAIL_MESSAGE.SEEN.isFalse())
        .and(EMAIL_MESSAGE.AI_SUMMARY.isNull())
        .orderBy(EMAIL_MESSAGE.RECEIVED_AT.desc().nullsLast(), EMAIL_MESSAGE.ID.desc())
        .limit(limit)
        .fetch(EMAIL_MESSAGE.ID);
  }

  /**
   * classify 백필용 — 계정의 최근 안읽은·미분류(ai_needs_reply IS NULL) INBOX 메일 id N건(최신순). 본문 유무는 가리지 않는다(분류는
   * subject/from/snippet 으로 best-effort 동작).
   */
  public List<Long> listRecentUnreadUnclassifiedIds(long accountId, int limit) {
    return dsl.select(EMAIL_MESSAGE.ID)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_FOLDER.NAME.eq("INBOX"))
        .and(EMAIL_MESSAGE.SEEN.isFalse())
        .and(EMAIL_MESSAGE.AI_NEEDS_REPLY.isNull())
        .orderBy(EMAIL_MESSAGE.RECEIVED_AT.desc().nullsLast(), EMAIL_MESSAGE.ID.desc())
        .limit(limit)
        .fetch(EMAIL_MESSAGE.ID);
  }

  /**
   * 본문 미적재 대상(account 별, 최근순). imap_uid 없는 로컬 보낸메일 제외.
   *
   * <p>IMAP 계정: imap_uid IS NOT NULL 조건으로 필터. Graph 계정: provider_message_id 가 있으므로 포함.
   *
   * <p>V97(per-envelope): 미적재 판정을 email_message.fetched_at IS NULL 기준으로 변경. content.body_fetched_at
   * 이 설정된 경우에도 이 envelope 의 fetched_at 이 NULL 이면 재적재 대상이 된다 — 같은 message_id 를 수신한 두 번째 수신자도 자신의 첨부
   * 행을 생성할 수 있도록 보장한다(공유 콘텐츠 첨부 누락 회귀 수정).
   */
  public List<BodyTarget> listMissingBody(long accountId, int limit) {
    return dsl.select(
            EMAIL_MESSAGE.ID,
            EMAIL_MESSAGE.ACCOUNT_ID,
            EMAIL_MESSAGE.IMAP_UID,
            EMAIL_FOLDER.NAME,
            EMAIL_MESSAGE.FETCHED_AT, // V97: per-envelope 마커로 전환
            EMAIL_MESSAGE.PROVIDER_MESSAGE_ID,
            EMAIL_MESSAGE.CONTENT_ID)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .leftJoin(EMAIL_CONTENT)
        .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_MESSAGE.FETCHED_AT.isNull()) // V97: per-envelope 게이트
        .and(EMAIL_MESSAGE.IMAP_UID.isNotNull().or(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID.isNotNull()))
        .orderBy(EMAIL_MESSAGE.RECEIVED_AT.desc().nullsLast())
        .limit(limit)
        .fetch(this::toBodyTarget);
  }

  /**
   * 본문 미적재 건수(account 별). 진행률 total 산정용.
   *
   * <p>IMAP(imap_uid) 과 Graph(provider_message_id) 메시지를 모두 포함한다 — listMissingBody 와 동일 조건.
   *
   * <p>V97(per-envelope): email_message.fetched_at IS NULL 기준으로 전환(listMissingBody 와 일치).
   */
  public int countMissingBody(long accountId) {
    return dsl.fetchCount(
        dsl.select(EMAIL_MESSAGE.ID)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
            .and(EMAIL_MESSAGE.FETCHED_AT.isNull()) // V97: per-envelope 게이트
            .and(
                EMAIL_MESSAGE
                    .IMAP_UID
                    .isNotNull()
                    .or(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID.isNotNull())));
  }

  /**
   * 단건 본문 적재 대상 조회(account 기준 — 호출 측에서 소유 검증 선행).
   *
   * <p>V97(per-envelope): email_message.fetched_at 을 BodyTarget.bodyFetchedAt 으로 노출한다. content 는
   * contentId 조회용 LEFT JOIN 으로만 사용한다. fetched_at != null 이면 이 envelope 는 이미 적재됨.
   */
  public Optional<BodyTarget> findBodyTarget(long accountId, long messageId) {
    return dsl.select(
            EMAIL_MESSAGE.ID,
            EMAIL_MESSAGE.ACCOUNT_ID,
            EMAIL_MESSAGE.IMAP_UID,
            EMAIL_FOLDER.NAME,
            EMAIL_MESSAGE.FETCHED_AT, // V97: per-envelope 마커
            EMAIL_MESSAGE.PROVIDER_MESSAGE_ID,
            EMAIL_MESSAGE.CONTENT_ID)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .leftJoin(EMAIL_CONTENT)
        .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .and(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
        .fetchOptional(this::toBodyTarget);
  }

  /**
   * 단건 본문 적재 대상 조회(messageId 기준 + 소유 검증). EMAIL_ACCOUNT 조인으로 account.user_id = userId 인 경우만 반환한다(상세
   * 열람 OnDemand 적재용). 폴더명은 EMAIL_FOLDER 조인에서 얻는다.
   *
   * <p>V97(per-envelope): email_message.fetched_at 을 BodyTarget.bodyFetchedAt 으로 노출한다.
   */
  public Optional<BodyTarget> findBodyTargetForUser(long userId, long messageId) {
    return dsl.select(
            EMAIL_MESSAGE.ID,
            EMAIL_MESSAGE.ACCOUNT_ID,
            EMAIL_MESSAGE.IMAP_UID,
            EMAIL_FOLDER.NAME,
            EMAIL_MESSAGE.FETCHED_AT, // V97: per-envelope 마커
            EMAIL_MESSAGE.PROVIDER_MESSAGE_ID,
            EMAIL_MESSAGE.CONTENT_ID)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
        .leftJoin(EMAIL_CONTENT)
        .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .fetchOptional(this::toBodyTarget);
  }

  /**
   * Record → BodyTarget. imap_uid null→0L.
   *
   * <p>V97(per-envelope): bodyFetchedAt 은 email_message.fetched_at 으로 전환.
   * email_content.body_fetched_at 이 설정되어도 이 envelope 의 fetched_at 이 NULL 이면 재적재 대상이 된다.
   *
   * <p>PROVIDER_MESSAGE_ID: Graph 계정의 메시지 ID. IMAP 계정은 null.
   *
   * <p>contentId: email_message.content_id null→0L. 0 이면 로더가 false 반환(content 미연결 메시지 재시도 불가 방지).
   */
  private BodyTarget toBodyTarget(Record r) {
    Long uid = r.get(EMAIL_MESSAGE.IMAP_UID);
    // V97: 멱등 가드 기준을 email_message.fetched_at(per-envelope) 으로 전환
    OffsetDateTime fetched = r.get(EMAIL_MESSAGE.FETCHED_AT);
    Long contentId = r.get(EMAIL_MESSAGE.CONTENT_ID);
    return new BodyTarget(
        r.get(EMAIL_MESSAGE.ID),
        r.get(EMAIL_MESSAGE.ACCOUNT_ID),
        uid == null ? 0L : uid,
        r.get(EMAIL_FOLDER.NAME),
        fetched == null ? null : fetched.toInstant(),
        r.get(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID),
        contentId == null ? 0L : contentId);
  }

  /**
   * AI 요약/답장용 컨텍스트(계정 ai_enabled·본인 이메일 + 메시지 본문/요약). 소유 검증 포함.
   *
   * <p>Task6: 제목·본문은 email_content LEFT JOIN 으로 읽는다. FROM_ADDRESS·AI_SUMMARY 는 envelope 잔존(봉투 속성 /
   * Task② 이전).
   */
  public Optional<AiContext> findAiContextByIdAndUser(long userId, long messageId) {
    return dsl.select(
            EMAIL_ACCOUNT.AI_ENABLED,
            EMAIL_ACCOUNT.EMAIL_ADDRESS,
            EMAIL_CONTENT.SUBJECT, // content 에서 읽음
            EMAIL_MESSAGE.FROM_ADDRESS,
            EMAIL_CONTENT.BODY_TEXT, // content 에서 읽음
            EMAIL_CONTENT.BODY_HTML, // content 에서 읽음
            EMAIL_MESSAGE.AI_SUMMARY) // ai_summary 는 envelope 잔존(Task② 이전)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
        .leftJoin(EMAIL_CONTENT) // 본문·제목을 content 에서 읽기 위한 LEFT JOIN
        .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .fetchOptional(
            r ->
                new AiContext(
                    Boolean.TRUE.equals(r.get(EMAIL_ACCOUNT.AI_ENABLED)),
                    r.get(EMAIL_ACCOUNT.EMAIL_ADDRESS),
                    r.get(EMAIL_CONTENT.SUBJECT),
                    r.get(EMAIL_MESSAGE.FROM_ADDRESS),
                    r.get(EMAIL_CONTENT.BODY_TEXT),
                    r.get(EMAIL_CONTENT.BODY_HTML),
                    r.get(EMAIL_MESSAGE.AI_SUMMARY)));
  }

  /**
   * 메시지가 속한 스레드 전체(시간순) — 답장 초안 컨텍스트. 소유 검증 포함.
   *
   * <p>Task6: 스레드 멤버 본문은 email_content LEFT JOIN 으로 읽는다.
   */
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
            EMAIL_MESSAGE.FROM_ADDRESS,
            EMAIL_MESSAGE.RECEIVED_AT,
            EMAIL_CONTENT.BODY_TEXT, // content 에서 읽음
            EMAIL_CONTENT.BODY_HTML) // content 에서 읽음
        .from(EMAIL_MESSAGE)
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
        .leftJoin(EMAIL_CONTENT) // 본문을 content 에서 읽기 위한 LEFT JOIN
        .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
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
                    // HTML 전용 메일은 BODY_TEXT 가 비어 답장 초안이 본문 없이 호출되던 버그 — HTML 폴백으로 일원화.
                    MailBodyText.effectiveBody(
                        r.get(EMAIL_CONTENT.BODY_TEXT), r.get(EMAIL_CONTENT.BODY_HTML))));
  }

  /**
   * 분류 입력 컨텍스트(subject/from/snippet) 조회. 본문 적재 후 messageId 로 분류할 때 사용. 소유 검증을 위해 email_account 와
   * 조인해 account.user_id = userId 인 경우만 반환.
   *
   * <p>Task6: subject·snippet 은 email_content LEFT JOIN 으로 읽는다. FROM_ADDRESS 는 envelope 봉투 속성 유지.
   */
  public Optional<ClassifyContext> findClassifyContextByIdAndUser(long userId, long messageId) {
    return dsl.select(
            EMAIL_CONTENT.SUBJECT, // content 에서 읽음
            EMAIL_MESSAGE.FROM_ADDRESS,
            EMAIL_CONTENT.SNIPPET) // content 에서 읽음
        .from(EMAIL_MESSAGE)
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
        .leftJoin(EMAIL_CONTENT) // subject·snippet 을 content 에서 읽기 위한 LEFT JOIN
        .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .fetchOptional(
            r ->
                new ClassifyContext(
                    r.get(EMAIL_CONTENT.SUBJECT),
                    r.get(EMAIL_MESSAGE.FROM_ADDRESS),
                    r.get(EMAIL_CONTENT.SNIPPET)));
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

  /** Task6: subject·snippet 은 email_content 에서 읽는다(LEFT JOIN 후 호출). */
  private EmailMessageSummary toSummary(Record r) {
    OffsetDateTime received = r.get(EMAIL_MESSAGE.RECEIVED_AT);
    OffsetDateTime doneAt = r.get(EMAIL_MESSAGE.NEEDS_REPLY_DONE_AT); // P2
    return new EmailMessageSummary(
        r.get(EMAIL_MESSAGE.ID),
        r.get(EMAIL_MESSAGE.ACCOUNT_ID),
        r.get(EMAIL_MESSAGE.THREAD_ID),
        r.get(EMAIL_MESSAGE.FROM_ADDRESS),
        r.get(EMAIL_MESSAGE.FROM_NAME),
        r.get(EMAIL_CONTENT.SUBJECT), // content 에서 읽음
        r.get(EMAIL_CONTENT.SNIPPET), // content 에서 읽음
        received == null ? null : received.toInstant(),
        Boolean.TRUE.equals(r.get(EMAIL_MESSAGE.SEEN)),
        Boolean.TRUE.equals(r.get(EMAIL_MESSAGE.HAS_ATTACHMENT)),
        r.get(EMAIL_MESSAGE.AI_CATEGORY),
        r.get(EMAIL_MESSAGE.AI_NEEDS_REPLY),
        doneAt == null ? null : doneAt.toInstant()); // P2
  }

  /**
   * Record → EmailMessageDetail. 본문은 email_content 컬럼(Task5 이후: findDetailByIdAndUser 가 JOIN 으로
   * 읽어옴).
   */
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
        r.get(EMAIL_CONTENT.SUBJECT), // subject 는 email_content 에서 읽음(Task9)
        sent == null ? null : sent.toInstant(),
        received == null ? null : received.toInstant(),
        Boolean.TRUE.equals(r.get(EMAIL_MESSAGE.SEEN)),
        r.get(EMAIL_CONTENT.BODY_TEXT),
        r.get(EMAIL_CONTENT.BODY_HTML),
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

  /**
   * 현재 테넌트 ID 를 결정한다. 우선순위:
   *
   * <ol>
   *   <li>{@link TenantContext#get()} — 프로덕션/통합테스트에서 JwtAuthenticationFilter 가 설정한 값
   *   <li>현재 커넥션의 {@code app.tenant_id} GUC — 테스트 DB 의 {@code connection-init-sql} 로 세션 수준 고정
   * </ol>
   *
   * <p>두 경로 모두 실패하면 RLS fail-closed 방어를 위해 예외를 던진다.
   */
  private long requireTenantId() {
    Long id = TenantContext.get();
    if (id != null) return id;
    // 테스트 환경 fallback: 세션 수준 GUC(connection-init-sql)에서 읽음
    String raw = (String) dsl.fetchValue("SELECT current_setting('app.tenant_id', true)");
    if (raw == null || raw.isBlank()) {
      throw new IllegalStateException("app.tenant_id GUC 가 설정되지 않음 — sync 경로는 테넌트 tx 안에서 실행되어야 한다");
    }
    return Long.parseLong(raw);
  }

  private static OffsetDateTime toOffset(java.time.Instant instant) {
    return instant == null ? null : OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
  }
}
