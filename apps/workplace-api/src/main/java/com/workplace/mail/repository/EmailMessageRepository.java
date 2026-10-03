package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import com.workplace.global.tenant.TenantContext;
import com.workplace.jooq.tables.records.EmailMessageRecord;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.dto.ContentSource;
import com.workplace.mail.dto.EmailAttachmentMeta;
import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.OutgoingMail;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.dto.ReadSyncLocator;
import com.workplace.mail.dto.ReplyContext;
import com.workplace.mail.dto.SeenSyncItem;
import com.workplace.mail.outbound.MailAiMessages;
import com.workplace.mail.util.MailBodyText;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Record1;
import org.jooq.Select;
import org.jooq.UpdateSetMoreStep;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;
import org.springframework.util.StringUtils;

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

  /**
   * 회신필요 기간 — 받은 지 이 기간 안의 메일만 회신필요로 보고, 선제 분석(③ 원본·④ 개인)도 이 안에서만 한다. 오래된 메일에 "지금 답장 필요"를 붙이는 건 의미가
   * 없고, 기간이 없으면 백필이 안 읽은 옛 메일까지 최근순으로 끝없이 내려가 LLM 을 쓴다(WP-151 후속). 기간 밖 메일은 열람 시 요약 GET 이 온디맨드로
   * 분석한다.
   */
  public static final Duration NEEDS_REPLY_WINDOW = Duration.ofDays(2);

  /** 회신필요 기간 술어 — received_at 이 기간 안. 수신 시각이 없는 행은 제외한다. */
  public static Condition withinNeedsReplyWindow() {
    return EMAIL_MESSAGE.RECEIVED_AT.ge(OffsetDateTime.now().minus(NEEDS_REPLY_WINDOW));
  }

  /** {@link #withinNeedsReplyWindow()} 의 자바 쪽 판정 — 이미 읽어 온 행(요약 DTO·분석 컨텍스트)에 같은 기준을 적용한다. */
  public static boolean isWithinNeedsReplyWindow(OffsetDateTime receivedAt) {
    return receivedAt != null
        && !receivedAt.isBefore(OffsetDateTime.now().minus(NEEDS_REPLY_WINDOW));
  }

  /**
   * 회신필요 단일 술어(WP-146) — AI 판정 true + 안 읽음 + 회신필요 기간 안. 목록 필터·사이드바·홈 카운트가 모두 이 메서드만 써서 화면마다 기준이
   * 어긋나지 않게 한다(#485 드리프트 방지). pending(NULL)·false 는 isTrue() 가 제외한다.
   */
  public static Condition needsReplyCondition() {
    return EMAIL_MESSAGE
        .AI_NEEDS_REPLY
        .isTrue()
        .and(EMAIL_MESSAGE.SEEN.isFalse())
        .and(withinNeedsReplyWindow());
  }

  /** 업무 보기 분류 이름(WP-186). 웹 기본 보기가 이 값을 보낸다. */
  public static final String WORK_CATEGORY = "업무";

  /**
   * 업무 보기 술어(WP-186) — 업무로 분류됐거나, 아직 분류가 없거나, 본문 검증 전(공유 content 의 분류를 믿지 않음 — WP-130)인 메일. "분류가
   * 늦어지거나 AI 가 연결되지 않아도 새 메일이 기본 보기에서 사라지지 않게" 하는 단일 정의 — 목록·안 읽은 수·모두 읽음이 모두 이 메서드를 쓴다.
   */
  public static Condition workViewCondition() {
    return EMAIL_MESSAGE
        .FETCHED_AT
        .isNull()
        .or(EMAIL_CONTENT.AI_CATEGORY.isNull())
        .or(EMAIL_CONTENT.AI_CATEGORY.eq(WORK_CATEGORY));
  }

  /** 분류 카테고리 전체(표시 순서). 웹 types/mailMessage.ts MAIL_CATEGORIES 와 값·순서 일치 유지. */
  public static final List<String> CATEGORIES = List.of(WORK_CATEGORY, "개인", "알림", "프로모션", "뉴스레터");

  /**
   * 분류 보기 단일 술어(WP-186) — 업무는 {@link #workViewCondition()}, 그 외는 검증된 사본(fetched_at 필수 — WP-130: 검증
   * 전 envelope 로 공유 content 의 분류를 추론하지 못하게)의 해당 분류. 목록·안 읽은 수가 모두 이 메서드를 써서 숫자와 목록이 어긋나지 않게 한다.
   */
  public static Condition categoryViewCondition(String category) {
    return WORK_CATEGORY.equals(category)
        ? workViewCondition()
        : EMAIL_CONTENT.AI_CATEGORY.eq(category).and(EMAIL_MESSAGE.FETCHED_AT.isNotNull());
  }

  /**
   * "분류 전" 배지 여부(WP-186) — 본문 검증 전이거나, 분류가 없고 어떤 경로(③ 원본 분석·분류 일괄)로도 분류를 시도하지 않은 메일. 시도했는데 비어 있는
   * 메일은 false(영구 미분류 — 배지 없이 업무 보기에만 남음).
   */
  static Field<Boolean> categoryPendingField() {
    return DSL.field(
            EMAIL_MESSAGE
                .FETCHED_AT
                .isNull()
                .or(
                    EMAIL_CONTENT
                        .AI_CATEGORY
                        .isNull()
                        .and(EMAIL_CONTENT.AI_CATEGORIZED_AT.isNull())
                        .and(EMAIL_CONTENT.AI_SUMMARIZED_AT.isNull())))
        .as("category_pending");
  }

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
   * 공유 content 의 본문 유래 값(본문·스니펫·AI 요약/분류)은 이 envelope 가 자기 사본을 적재·검증한 뒤(fetched_at)에만 노출한다(WP-130).
   * 동기화 지문은 발신자가 정할 수 있는 헤더라, 검증 전에 공유 본문을 보여 주면 위조 메일로 다른 사람 본문을 열람할 수 있다. 별칭을 원래 컬럼명으로 둬 {@code
   * r.get(EMAIL_CONTENT.X)} 조회를 그대로 쓴다.
   */
  private static <T> Field<T> verified(Field<T> contentField) {
    return DSL.when(EMAIL_MESSAGE.FETCHED_AT.isNotNull(), contentField).as(contentField.getName());
  }

  /**
   * 파싱된 메시지를 저장. (account_id, folder_id, imap_uid) 유니크 충돌 시 무시(재동기화 멱등성). 새로 삽입되면 생성 id 를, 이미 있으면
   * empty 를 반환한다.
   */
  public Optional<Long> insertIgnoreConflict(long accountId, long folderId, ParsedMessage m) {
    // 이미 있는 envelope(재동기화)면 content 를 만들지 않는다 — 지문 없는 content 는 매번 새 행이 생겨 고아가 된다(WP-130)
    if (dsl.fetchExists(
        EMAIL_MESSAGE,
        EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId),
        EMAIL_MESSAGE.FOLDER_ID.eq(folderId),
        EMAIL_MESSAGE.IMAP_UID.eq(m.imapUid()))) {
      return Optional.empty();
    }
    // 현재 GUC 와 일치하는 테넌트 ID 로 email_content 를 공유 생성(find-or-create).
    // TenantContext.get() 은 TenantAwareTransactionManager 가 GUC 로 주입한 값과 동일하다.
    long tenantId = requireTenantId();
    long contentId = contentRepo.findOrCreate(tenantId, m, ContentSource.IMAP);
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
   * Graph upsert 결과(WP-148). 신규 삽입만 "새 메일"로 세고, 기존 행의 읽음 갱신은 따로 센다 — 읽음 갱신을 새 메일로 오인하면 새 메일 SSE·본문
   * 백필 판단이 어긋난다.
   */
  public enum UpsertOutcome {
    /** 새 envelope 삽입. */
    INSERTED,
    /** 기존 envelope 의 seen 만 서버 값으로 바뀜. */
    SEEN_CHANGED,
    /** 변화 없음(기존 행 · 같은 seen · 동시 삽입 충돌). */
    UNCHANGED
  }

  /**
   * Graph provider_message_id 키로 메시지를 UPSERT 한다.
   *
   * <p>이미 있는 envelope(delta 재전송)면 INSERT 하지 않는다 — 지문 없는 content 가 매번 새로 생겨 고아가 되기 때문(WP-130). 대신
   * {@code syncSeen} 이면 <b>seen 만</b> 서버 isRead 로 맞춘다(WP-148, 서버 기준 — 안읽음 되돌림 포함). 다른 컬럼은 건드리지 않는다.
   *
   * <p>스펙의 "ON CONFLICT DO UPDATE SET seen" 을 기존-행 분기 UPDATE 로 구현한 이유: 위 사전 조회 때문에 ON CONFLICT 에
   * 도달하지 않고, {@code DO UPDATE … RETURNING} 은 갱신된 행도 반환해 신규 삽입과 구별되지 않는다. INSERT 의 {@code
   * onConflictDoNothing} 은 동시 삽입 경합 안전망으로 남긴다.
   *
   * <p>한계: 로컬 열람의 서버 반영이 끝내 실패해 seen_push_pending 이 남은 메일은 이후 서버 쪽 안읽음 되돌림이 반영되지 않는다(WP-148 이전 동작과
   * 같음).
   *
   * <p>imapUid 는 Graph 계정에서 사용하지 않으므로 null 저장(IMAP 분기와 구별).
   *
   * @param accountId 계정 id
   * @param folderId 폴더 id
   * @param m 매핑된 ParsedMessage(imapUid 는 무시됨). 기존 행이면 {@code m.seen()} 만 쓴다
   * @param providerMessageId Graph 메시지 id
   * @param syncSeen false 면 기존 행의 seen 을 건드리지 않는다(delta 항목에 isRead 가 없을 때)
   * @return 삽입 · 읽음 변경 · 변화 없음
   */
  public UpsertOutcome upsertByProviderId(
      long accountId, long folderId, ParsedMessage m, String providerMessageId, boolean syncSeen) {
    if (findByProviderId(accountId, providerMessageId).isPresent()) {
      // 기존 행 — 서버 읽음 상태만 반영(값이 같으면 0건이라 SSE·순환 없음)
      if (!syncSeen) {
        return UpsertOutcome.UNCHANGED;
      }
      int changed =
          dsl.update(EMAIL_MESSAGE)
              .set(EMAIL_MESSAGE.SEEN, m.seen())
              .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
              .and(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID.eq(providerMessageId))
              .and(serverSeenApplicable(m.seen()))
              .execute();
      return changed > 0 ? UpsertOutcome.SEEN_CHANGED : UpsertOutcome.UNCHANGED;
    }
    // Graph 경로도 동일하게 email_content 공유(find-or-create).
    long tenantId = requireTenantId();
    long contentId = contentRepo.findOrCreate(tenantId, m, ContentSource.GRAPH);
    boolean inserted =
        dsl.insertInto(EMAIL_MESSAGE)
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
            .onConflictDoNothing() // 동시 삽입 경합 안전망 — 충돌이면 새 메일로 세지 않는다
            .returning(EMAIL_MESSAGE.ID)
            .fetchOptional()
            .isPresent();
    return inserted ? UpsertOutcome.INSERTED : UpsertOutcome.UNCHANGED;
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

  /**
   * 서버 읽음 상태를 로컬에 반영해도 되는 행 조건(WP-148 단일 규칙): 값이 실제로 다르고({@code seen != 서버값}), 로컬 열람의 서버 반영 대기 중이
   * 아니어야 한다. 대기 중인 행을 서버 상태로 덮으면 방금 로컬에서 읽은 메일이 안읽음으로 되돌아간다. 서버 반영이 예외로 실패한 메일만 대기가 남으므로, 그 메일은 이후
   * 서버 안읽음 되돌림이 반영되지 않는 한계가 있다.
   */
  private static Condition serverSeenApplicable(boolean serverSeen) {
    return EMAIL_MESSAGE.SEEN.ne(serverSeen).and(seenPushNotPending());
  }

  /**
   * 서버 반영 대기가 아닌 행 조건 — {@link #serverSeenApplicable} 과 {@link #listRecentImapSeenStates} 가 공유한다.
   */
  private static Condition seenPushNotPending() {
    return EMAIL_MESSAGE.SEEN_PUSH_PENDING.isFalse();
  }

  /** IMAP 읽음 동기화 대상 한 건(WP-148) — 로컬 envelope 의 UID 와 현재 seen. */
  public record ImapSeenState(long imapUid, boolean seen) {}

  /**
   * IMAP 읽음 상태 재조회 대상(WP-148). 같은 계정·폴더에서 {@code received_at >= since} 인 행을 UID 큰 순으로 {@code limit}
   * 건 — "최근 N일 또는 최근 M건 중 작은 쪽". 범위 밖 메일의 외부 열람은 반영하지 않는다(알려진 한계 — 서버 FETCH 비용 상한).
   */
  public List<ImapSeenState> listRecentImapSeenStates(
      long accountId, long folderId, OffsetDateTime since, int limit) {
    return dsl.select(EMAIL_MESSAGE.IMAP_UID, EMAIL_MESSAGE.SEEN)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_MESSAGE.FOLDER_ID.eq(folderId))
        .and(EMAIL_MESSAGE.IMAP_UID.isNotNull())
        .and(seenPushNotPending()) // 서버 반영 대기 행은 서버 상태로 덮어쓰지 않으므로 재조회 제외
        .and(EMAIL_MESSAGE.RECEIVED_AT.ge(since))
        .orderBy(EMAIL_MESSAGE.IMAP_UID.desc())
        .limit(limit)
        .fetch(r -> new ImapSeenState(r.value1(), Boolean.TRUE.equals(r.value2())));
  }

  /**
   * IMAP UID 로 seen 을 서버 값으로 맞춘다(WP-148, 서버 기준 — 안읽음 되돌림 포함). 값이 같으면 갱신하지 않아(0) 로컬→서버 역동기화 후 재동기화
   * 순환·불필요 SSE 가 생기지 않는다.
   *
   * @return 실제 갱신 행 수(0|1)
   */
  public int updateSeenByImapUid(long accountId, long folderId, long imapUid, boolean seen) {
    return dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.SEEN, seen)
        .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_MESSAGE.FOLDER_ID.eq(folderId))
        .and(EMAIL_MESSAGE.IMAP_UID.eq(imapUid))
        .and(serverSeenApplicable(seen))
        .execute();
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
   * 목록 보기 조건(WP-187 추출) — 계정·폴더·안읽음·분류(업무 = 업무 ∪ 미분류 ∪ 미적재)·회신필요·검색어. 목록 조회와 "모두 읽음"·건수가 같은 술어를 써서
   * "보이는 범위 = 처리 범위"가 되게 한다. EMAIL_FOLDER 조인과 EMAIL_CONTENT LEFT JOIN 을 전제한다.
   */
  public Condition viewCondition(
      long accountId,
      String folderName,
      String query,
      boolean unreadOnly,
      String category,
      boolean needsReply) {
    Condition where = EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId).and(EMAIL_FOLDER.NAME.eq(folderName));
    if (unreadOnly) {
      where = where.and(EMAIL_MESSAGE.SEEN.isFalse());
    }
    if (category != null && !category.isBlank()) {
      // WP-186: 업무 = 업무 ∪ 미분류 ∪ 미적재, 그 외는 검증된 사본의 해당 분류(단일 술어)
      where = where.and(categoryViewCondition(category));
    }
    if (needsReply) {
      // 회신필요 단일 술어(AI 판정 true + 안 읽음)
      where = where.and(needsReplyCondition());
    }
    if (query != null && !query.isBlank()) {
      // Task8: email_content.search_tv(tsvector) 를 FTS 로 검색.
      // 'simple' 토크나이저는 공백 분리 + 소문자화만 수행(한국어 형태소 미지원, 영문·고유명사 단어 일치).
      // plainto_tsquery 는 & 연산자로 단어 연결 — 인젝션 방지를 위해 파라미터 바인딩({0}) 사용.
      // 발신자(from_address/from_name) 검색은 LIKE 로 보존(FTS 토크나이저가 이메일 주소를 토큰 분리하지 않아
      // "user@domain.com" 같은 패턴은 FTS 로 매칭이 불가함).
      String q = query.trim();
      String like = "%" + q + "%";
      // WP-130: 본문 FTS 는 자기 사본을 적재·검증한 envelope 에만 — 검증 전 매칭 여부로 공유 본문 단어를 추론하지 못하게 한다
      Condition ftsCond =
          DSL.condition("email_content.search_tv @@ plainto_tsquery('simple', {0})", q)
              .and(EMAIL_MESSAGE.FETCHED_AT.isNotNull());
      Condition envelopeCond =
          EMAIL_MESSAGE
              .FROM_ADDRESS
              .likeIgnoreCase(like)
              .or(EMAIL_MESSAGE.FROM_NAME.likeIgnoreCase(like));
      // 검증 전 envelope 는 본문 FTS 대신 제목(동기화 지문의 공개 헤더)만 부분 일치로 찾는다 — 적재 전 새 메일도 제목 검색 가능
      Condition unverifiedSubjectCond =
          EMAIL_MESSAGE.FETCHED_AT.isNull().and(EMAIL_CONTENT.SUBJECT.likeIgnoreCase(like));
      where = where.and(ftsCond.or(unverifiedSubjectCond).or(envelopeCond));
    }
    return where;
  }

  /**
   * P2: 계정 + 폴더 스코프 목록(최신순, 본문 제외). category/needsReply 필터 추가. 회신필요는 단일 술어 needsReplyCondition().
   * query 가 있으면 제목/보낸사람/스니펫 부분일치. unreadOnly=true 면 seen=false(안 읽은) 메일만 반환한다. 소유 검증은 호출 측에서 수행.
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
    Condition where = viewCondition(accountId, folderName, query, unreadOnly, category, needsReply);
    return dsl.select(
            EMAIL_MESSAGE.ID,
            EMAIL_MESSAGE.ACCOUNT_ID,
            EMAIL_MESSAGE.THREAD_ID,
            EMAIL_MESSAGE.FROM_ADDRESS,
            EMAIL_MESSAGE.FROM_NAME,
            EMAIL_CONTENT.SUBJECT, // content 에서 읽음
            verified(EMAIL_CONTENT.SNIPPET), // content 에서 읽음
            EMAIL_MESSAGE.RECEIVED_AT,
            EMAIL_MESSAGE.SEEN,
            EMAIL_MESSAGE.HAS_ATTACHMENT,
            verified(EMAIL_CONTENT.AI_CATEGORY), // 슬라이스②: content 에서 읽음
            EMAIL_MESSAGE.AI_NEEDS_REPLY,
            categoryPendingField()) // WP-186: 분류 전 배지
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
   * <p>countUnread 와 동일한 소유·INBOX 조건에 needsReplyCondition()(AI 판정 true + 안 읽음)을 적용한다. pending(null)
   * 과 false 는 제외된다 — isTrue() 가 null-safe FALSE 처리를 포함한다.
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
            .and(needsReplyCondition())); // WP-146: 회신필요 단일 술어
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
            verified(EMAIL_CONTENT.SNIPPET), // content 에서 읽음
            EMAIL_MESSAGE.RECEIVED_AT,
            EMAIL_MESSAGE.SEEN,
            EMAIL_MESSAGE.HAS_ATTACHMENT,
            verified(EMAIL_CONTENT.AI_CATEGORY), // 슬라이스②: content 에서 읽음
            EMAIL_MESSAGE.AI_NEEDS_REPLY,
            categoryPendingField()) // WP-186: 분류 전 배지
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
        // 회신필요(needsReplyCondition — 기간 포함) 우선 → 최신순. 적은 회신필요 메일이 항상 상위 N 에 끼게 해
        // 홈 위젯/필터가 전역 needsReplyCount 와 어긋나지 않도록 한다(분류 off 면 전부 해당 없음 → 최신순).
        .orderBy(
            DSL.when(needsReplyCondition(), 1).otherwise(0).desc(),
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

    // 본문 즉시 적재(보낸메일은 전송 시점에 본문 확정)
    long tenantId = requireTenantId();
    // WP-130: 수신 사본과 공유하지 않는 전용 content — 아래 updateBody 는 첫 적재자 선점 없이 무조건 기록하므로 전용이어야 안전하다
    long contentId = contentRepo.createDedicated(tenantId, sentAsMsg);
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
        // 본문을 직접 기록한 전용 content — 적재·검증 완료로 표시해야 본문이 노출된다(WP-130 verified)
        .set(EMAIL_MESSAGE.FETCHED_AT, OffsetDateTime.now())
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
                verified(EMAIL_CONTENT.BODY_TEXT),
                verified(EMAIL_CONTENT.BODY_HTML))
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

  /**
   * 메시지의 첨부 메타 목록. filename/content_type/size_bytes 는 content_attachment(공유 manifest)에서 읽는다(Task5).
   * V102 이후 email_attachment 에 메타 컬럼이 없으므로 폴백 없음 — manifest 미매핑 레거시 행은 null 메타로 반환된다.
   */
  private List<EmailAttachmentMeta> listAttachments(long messageId) {
    return dsl.select(
            EMAIL_ATTACHMENT.ID,
            CONTENT_ATTACHMENT.FILENAME,
            CONTENT_ATTACHMENT.CONTENT_TYPE,
            CONTENT_ATTACHMENT.SIZE_BYTES,
            CONTENT_ATTACHMENT.MIME_CONTENT_ID)
        .from(EMAIL_ATTACHMENT)
        .leftJoin(CONTENT_ATTACHMENT)
        .on(CONTENT_ATTACHMENT.ID.eq(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID))
        .where(EMAIL_ATTACHMENT.MESSAGE_ID.eq(messageId))
        .orderBy(EMAIL_ATTACHMENT.ORDINAL.asc().nullsLast(), EMAIL_ATTACHMENT.ID.asc())
        .fetch(
            r ->
                new EmailAttachmentMeta(
                    r.get(EMAIL_ATTACHMENT.ID),
                    r.get(CONTENT_ATTACHMENT.FILENAME),
                    r.get(CONTENT_ATTACHMENT.CONTENT_TYPE),
                    r.get(CONTENT_ATTACHMENT.SIZE_BYTES) == null
                        ? 0L
                        : r.get(CONTENT_ATTACHMENT.SIZE_BYTES),
                    // 빈 문자열은 지연 백필의 내부 표시("확인했지만 없음", WP-68) — API 로는 "없음"(null)으로만 노출
                    emptyToNull(r.get(CONTENT_ATTACHMENT.MIME_CONTENT_ID))));
  }

  private static String emptyToNull(String v) {
    return v == null || v.isEmpty() ? null : v;
  }

  /** envelope 를 다른 content 로 옮긴다(WP-130 공유 content 분리). */
  public void repointContent(long messageId, long contentId) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.CONTENT_ID, contentId)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .execute();
  }

  /**
   * per-envelope 본문 적재 완료 마커(V97). 이 envelope 의 본문/첨부 적재가 완료됐음을 기록한다. 공유
   * email_content.body_fetched_at 과 분리된 per-envelope 게이트로, 같은 content 를 공유하는 다른 수신자의 fetch 가 이
   * envelope 를 건너뛰지 않도록 보장한다.
   */
  public void markFetched(long messageId) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.FETCHED_AT, OffsetDateTime.now())
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .execute();
  }

  /**
   * 로컬 열람 읽음 처리 — seen=true 와 함께 seen_push_pending=true(원본 서버 반영 대기)로 업데이트. 이미 읽은 건은
   * 스킵(SEEN.isFalse 조건). 실제 갱신된 행 수(0|1)를 반환한다. 대기 표시는 서버 반영이 예외 없이 끝나거나 반영할 방법이 없을 때 {@link
   * #clearSeenPushPendingIf} 로 풀린다(WP-148, WP-187 조건부).
   */
  public int markSeen(long messageId) {
    return dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.SEEN, true)
        .set(EMAIL_MESSAGE.SEEN_PUSH_PENDING, true)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .and(EMAIL_MESSAGE.SEEN.isFalse())
        .execute();
  }

  /** WP-187 안읽음으로 표시 — seen=false 와 원본 서버 반영 대기. 이미 안 읽은 행은 건너뛰고 갱신 행 수(0|1)를 돌려준다. */
  public int markUnseen(long messageId) {
    return dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.SEEN, false)
        .set(EMAIL_MESSAGE.SEEN_PUSH_PENDING, true)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .and(EMAIL_MESSAGE.SEEN.isTrue())
        .execute();
  }

  /**
   * WP-187 보기 안의 안 읽은 메일 id 서브쿼리 — INBOX 고정. asOf 경계는 "이 DB 에 asOf 이전에 들어옴"(created_at &lt;= asOf)
   * 하나뿐이다: 다이얼로그가 열린 사이 동기화로 들어온 메일(수신 시각이 과거여도)이 보지도 않고 읽음 처리되는 것을 막는다. 수신 시각은 경계에 쓰지 않는다 — 발신자가
   * 정한 Date 헤더로 미래 시각이 들어올 수 있어, 사이드바 집계({@link #countUnreadAggregate})에는 잡히는데 모두 읽음으로는 영영 지울 수 없는
   * 행이 생기기 때문이다.
   */
  private Select<Record1<Long>> unreadInView(
      long accountId, String category, boolean needsReply, String query, OffsetDateTime asOf) {
    return dsl.select(EMAIL_MESSAGE.ID)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .leftJoin(EMAIL_CONTENT)
        .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .where(viewCondition(accountId, "INBOX", query, true, category, needsReply))
        .and(EMAIL_MESSAGE.CREATED_AT.le(asOf));
  }

  /** WP-187 모두 읽음 확인 다이얼로그용 건수. */
  public long countUnreadInView(
      long accountId, String category, boolean needsReply, String query, OffsetDateTime asOf) {
    return dsl.fetchCount(unreadInView(accountId, category, needsReply, query, asOf));
  }

  /** WP-187 모두 읽음 — 보기 조건 ∧ asOf 경계 ∧ 안 읽음을 한 번에 읽음 + 반영 대기로 바꾸고 바뀐 id 를 돌려준다. */
  public List<Long> markAllSeenInView(
      long accountId, String category, boolean needsReply, String query, OffsetDateTime asOf) {
    return dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.SEEN, true)
        .set(EMAIL_MESSAGE.SEEN_PUSH_PENDING, true)
        .where(EMAIL_MESSAGE.ID.in(unreadInView(accountId, category, needsReply, query, asOf)))
        .and(EMAIL_MESSAGE.SEEN.isFalse())
        .returning(EMAIL_MESSAGE.ID)
        .fetch(EMAIL_MESSAGE.ID);
  }

  /** WP-187 역동기화 대상 — 반영 대기 중인 행만, 처리 시점의 seen 과 서버 식별자. */
  public List<SeenSyncItem> findPendingSeenSyncItems(List<Long> messageIds) {
    return dsl.select(
            EMAIL_MESSAGE.ID,
            EMAIL_MESSAGE.ACCOUNT_ID,
            EMAIL_ACCOUNT.PROVIDER,
            EMAIL_MESSAGE.PROVIDER_MESSAGE_ID,
            EMAIL_MESSAGE.IMAP_UID,
            EMAIL_FOLDER.NAME,
            EMAIL_MESSAGE.SEEN)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .where(EMAIL_MESSAGE.ID.in(messageIds))
        .and(EMAIL_MESSAGE.SEEN_PUSH_PENDING.isTrue())
        .orderBy(EMAIL_MESSAGE.ID)
        .fetch(
            r ->
                new SeenSyncItem(
                    r.get(EMAIL_MESSAGE.ID),
                    new ReadSyncLocator(
                        r.get(EMAIL_MESSAGE.ACCOUNT_ID),
                        MailProvider.valueOf(r.get(EMAIL_ACCOUNT.PROVIDER)),
                        r.get(EMAIL_MESSAGE.PROVIDER_MESSAGE_ID),
                        r.get(EMAIL_MESSAGE.IMAP_UID),
                        r.get(EMAIL_FOLDER.NAME)),
                    Boolean.TRUE.equals(r.get(EMAIL_MESSAGE.SEEN))));
  }

  /**
   * WP-187 조건부 대기 해제 — 서버에 보낸 값(pushedSeen)과 지금 seen 이 같을 때만 푼다. 그 사이 사용자가 다시 바꿨다면 표시를 유지해 뒤따르는
   * 이벤트가 처리하게 한다(마지막 상태로 수렴).
   */
  public int clearSeenPushPendingIf(long messageId, boolean pushedSeen) {
    return dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.SEEN_PUSH_PENDING, false)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .and(EMAIL_MESSAGE.SEEN.eq(pushedSeen))
        .and(EMAIL_MESSAGE.SEEN_PUSH_PENDING.isTrue())
        .execute();
  }

  /** 사이드바용 — 특정 계정 INBOX 의 회신필요 건수. 목록 필터(needsReply)와 같은 단일 술어를 쓴다(WP-146). */
  public long countNeedsReplyForAccount(long accountId) {
    return dsl.fetchCount(
        dsl.selectOne()
            .from(EMAIL_MESSAGE)
            .join(EMAIL_FOLDER)
            .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
            .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
            .and(EMAIL_FOLDER.NAME.eq("INBOX"))
            .and(needsReplyCondition()));
  }

  /** 계정 INBOX 안 읽은 메일 술어(WP-186) — 안 읽은 수 집계의 공통 범위. EMAIL_FOLDER 조인이 필요하다. */
  private static Condition inboxUnreadCondition(long accountId) {
    return EMAIL_MESSAGE
        .ACCOUNT_ID
        .eq(accountId)
        .and(EMAIL_FOLDER.NAME.eq("INBOX"))
        .and(EMAIL_MESSAGE.SEEN.isFalse());
  }

  /**
   * WP-186 계정 INBOX 안 읽은 메일 집계 — 쿼리 1회. inbox 는 분류 필터 없는 "전체"(알 수 없는 분류값 포함), byCategory 는 목록과 같은
   * categoryViewCondition, needsReply 는 목록 필터와 같은 needsReplyCondition 으로 센다.
   */
  public UnreadAggregate countUnreadAggregate(long accountId) {
    List<Field<Integer>> fields = new ArrayList<>();
    fields.add(DSL.count());
    for (String c : CATEGORIES) {
      fields.add(DSL.count().filterWhere(categoryViewCondition(c)));
    }
    fields.add(DSL.count().filterWhere(needsReplyCondition()));
    Record r =
        dsl.select(fields)
            .from(EMAIL_MESSAGE)
            .join(EMAIL_FOLDER)
            .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
            .leftJoin(EMAIL_CONTENT)
            .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
            .where(inboxUnreadCondition(accountId))
            .fetchOne();
    Map<String, Long> byCategory = new LinkedHashMap<>();
    for (int i = 0; i < CATEGORIES.size(); i++) {
      byCategory.put(CATEGORIES.get(i), r.get(i + 1, Long.class));
    }
    return new UnreadAggregate(
        r.get(0, Long.class), byCategory, r.get(CATEGORIES.size() + 1, Long.class));
  }

  /** {@link #countUnreadAggregate(long)} 결과 — 받은편지함 전체·분류별·회신필요 안 읽은 수. */
  public record UnreadAggregate(long inbox, Map<String, Long> byCategory, long needsReply) {}

  /** WP-186 탭 배지용 — 계정 INBOX 안 읽은 업무 보기 건수(분류 꺼짐이면 {@link #countUnreadInbox}). */
  public long countUnreadWork(long accountId) {
    return dsl.fetchCount(
        dsl.selectOne()
            .from(EMAIL_MESSAGE)
            .join(EMAIL_FOLDER)
            .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
            .leftJoin(EMAIL_CONTENT)
            .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
            .where(inboxUnreadCondition(accountId))
            .and(workViewCondition()));
  }

  /** WP-186 계정 INBOX 안 읽은 메일 전체 건수 — 목록의 "전체"(분류 필터 없음) 보기와 같다. 알 수 없는 분류값도 포함한다. */
  public long countUnreadInbox(long accountId) {
    return dsl.fetchCount(
        dsl.selectOne()
            .from(EMAIL_MESSAGE)
            .join(EMAIL_FOLDER)
            .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
            .where(inboxUnreadCondition(accountId)));
  }

  /** #484: 공백 요약은 '결과 없음'(NULL)으로 저장 — 읽는 쪽이 공백 여부를 다시 판정하지 않게 한다. */
  private static String blankToNull(String s) {
    return StringUtils.hasText(s) ? s : null;
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

  /**
   * 선제 배치 요약 대상 — INBOX 안읽음 중 공유 content 미시도(c.ai_summarized_at IS NULL) 최근 limit건.
   *
   * <p>#484: ai_summary IS NULL 기준이면 LLM 이 빈 결과를 낸 메일이 매 배치 재선택돼 LIMIT 슬롯을 영구 점유하고 LLM 비용이 샌다. 시도
   * 시각 기준으로 '시도했으나 결과 없음' 행을 제외한다.
   */
  public List<Long> listRecentUnreadUnsummarizedIds(long accountId, int limit) {
    return dsl.select(EMAIL_MESSAGE.ID)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .leftJoin(EMAIL_CONTENT)
        .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_FOLDER.NAME.eq("INBOX"))
        .and(EMAIL_MESSAGE.SEEN.isFalse())
        .and(EMAIL_CONTENT.AI_SUMMARIZED_AT.isNull()) // 슬라이스② content 기준 + #484 시도 시각 기준
        .and(withinNeedsReplyWindow()) // 옛 메일까지 내려가지 않게 — 기간 밖은 열람 시 온디맨드
        .orderBy(EMAIL_MESSAGE.RECEIVED_AT.desc().nullsLast(), EMAIL_MESSAGE.ID.desc())
        .limit(limit)
        .fetch(EMAIL_MESSAGE.ID);
  }

  /**
   * WP-185 분류 일괄 대상 — INBOX · 본문 적재·검증 사본 · content 연결 · 분류 없음 · 분류 일괄 미시도. 읽음·수신 시각은 보지 않는다(전체
   * 메일). 같은 content 를 공유하는 사본은 content 당 대표 1통(가장 최근 사본)만 고른다 — 한 번 분류하면 모두 빠진다.
   */
  public List<Long> listUncategorizedIds(long accountId, int limit) {
    var ranked =
        dsl.select(
                EMAIL_MESSAGE.ID,
                EMAIL_MESSAGE.RECEIVED_AT,
                DSL.rowNumber()
                    .over(
                        DSL.partitionBy(EMAIL_MESSAGE.CONTENT_ID)
                            .orderBy(
                                EMAIL_MESSAGE.RECEIVED_AT.desc().nullsLast(),
                                EMAIL_MESSAGE.ID.desc()))
                    .as("rn"))
            .from(EMAIL_MESSAGE)
            .join(EMAIL_FOLDER)
            .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
            .join(EMAIL_CONTENT)
            .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
            .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
            .and(EMAIL_FOLDER.NAME.eq("INBOX"))
            .and(EMAIL_MESSAGE.FETCHED_AT.isNotNull())
            .and(EMAIL_CONTENT.AI_CATEGORY.isNull())
            .and(EMAIL_CONTENT.AI_CATEGORIZED_AT.isNull())
            .asTable("r");
    return dsl.select(ranked.field(EMAIL_MESSAGE.ID))
        .from(ranked)
        .where(ranked.field("rn", Integer.class).eq(1))
        .orderBy(
            ranked.field(EMAIL_MESSAGE.RECEIVED_AT).desc().nullsLast(),
            ranked.field(EMAIL_MESSAGE.ID).desc())
        .limit(limit)
        .fetch(ranked.field(EMAIL_MESSAGE.ID));
  }

  /** WP-185 분류 입력 — 대상 id 들의 제목·보낸사람·본문. 계정 범위로 한정하고(다른 계정 id 차단), 본문은 적재·검증 사본만 읽는다. */
  public List<ClassifyInput> findClassifyInputs(long accountId, List<Long> messageIds) {
    return dsl.select(
            EMAIL_MESSAGE.ID,
            EMAIL_MESSAGE.CONTENT_ID,
            EMAIL_CONTENT.SUBJECT,
            EMAIL_MESSAGE.FROM_ADDRESS,
            EMAIL_MESSAGE.FROM_NAME,
            EMAIL_CONTENT.BODY_TEXT,
            EMAIL_CONTENT.BODY_HTML,
            EMAIL_CONTENT.SNIPPET,
            EMAIL_CONTENT.AUTO_GENERATED)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_CONTENT)
        .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .where(EMAIL_MESSAGE.ID.in(messageIds))
        .and(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_MESSAGE.FETCHED_AT.isNotNull())
        .fetch(
            r ->
                new ClassifyInput(
                    r.get(EMAIL_MESSAGE.ID),
                    r.get(EMAIL_MESSAGE.CONTENT_ID),
                    r.get(EMAIL_CONTENT.SUBJECT),
                    r.get(EMAIL_MESSAGE.FROM_ADDRESS),
                    r.get(EMAIL_MESSAGE.FROM_NAME),
                    r.get(EMAIL_CONTENT.BODY_TEXT),
                    r.get(EMAIL_CONTENT.BODY_HTML),
                    r.get(EMAIL_CONTENT.SNIPPET),
                    Boolean.TRUE.equals(r.get(EMAIL_CONTENT.AUTO_GENERATED))));
  }

  /** WP-185 분류 시도 기록 — 응답을 받은 사본의 content 에 시각을 남긴다(분류가 비었어도). 적재·검증 사본만. */
  public int markCategorized(long messageId) {
    return dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.AI_CATEGORIZED_AT, OffsetDateTime.now())
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .and(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .and(EMAIL_MESSAGE.FETCHED_AT.isNotNull())
        .and(EMAIL_CONTENT.AI_CATEGORIZED_AT.isNull())
        .execute();
  }

  /** WP-185 분류 입력 행. */
  public record ClassifyInput(
      long messageId,
      Long contentId,
      String subject,
      String fromAddress,
      String fromName,
      String bodyText,
      String bodyHtml,
      String snippet,
      boolean autoGenerated) {}

  /**
   * WP-149 ④ 백필 대상 — INBOX 안읽음 중 개인 분석 미시도(ai_analyzed_at IS NULL) 최근 limit건(최신순). 동기화 후 ④ 패스와 AI 켬
   * 백필이 함께 쓴다. 읽은 메일은 선제 분석하지 않는다(판단 13 — 열람 시 요약 GET 이 온디맨드로 만든다).
   *
   * <p>배포 전 기준으로 분류된 메일(ai_needs_reply 있음 — 옛 false)은 제외한다(LLM 비용). 옛 true 는 V147 이 NULL 로 되돌려 여기서
   * 점진 판정된다. WP-130: 본문을 적재·검증한 사본만 고른다 — AI 켬 백필은 본문을 적재하지 않으므로 미적재 행이 상한 슬롯을 차지한 채 건너뛰어지지 않게 한다.
   * 미적재 새 메일의 ④ 는 본문 보충 직후(MailBackfillService → analyzeAfterLoad)가 맡는다.
   */
  public List<Long> listRecentUnreadUnanalyzedIds(long accountId, int limit) {
    return dsl.select(EMAIL_MESSAGE.ID)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_FOLDER.NAME.eq("INBOX"))
        .and(EMAIL_MESSAGE.SEEN.isFalse())
        .and(EMAIL_MESSAGE.AI_ANALYZED_AT.isNull())
        .and(EMAIL_MESSAGE.AI_NEEDS_REPLY.isNull())
        .and(EMAIL_MESSAGE.FETCHED_AT.isNotNull())
        .and(withinNeedsReplyWindow()) // 옛 메일까지 내려가지 않게 — 기간 밖은 회신필요로 세지 않는다
        .orderBy(EMAIL_MESSAGE.RECEIVED_AT.desc().nullsLast(), EMAIL_MESSAGE.ID.desc())
        .limit(limit)
        .fetch(EMAIL_MESSAGE.ID);
  }

  /**
   * WP-151 새 기준 재분석 대상 — INBOX 안읽음 · 본문 적재·검증(fetched_at) · 새 흐름(④) 미분석(ai_analyzed_at IS NULL) 최근
   * limit건(최신순).
   *
   * <p>{@link #listRecentUnreadUnanalyzedIds} 와 달리 ai_needs_reply 조건이 없다 — 배포 전 기준으로 이미 분류된 행(옛 값)을
   * 새 기준으로 다시 판정하는 것이 목적이다. 이미 새 흐름으로 분석된 행은 빼서 상한 슬롯을 낭비하지 않는다. 미적재 행은 빼고 본문도 새로 적재하지
   * 않는다(IMAP/Graph 호출 비용 — 미적재 새 메일은 본문 보충 직후 analyzeAfterLoad 가 맡는다).
   *
   * <p>⚠️ "0→1" 전환 전용: WP-149 이전 행이 ai_analyzed_at NULL 이라는 사실에 기대므로, 판정 기준 버전을 2 로 올릴 때는
   * ai_analyzed_at 을 되돌리는 별도 경로가 필요하다.
   */
  public List<Long> listReanalysisTargetIds(long accountId, int limit) {
    return dsl.select(EMAIL_MESSAGE.ID)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(accountId))
        .and(EMAIL_FOLDER.NAME.eq("INBOX"))
        .and(EMAIL_MESSAGE.SEEN.isFalse())
        .and(EMAIL_MESSAGE.AI_ANALYZED_AT.isNull())
        .and(EMAIL_MESSAGE.FETCHED_AT.isNotNull())
        .and(withinNeedsReplyWindow()) // 기간 밖은 회신필요로 세지 않으므로 다시 판정하지 않는다
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
   * 이 설정된 경우에도 이 envelope 의 fetched_at 이 NULL 이면 재적재 대상이 된다 — 같은 content 를 공유하는 두 번째 수신자도 자신의 첨부 행을
   * 생성할 수 있도록 보장한다(공유 콘텐츠 첨부 누락 회귀 수정).
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
   * #859 메일 행 배타 잠금(SELECT ... FOR UPDATE). 같은 메일을 대상으로 하는 확인-후-생성(메일→이슈 승격)을 트랜잭션 끝까지 직렬화한다. 소유권
   * 검증은 호출자가 먼저 한다.
   */
  public void lockById(long messageId) {
    dsl.select(EMAIL_MESSAGE.ID)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .forUpdate()
        .fetch();
  }

  /**
   * AI 요약/답장용 컨텍스트(계정 ai_enabled·본인 이메일 + 메시지 본문/요약). 소유 검증 포함.
   *
   * <p>Task6: 제목·본문은 email_content LEFT JOIN 으로 읽는다. FROM_ADDRESS 는 envelope 잔존(봉투 속성).
   *
   * <p>슬라이스②: ai_summary 도 공유 email_content 에서 읽는다(N→1 dedup).
   *
   * <p>Task3(2-tier): personalSummary 는 envelope email_message.ai_personal_summary 에서 읽는다(사람별).
   */
  public Optional<AiContext> findAiContextByIdAndUser(long userId, long messageId) {
    return dsl.select(
            EMAIL_ACCOUNT.AI_ENABLED,
            EMAIL_ACCOUNT.EMAIL_ADDRESS,
            EMAIL_CONTENT.SUBJECT, // content 에서 읽음
            EMAIL_MESSAGE.FROM_ADDRESS,
            verified(EMAIL_CONTENT.BODY_TEXT), // content 에서 읽음
            verified(EMAIL_CONTENT.BODY_HTML), // content 에서 읽음
            verified(EMAIL_CONTENT.AI_SUMMARY), // 슬라이스②: 공통(객관적) 요약 — content 공유
            EMAIL_MESSAGE.AI_PERSONAL_SUMMARY, // Task3: 개인 요약 — envelope(사람별)
            EMAIL_CONTENT.AI_SUMMARIZED_AT, // #484: 공통 요약 시도 여부
            EMAIL_MESSAGE.AI_PERSONAL_SUMMARIZED_AT, // #484: 개인 요약 시도 여부
            EMAIL_MESSAGE.ACCOUNT_ID) // WP-64: 계정 id
        .from(EMAIL_MESSAGE)
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
        .leftJoin(EMAIL_CONTENT) // 본문·제목·요약을 content 에서 읽기 위한 LEFT JOIN
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
                    r.get(EMAIL_CONTENT.AI_SUMMARY), // 슬라이스②: content 출처
                    r.get(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY), // Task3: envelope 출처
                    r.get(EMAIL_CONTENT.AI_SUMMARIZED_AT) != null,
                    r.get(EMAIL_MESSAGE.AI_PERSONAL_SUMMARIZED_AT) != null,
                    r.get(EMAIL_MESSAGE.ACCOUNT_ID)));
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
            verified(EMAIL_CONTENT.BODY_TEXT), // content 에서 읽음
            verified(EMAIL_CONTENT.BODY_HTML)) // content 에서 읽음
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

  /** AI 컨텍스트 행. summary=공통(객관적, content), personalSummary=개인(envelope). */
  public record AiContext(
      boolean aiEnabled,
      String selfAddress,
      String subject,
      String fromAddress,
      String bodyText,
      String bodyHtml,
      String summary,
      String personalSummary,
      // #484: 요약 '시도' 여부(summarized_at 존재). summary 가 null 이어도 true 면 LLM 이 빈 결과를 낸 것 → 재요약 금지.
      boolean summaryAttempted,
      boolean personalSummaryAttempted,
      // WP-64: 메시지가 속한 계정 id — resource.changed 발행(mail 계정 스코프)용
      long accountId) {}

  /** Task6: subject·snippet 은 email_content 에서 읽는다(LEFT JOIN 후 호출). */
  private EmailMessageSummary toSummary(Record r) {
    OffsetDateTime received = r.get(EMAIL_MESSAGE.RECEIVED_AT);
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
        r.get(EMAIL_CONTENT.AI_CATEGORY), // 슬라이스②: content 에서 읽음
        // 회신필요 기간 밖의 true 는 false 로 내보낸다 — 웹·홈 우선순위가 aiNeedsReply 만 보고도 집계(needsReplyCondition)와 같게
        Boolean.TRUE.equals(r.get(EMAIL_MESSAGE.AI_NEEDS_REPLY))
                && !isWithinNeedsReplyWindow(received)
            ? Boolean.FALSE
            : r.get(EMAIL_MESSAGE.AI_NEEDS_REPLY),
        Boolean.TRUE.equals(r.get("category_pending", Boolean.class)));
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
   *
   * <p>같은 패키지의 MailPeopleRepository 도 사내 구성원 판정 테넌트로 쓴다(WP-150 — 같은 로직 복사 금지).
   */
  long requireTenantId() {
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

  /**
   * WP-149 분석 입력 컨텍스트 — ③ 원본 분석·④ 개인 분석·요약 상태 판정이 함께 쓴다. 소유 검증 포함(타인 메일이면 empty).
   *
   * <p>공유 content 의 본문 유래 값(본문·스니펫·AI 분류·요약)은 verified() 로 감싸 이 envelope 가 자기 사본을 적재·검증한 뒤에만 노출한다
   * (WP-130). 시도 시각·생략 표시는 상태 판정용이라 그대로 읽는다.
   */
  public Optional<AnalysisContext> findAnalysisContextByIdAndUser(long userId, long messageId) {
    return dsl.select(
            EMAIL_MESSAGE.ID,
            EMAIL_MESSAGE.ACCOUNT_ID,
            EMAIL_MESSAGE.CONTENT_ID,
            EMAIL_ACCOUNT.AI_ENABLED,
            EMAIL_FOLDER.NAME,
            EMAIL_MESSAGE.FETCHED_AT,
            EMAIL_MESSAGE.SEEN,
            EMAIL_CONTENT.SUBJECT,
            EMAIL_MESSAGE.FROM_ADDRESS,
            EMAIL_MESSAGE.FROM_NAME,
            EMAIL_MESSAGE.TO_ADDRESSES,
            EMAIL_MESSAGE.CC_ADDRESSES,
            verified(EMAIL_CONTENT.BODY_TEXT),
            verified(EMAIL_CONTENT.BODY_HTML),
            verified(EMAIL_CONTENT.SNIPPET),
            EMAIL_CONTENT.AUTO_GENERATED,
            verified(EMAIL_CONTENT.AI_CATEGORY),
            verified(EMAIL_CONTENT.AI_SUMMARY),
            EMAIL_CONTENT.AI_SUMMARIZED_AT,
            EMAIL_CONTENT.AI_SUMMARY_SKIPPED,
            EMAIL_MESSAGE.AI_ANALYZED_AT,
            EMAIL_MESSAGE.AI_PERSONAL_SUMMARY,
            EMAIL_MESSAGE.AI_PERSONAL_SUMMARIZED_AT,
            EMAIL_MESSAGE.AI_PERSONAL_SUMMARY_SKIPPED,
            EMAIL_MESSAGE.RECEIVED_AT)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
        .join(EMAIL_FOLDER)
        .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
        .leftJoin(EMAIL_CONTENT)
        .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
        .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
        .fetchOptional(
            r ->
                new AnalysisContext(
                    r.get(EMAIL_MESSAGE.ID),
                    r.get(EMAIL_MESSAGE.ACCOUNT_ID),
                    r.get(EMAIL_MESSAGE.CONTENT_ID),
                    Boolean.TRUE.equals(r.get(EMAIL_ACCOUNT.AI_ENABLED)),
                    r.get(EMAIL_FOLDER.NAME),
                    r.get(EMAIL_MESSAGE.FETCHED_AT) != null,
                    Boolean.TRUE.equals(r.get(EMAIL_MESSAGE.SEEN)),
                    r.get(EMAIL_CONTENT.SUBJECT),
                    r.get(EMAIL_MESSAGE.FROM_ADDRESS),
                    r.get(EMAIL_MESSAGE.FROM_NAME),
                    r.get(EMAIL_MESSAGE.TO_ADDRESSES),
                    r.get(EMAIL_MESSAGE.CC_ADDRESSES),
                    r.get(EMAIL_CONTENT.BODY_TEXT),
                    r.get(EMAIL_CONTENT.BODY_HTML),
                    r.get(EMAIL_CONTENT.SNIPPET),
                    Boolean.TRUE.equals(r.get(EMAIL_CONTENT.AUTO_GENERATED)),
                    r.get(EMAIL_CONTENT.AI_CATEGORY),
                    r.get(EMAIL_CONTENT.AI_SUMMARY),
                    r.get(EMAIL_CONTENT.AI_SUMMARIZED_AT) != null,
                    Boolean.TRUE.equals(r.get(EMAIL_CONTENT.AI_SUMMARY_SKIPPED)),
                    r.get(EMAIL_MESSAGE.AI_ANALYZED_AT) != null,
                    r.get(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY),
                    r.get(EMAIL_MESSAGE.AI_PERSONAL_SUMMARIZED_AT) != null,
                    Boolean.TRUE.equals(r.get(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY_SKIPPED)),
                    r.get(EMAIL_MESSAGE.RECEIVED_AT)));
  }

  /**
   * WP-149 ③ 결과 저장 — 공유 content 에 분류·객관 요약·생략 표시·시도 시각을 기록한다. 원본별 1회라 시도 기록이 없을 때만 쓴다(조건부 UPDATE —
   * 동시·다중 인스턴스에서도 한 번만). 분류가 null(미지 값)이면 기존 값(④ 보충값)을 지우지 않는다.
   *
   * @return 이번 호출이 기록했으면 true(⑤ 형제 재계산 트리거)
   */
  public boolean saveContentAnalysis(
      long messageId, String category, String summary, boolean summarySkipped) {
    return dsl.update(EMAIL_CONTENT)
            .set(
                EMAIL_CONTENT.AI_CATEGORY,
                DSL.coalesce(
                    DSL.val(category, EMAIL_CONTENT.AI_CATEGORY), EMAIL_CONTENT.AI_CATEGORY))
            .set(EMAIL_CONTENT.AI_SUMMARY, blankToNull(summary))
            .set(EMAIL_CONTENT.AI_SUMMARY_SKIPPED, summarySkipped)
            .set(EMAIL_CONTENT.AI_SUMMARIZED_AT, OffsetDateTime.now())
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ID.eq(messageId))
            .and(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
            // WP-130: 자기 사본을 적재·검증한 envelope 만 공유 분석을 쓴다
            .and(EMAIL_MESSAGE.FETCHED_AT.isNotNull())
            .and(EMAIL_CONTENT.AI_SUMMARIZED_AT.isNull())
            .execute()
        > 0;
  }

  /** WP-149 온디맨드 강제 요약(공통 티어) — 생략 표시를 지우고 요약·시도 시각을 기록한다. 분류는 건드리지 않는다. */
  public void saveForcedContentSummary(long messageId, String summary) {
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.AI_SUMMARY, blankToNull(summary))
        .set(EMAIL_CONTENT.AI_SUMMARY_SKIPPED, false)
        .set(EMAIL_CONTENT.AI_SUMMARIZED_AT, OffsetDateTime.now())
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .and(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .and(EMAIL_MESSAGE.FETCHED_AT.isNotNull())
        .execute();
  }

  /** WP-149 ⑤: content 를 공유하는 사본 중 ④ 원판정(raw)이 있는 것 — ③ 분류가 늦게 왔을 때 재계산 대상. */
  public List<Long> listAnalyzedSiblingIds(long contentId) {
    return dsl.select(EMAIL_MESSAGE.ID)
        .from(EMAIL_MESSAGE)
        .where(EMAIL_MESSAGE.CONTENT_ID.eq(contentId))
        .and(EMAIL_MESSAGE.AI_NEEDS_REPLY_RAW.isNotNull())
        .fetch(EMAIL_MESSAGE.ID);
  }

  /** WP-149 ⑤ 규칙 입력 행(소유자·보낸 사람·수신자·자동 발송·분류·raw). 형제 사본은 소유자가 달라 userId 를 함께 읽는다. */
  public Optional<RuleRow> findRuleRow(long messageId) {
    return dsl.select(
            EMAIL_MESSAGE.ID,
            EMAIL_ACCOUNT.USER_ID,
            EMAIL_MESSAGE.FROM_ADDRESS,
            EMAIL_MESSAGE.TO_ADDRESSES,
            EMAIL_MESSAGE.CC_ADDRESSES,
            EMAIL_CONTENT.AUTO_GENERATED,
            EMAIL_CONTENT.AI_CATEGORY,
            EMAIL_MESSAGE.AI_NEEDS_REPLY_RAW)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
        .leftJoin(EMAIL_CONTENT)
        .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .fetchOptional(
            r ->
                new RuleRow(
                    r.get(EMAIL_MESSAGE.ID),
                    r.get(EMAIL_ACCOUNT.USER_ID),
                    r.get(EMAIL_MESSAGE.FROM_ADDRESS),
                    r.get(EMAIL_MESSAGE.TO_ADDRESSES),
                    r.get(EMAIL_MESSAGE.CC_ADDRESSES),
                    Boolean.TRUE.equals(r.get(EMAIL_CONTENT.AUTO_GENERATED)),
                    r.get(EMAIL_CONTENT.AI_CATEGORY),
                    r.get(EMAIL_MESSAGE.AI_NEEDS_REPLY_RAW)));
  }

  /** WP-149 ⑤ 최종값 저장 — ai_needs_reply 는 회신필요 술어(needsReplyCondition)가 읽는 값이다. */
  public void updateFinalNeedsReply(long messageId, Boolean value) {
    // 값이 바뀔 때만 UPDATE — 재계산이 같은 값을 다시 쓰는 불필요한 쓰기(행 버전·WAL)를 피한다(NULL 안전 비교)
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.AI_NEEDS_REPLY, value)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .and(EMAIL_MESSAGE.AI_NEEDS_REPLY.isDistinctFrom(value))
        .execute();
  }

  /**
   * WP-149 분석 컨텍스트 행.
   *
   * @param contentId 공유 content id(레거시 envelope 는 null — 분석 불가)
   * @param fetched 이 envelope 가 자기 사본을 적재·검증했는지(아니면 본문 유래 값이 가려져 있다)
   * @param seen 읽음 여부 — 선제 분석(본문 적재 직후)은 안 읽은 메일만 한다(판단 13). 온디맨드 요약은 보지 않는다
   * @param contentAttempted ③ 시도 여부(content.ai_summarized_at — 생략해도 기록됨)
   * @param personalAnalyzed ④ 시도 여부(ai_analyzed_at)
   * @param personalAttempted 개인 요약 시도 여부(ai_personal_summarized_at)
   */
  public record AnalysisContext(
      long messageId,
      long accountId,
      Long contentId,
      boolean aiEnabled,
      String folderName,
      boolean fetched,
      boolean seen,
      String subject,
      String fromAddress,
      String fromName,
      String toAddresses,
      String ccAddresses,
      String bodyText,
      String bodyHtml,
      String snippet,
      boolean autoGenerated,
      String contentCategory,
      String contentSummary,
      boolean contentAttempted,
      boolean contentSummarySkipped,
      boolean personalAnalyzed,
      String personalSummary,
      boolean personalAttempted,
      boolean personalSummarySkipped,
      OffsetDateTime receivedAt) {}

  /** WP-149 ⑤ 규칙 입력 행. raw 가 null 이면 ④ 미분석(또는 배포 전 분류) — 재계산하지 않는다. */
  public record RuleRow(
      long messageId,
      long userId,
      String fromAddress,
      String toAddresses,
      String ccAddresses,
      boolean autoGenerated,
      String category,
      Boolean raw) {}

  /**
   * WP-149 ④ 결과 저장 — LLM 원판정(raw)·시도 시각, 그리고 개인 요약(요청해 받았으면) 또는 생략 표시. 사본별 1회라 ai_analyzed_at 이 없을
   * 때만 쓴다(조건부 UPDATE).
   *
   * @param writePersonalSummary 개인 요약을 요청했고 형식이 맞았음 → 요약·시도 시각 기록(공백은 NULL, #484)
   * @param personalSummarySkipped 개인 비서가 있으나 생략 조건이라 요청하지 않음 → 생략 표시
   * @return 이번 호출이 기록했으면 true
   */
  public boolean savePersonalAnalysis(
      long messageId,
      boolean raw,
      boolean writePersonalSummary,
      String personalSummary,
      boolean personalSummarySkipped) {
    UpdateSetMoreStep<EmailMessageRecord> update =
        dsl.update(EMAIL_MESSAGE)
            .set(EMAIL_MESSAGE.AI_NEEDS_REPLY_RAW, raw)
            .set(EMAIL_MESSAGE.AI_ANALYZED_AT, OffsetDateTime.now());
    if (writePersonalSummary) {
      update =
          update
              .set(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY, blankToNull(personalSummary))
              .set(EMAIL_MESSAGE.AI_PERSONAL_SUMMARIZED_AT, OffsetDateTime.now())
              .set(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY_SKIPPED, false);
    } else if (personalSummarySkipped) {
      update = update.set(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY_SKIPPED, true);
    }
    return update
            .where(EMAIL_MESSAGE.ID.eq(messageId))
            .and(EMAIL_MESSAGE.AI_ANALYZED_AT.isNull())
            .execute()
        > 0;
  }

  /** WP-149 개인 요약만 저장(열람 시 요약만 모드·"AI 요약" 강제 생성) — 생략 표시를 지운다. 공백은 NULL(#484). */
  public void savePersonalSummary(long messageId, String summary) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY, blankToNull(summary))
        .set(EMAIL_MESSAGE.AI_PERSONAL_SUMMARIZED_AT, OffsetDateTime.now())
        .set(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY_SKIPPED, false)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .execute();
  }

  /** WP-149 개인 요약 생략 표시만 남긴다(열람 시 요약만 모드에서 생략 조건일 때). */
  public void markPersonalSummarySkipped(long messageId) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.AI_PERSONAL_SUMMARY_SKIPPED, true)
        .where(EMAIL_MESSAGE.ID.eq(messageId))
        .execute();
  }

  /**
   * WP-149: 공통 비서가 없을 때 ④ 가 받은 분류로 공유 content 분류를 보충한다 — 비어 있을 때만(덮어쓰기 금지, 원자적 조건부 UPDATE). 자기 사본을
   * 적재·검증한 envelope 만 쓴다(WP-130).
   */
  public boolean fillContentCategoryIfEmpty(long messageId, String category) {
    return dsl.update(EMAIL_CONTENT)
            .set(EMAIL_CONTENT.AI_CATEGORY, category)
            .from(EMAIL_MESSAGE)
            .where(EMAIL_MESSAGE.ID.eq(messageId))
            .and(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
            .and(EMAIL_MESSAGE.FETCHED_AT.isNotNull())
            .and(EMAIL_CONTENT.AI_CATEGORY.isNull())
            .execute()
        > 0;
  }
}
