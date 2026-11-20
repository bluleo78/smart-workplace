package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.MAIL_DRAFT;
import static com.workplace.jooq.Tables.MAIL_DRAFT_ATTACHMENT;
import static com.workplace.jooq.Tables.MAIL_DRAFT_FORWARD;

import com.workplace.file.api.StagedFileClaimer;
import com.workplace.jooq.tables.records.MailDraftRecord;
import com.workplace.mail.dto.MailDraftCount;
import com.workplace.mail.dto.MailDraftDetail;
import com.workplace.mail.dto.MailDraftDetail.Attachment;
import com.workplace.mail.dto.MailDraftSaved;
import com.workplace.mail.dto.MailDraftSummary;
import com.workplace.mail.dto.MailDraftVersion;
import com.workplace.mail.dto.MailScheduledSummary;
import com.workplace.mail.dto.MailSendRequest.InlineImageRef;
import com.workplace.mail.dto.MailSendRequest.InlineUploadRef;
import com.workplace.mail.dto.QueuedSend;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.InsertSetMoreStep;
import org.jooq.JSONB;
import org.jooq.UpdateSetMoreStep;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * 메일 임시저장(WP-577) 저장소 — mail_draft 와 두 정션(업로드 mail_draft_attachment, 전달 원본 mail_draft_forward).
 *
 * <p>모든 조회·수정은 user_id 로 소유를 건다(남의 id 는 없는 것과 같다). RLS 를 쓰므로 호출자의 트랜잭션(GUC) 안에서 불러야 한다.
 */
@Repository
@RequiredArgsConstructor
public class MailDraftRepository {

  /** 임시저장 업로드 바인딩 키 — 발송이 내 임시저장에 묶인 업로드를 다시 가져올 때 클레이머에 넘긴다(정션 표 이름). */
  public static final String UPLOAD_BINDING = MAIL_DRAFT_ATTACHMENT.getName();

  private final DSLContext dsl;
  private final ObjectMapper objectMapper;

  /** 저장할 값(서비스가 정규화한 것). */
  public record Fields(
      long accountId,
      String mode,
      List<String> to,
      List<String> cc,
      List<String> bcc,
      String subject,
      String bodyHtml,
      String preview,
      Long sourceMessageId,
      boolean quoteRemoved) {}

  /**
   * 대기열(WP-1786)에서 보낼 때 필요한데 임시저장에는 없던 값 — 스케줄러가 요청 없이 행만으로 보낼 수 있게 {@link Fields} 와 함께 저장한다.
   *
   * @param bodyText 본문 평문(multipart 의 text 파트)
   * @param inReplyToMessageId 답장 원본 메일 id(스레딩 헤더용)
   */
  public record QueueFields(
      String bodyText,
      Long inReplyToMessageId,
      List<InlineImageRef> inlineImages,
      List<InlineUploadRef> inlineUploads) {}

  /** 스케줄러가 보낼 때 읽는 행 — 보내기에 필요한 모든 값(첨부는 묶인 업로드·전달 원본 id). */
  public record QueuedRow(
      long id,
      long userId,
      long accountId,
      List<String> to,
      List<String> cc,
      List<String> bcc,
      String subject,
      String bodyHtml,
      String bodyText,
      Long inReplyToMessageId,
      List<InlineImageRef> inlineImages,
      List<InlineUploadRef> inlineUploads,
      List<Long> boundFileIds,
      List<Long> forwardAttachmentIds) {}

  /** 오래 SENDING 에 머물러 실패로 돌린 행 — 알림을 만들 때 필요한 값만. */
  public record StuckRow(long id, long userId, String subject) {}

  /** 상세 조회용 행 — 첨부는 서비스가 따로 붙인다. */
  public record DraftRow(
      long id,
      long accountId,
      String mode,
      List<String> to,
      List<String> cc,
      List<String> bcc,
      String subject,
      String bodyHtml,
      Long sourceMessageId,
      boolean quoteRemoved,
      int version,
      OffsetDateTime updatedAt,
      String bodyText,
      Long inReplyToMessageId,
      List<InlineImageRef> inlineImages,
      List<InlineUploadRef> inlineUploads,
      String sendState,
      String sendError) {}

  /**
   * 새 임시저장 — 버전 1. 본문 평문·답장 원본·인라인 참조(WP-1786 대기열 보조 값)도 같은 INSERT 한 문장에 담는다(코드 리뷰: 저장마다 UPDATE 를 한
   * 번 더 하지 않게).
   */
  public MailDraftSaved insert(long userId, Fields f, QueueFields q) {
    var r =
        insertStep(userId, f, q)
            .returning(MAIL_DRAFT.ID, MAIL_DRAFT.VERSION, MAIL_DRAFT.UPDATED_AT)
            .fetchOne();
    return new MailDraftSaved(r.getId(), r.getVersion(), r.getUpdatedAt());
  }

  /**
   * 새 임시저장을 곧바로 보내기 대기(QUEUED)로 만든다(WP-1786 보내기) — 값과 대기 표시를 같은 INSERT 한 문장에 담는다(따로 UPDATE 하지 않는다).
   * 보낼 시각은 sendAt 이 있으면 그 시각(예약 발송, WP-1787), 없으면 지금(DB 시계)부터 delaySeconds 초 뒤(되돌리기 유예).
   *
   * @param sendAt 예약 시각(null 이면 즉시 보내기 — 되돌리기 유예)
   * @return 새 id 와 보낼 시각
   */
  public QueuedSend insertQueued(
      long userId, Fields f, QueueFields q, int delaySeconds, OffsetDateTime sendAt) {
    var r =
        insertStep(userId, f, q)
            .set(MAIL_DRAFT.SEND_STATE, SendState.QUEUED)
            .set(MAIL_DRAFT.SEND_AT, sendAtField(delaySeconds, sendAt))
            .set(MAIL_DRAFT.SENT_BY_SCHEDULE, sendAt != null)
            .returning(MAIL_DRAFT.ID, MAIL_DRAFT.SEND_AT)
            .fetchOne();
    return new QueuedSend(r.getId(), r.getSendAt());
  }

  /** INSERT 공통 — 저장 값과 대기열 보조 값. 발송 상태 열은 호출자가 정한다(안 정하면 기본값 = 일반 임시보관). */
  private InsertSetMoreStep<MailDraftRecord> insertStep(long userId, Fields f, QueueFields q) {
    return dsl.insertInto(MAIL_DRAFT)
        .set(MAIL_DRAFT.USER_ID, userId)
        .set(MAIL_DRAFT.ACCOUNT_ID, f.accountId())
        .set(MAIL_DRAFT.MODE, f.mode())
        .set(MAIL_DRAFT.TO_ADDRS, f.to().toArray(String[]::new))
        .set(MAIL_DRAFT.CC_ADDRS, f.cc().toArray(String[]::new))
        .set(MAIL_DRAFT.BCC_ADDRS, f.bcc().toArray(String[]::new))
        .set(MAIL_DRAFT.SUBJECT, f.subject())
        .set(MAIL_DRAFT.BODY_HTML, f.bodyHtml())
        .set(MAIL_DRAFT.PREVIEW, f.preview())
        .set(MAIL_DRAFT.SOURCE_MESSAGE_ID, f.sourceMessageId())
        .set(MAIL_DRAFT.QUOTE_REMOVED, f.quoteRemoved())
        .set(MAIL_DRAFT.BODY_TEXT, q.bodyText())
        .set(MAIL_DRAFT.IN_REPLY_TO_MESSAGE_ID, q.inReplyToMessageId())
        .set(MAIL_DRAFT.INLINE_IMAGES, toJsonb(q.inlineImages()))
        .set(MAIL_DRAFT.INLINE_UPLOADS, toJsonb(q.inlineUploads()));
  }

  /**
   * 버전이 맞을 때만 고친다(낙관적 잠금) — 버전 +1, 갱신 시각 지금, 대기열 보조 값도 같은 UPDATE 한 문장에서(코드 리뷰: 자동 저장마다 UPDATE 두 번을
   * 하지 않게). 행을 잠그므로 같은 임시저장의 동시 저장은 줄을 서고, 뒤 요청은 버전이 달라 빈 결과가 된다. 대기(QUEUED)·발송 중(SENDING) 행은 고치지
   * 않는다(WP-1786) — 일반·FAILED 만 고치고, FAILED 는 저장하면 실패 흔적을 지워 일반 임시보관으로 돌린다.
   *
   * @return 새 버전. 없거나 남의 것이거나 버전이 다르거나 대기·발송 중이면 빈 값(서비스가 {@link #sendState} 로 404·409 를 가른다)
   */
  public Optional<MailDraftVersion> updateIfVersion(
      long userId, long draftId, int expectedVersion, Fields f, QueueFields q) {
    return updateStep(f, q)
        // 실패한 행을 저장하면 실패 흔적을 지워 일반 임시보관으로 돌린다.
        .set(MAIL_DRAFT.SEND_STATE, (String) null)
        .set(MAIL_DRAFT.SEND_ERROR, (String) null)
        .where(idleOwned(userId, draftId))
        .and(MAIL_DRAFT.VERSION.eq(expectedVersion))
        .returning(MAIL_DRAFT.VERSION, MAIL_DRAFT.UPDATED_AT)
        .fetchOptional()
        .map(r -> MailDraftVersion.of(r.getVersion(), r.getUpdatedAt()));
  }

  /**
   * 보내기가 내 일반·FAILED 임시보관을 이어받아 곧바로 보내기 대기(QUEUED)로 만든다(WP-1786) — 버전 검사 없이 값을 고치고(버전 +1) 이전 실패 흔적을
   * 지우며, 보낼 시각을 같은 UPDATE 한 문장에서 표시한다 — sendAt 이 있으면 그 시각(예약 발송, WP-1787), 없으면 지금(DB 시계)부터
   * delaySeconds 초 뒤.
   *
   * <p>보낼 시각을 DB 시계로 계산하는 이유: 스케줄러의 잡기·멈춤 정리가 DB now() 와 비교하므로, 앱 서버와 DB 의 시계가 어긋나도 되돌리기 유예가 줄거나 늘지
   * 않게(코드 리뷰).
   *
   * @return DB 가 정한 보낼 시각. 없거나 남의 것이거나 이미 대기·발송 중이면 빈 값
   */
  public Optional<OffsetDateTime> updateQueued(
      long userId, long draftId, Fields f, QueueFields q, int delaySeconds, OffsetDateTime sendAt) {
    return updateStep(f, q)
        .set(MAIL_DRAFT.SEND_STATE, SendState.QUEUED)
        .set(MAIL_DRAFT.SEND_ERROR, (String) null)
        .set(MAIL_DRAFT.SEND_AT, sendAtField(delaySeconds, sendAt))
        .set(MAIL_DRAFT.SENDING_STARTED_AT, (OffsetDateTime) null)
        .set(MAIL_DRAFT.SENT_BY_SCHEDULE, sendAt != null)
        .where(idleOwned(userId, draftId))
        .returning(MAIL_DRAFT.SEND_AT)
        .fetchOptional(MAIL_DRAFT.SEND_AT);
  }

  /** UPDATE 공통 — 저장 값·대기열 보조 값·버전 +1·갱신 시각. 발송 상태 열과 조건은 호출자가 붙인다. */
  private UpdateSetMoreStep<MailDraftRecord> updateStep(Fields f, QueueFields q) {
    return dsl.update(MAIL_DRAFT)
        .set(MAIL_DRAFT.ACCOUNT_ID, f.accountId())
        .set(MAIL_DRAFT.MODE, f.mode())
        .set(MAIL_DRAFT.TO_ADDRS, f.to().toArray(String[]::new))
        .set(MAIL_DRAFT.CC_ADDRS, f.cc().toArray(String[]::new))
        .set(MAIL_DRAFT.BCC_ADDRS, f.bcc().toArray(String[]::new))
        .set(MAIL_DRAFT.SUBJECT, f.subject())
        .set(MAIL_DRAFT.BODY_HTML, f.bodyHtml())
        .set(MAIL_DRAFT.PREVIEW, f.preview())
        .set(MAIL_DRAFT.SOURCE_MESSAGE_ID, f.sourceMessageId())
        .set(MAIL_DRAFT.QUOTE_REMOVED, f.quoteRemoved())
        .set(MAIL_DRAFT.BODY_TEXT, q.bodyText())
        .set(MAIL_DRAFT.IN_REPLY_TO_MESSAGE_ID, q.inReplyToMessageId())
        .set(MAIL_DRAFT.INLINE_IMAGES, toJsonb(q.inlineImages()))
        .set(MAIL_DRAFT.INLINE_UPLOADS, toJsonb(q.inlineUploads()))
        .set(MAIL_DRAFT.VERSION, MAIL_DRAFT.VERSION.plus(1))
        .set(MAIL_DRAFT.UPDATED_AT, DSL.currentOffsetDateTime());
  }

  /** 내 행이고 보내는 중이 아님(일반·FAILED) — 고치기·대기 올리기가 같은 조건을 쓴다. */
  private static Condition idleOwned(long userId, long draftId) {
    return MAIL_DRAFT.ID.eq(draftId).and(MAIL_DRAFT.USER_ID.eq(userId)).and(idle());
  }

  /** 보내는 중이 아님(send_state NULL·FAILED) — {@link SendState#isInFlight} 의 반대를 SQL 로. */
  private static Condition idle() {
    return MAIL_DRAFT.SEND_STATE.isNull().or(MAIL_DRAFT.SEND_STATE.eq(SendState.FAILED));
  }

  /** 보낼 시각 값 — 예약 시각이 있으면 그대로, 없으면 DB 시계 지금 + 유예(초). */
  private static Field<OffsetDateTime> sendAtField(int delaySeconds, OffsetDateTime sendAt) {
    return sendAt != null ? DSL.val(sendAt) : dbNowPlusSeconds(delaySeconds);
  }

  /** DB 시계 기준 지금 + seconds 초 — 보낼 시각을 앱 시계와 섞지 않는다. */
  private static Field<OffsetDateTime> dbNowPlusSeconds(int seconds) {
    return DSL.field("now() + make_interval(secs => {0})", OffsetDateTime.class, DSL.val(seconds));
  }

  /**
   * 내 임시저장의 발송 상태를 행 잠금(FOR UPDATE)과 함께 읽는다 — 스케줄러 claimDue 는 SKIP LOCKED 라 잠긴 행을 건너뛰므로, 호출자 트랜잭션이
   * 끝날 때까지 확인한 상태가 바뀌지 않는다. 반환 규칙은 {@link #sendState} 와 같다.
   */
  public Optional<String> lockSendState(long userId, long draftId) {
    return readSendState(userId, draftId, true);
  }

  /** 목록을 JSONB 로 — null 은 빈 배열로 본다(NOT NULL 열). */
  private JSONB toJsonb(List<?> list) {
    return JSONB.valueOf(objectMapper.writeValueAsString(list == null ? List.of() : list));
  }

  /** JSONB 배열을 목록으로 — 값이 없으면 빈 목록. */
  private <T> List<T> fromJsonb(JSONB json, TypeReference<List<T>> type) {
    if (json == null) {
      return List.of();
    }
    return objectMapper.readValue(json.data(), type);
  }

  /** 예약 발송 대기 행 조건 — QUEUED 이고 예약으로 올린 것(WP-1787). 즉시 보내기 되돌리기 대기·SENDING 은 아니다. */
  private static Condition scheduledRow() {
    return MAIL_DRAFT.SEND_STATE.eq(SendState.QUEUED).and(MAIL_DRAFT.SENT_BY_SCHEDULE.isTrue());
  }

  /** 내 예약 발송 대기 행 조건 — {@link #scheduledRow()} 에 내 행만. */
  private static Condition scheduledOf(long userId) {
    return MAIL_DRAFT.USER_ID.eq(userId).and(scheduledRow());
  }

  /** 목록 한 줄의 첨부 수 — 묶인 업로드 + 아직 남아 있는 전달 원본 첨부(상관 부분 쿼리 둘의 합). 임시보관·예약 목록이 같은 값을 쓴다. */
  private static Field<Integer> attachmentCount() {
    Field<Integer> uploads =
        DSL.field(
            DSL.selectCount()
                .from(MAIL_DRAFT_ATTACHMENT)
                .where(MAIL_DRAFT_ATTACHMENT.DRAFT_ID.eq(MAIL_DRAFT.ID)));
    Field<Integer> forwards =
        DSL.field(
            DSL.selectCount()
                .from(MAIL_DRAFT_FORWARD)
                .where(MAIL_DRAFT_FORWARD.DRAFT_ID.eq(MAIL_DRAFT.ID)));
    return uploads.plus(forwards).as("attachment_count");
  }

  /** DB 시계의 지금 — 예약 시각 검사(1분 뒤 이후)를 앱 시계와 섞지 않고 스케줄러와 같은 시계로 한다(WP-1787). */
  public OffsetDateTime dbNow() {
    return dsl.select(DSL.currentOffsetDateTime()).fetchOne().value1();
  }

  /**
   * 사용자별 예약 상한 검사를 한 줄로 세우는 트랜잭션 advisory 락(WP-1787) — 같은 사용자의 동시 예약이 센 뒤 넣는 사이에 끼어 100건을 넘지 않게 한다.
   * 키는 2-인자(기능 이름 해시, 사용자 id)라 다른 기능의 락과 겹치지 않는다. 호출자 트랜잭션이 끝나면 풀린다.
   */
  public void lockScheduleQuota(long userId) {
    dsl.execute("SELECT pg_advisory_xact_lock(hashtext('mail-schedule'), ?)", (int) userId);
  }

  /**
   * 내 예약 발송 대기 수(전 계정, 상한 100건 검사용, WP-1787).
   *
   * @param excludeDraftId 세지 않을 행(다시 예약하는 자기 행) — null 이면 모두 센다
   */
  public int countScheduledByUser(long userId, Long excludeDraftId) {
    Condition cond = scheduledOf(userId);
    if (excludeDraftId != null) {
      cond = cond.and(MAIL_DRAFT.ID.ne(excludeDraftId));
    }
    return dsl.fetchCount(MAIL_DRAFT, cond);
  }

  /**
   * 예약 행을 지금 보내도록 보낼 시각을 지금(DB 시계)으로 당긴다(WP-1787 바로 보내기) — 내 QUEUED 예약 행만. 스케줄러가 다음 틱에 집는다.
   *
   * @return 새 보낼 시각. 예약 행이 아니거나(남의 것·없음·즉시 대기·발송 중·일반) 빈 값
   */
  public Optional<OffsetDateTime> sendScheduledNow(long userId, long draftId) {
    return dsl.update(MAIL_DRAFT)
        .set(MAIL_DRAFT.SEND_AT, DSL.currentOffsetDateTime())
        .where(MAIL_DRAFT.ID.eq(draftId))
        .and(scheduledOf(userId))
        .returning(MAIL_DRAFT.SEND_AT)
        .fetchOptional(MAIL_DRAFT.SEND_AT);
  }

  /** 예약 발송 목록(WP-1787) — 내 계정의 예약 대기 행을 보낼 시각 오름차순(같으면 id 오름차순)으로 limit 건. 본문 HTML 은 읽지 않는다. */
  public List<MailScheduledSummary> listScheduled(long userId, long accountId, int limit) {
    Field<Integer> attachments = attachmentCount();
    return dsl.select(
            MAIL_DRAFT.ID,
            MAIL_DRAFT.ACCOUNT_ID,
            MAIL_DRAFT.MODE,
            MAIL_DRAFT.TO_ADDRS,
            MAIL_DRAFT.SUBJECT,
            MAIL_DRAFT.PREVIEW,
            MAIL_DRAFT.UPDATED_AT,
            MAIL_DRAFT.SEND_AT,
            attachments)
        .from(MAIL_DRAFT)
        .where(scheduledOf(userId))
        .and(MAIL_DRAFT.ACCOUNT_ID.eq(accountId))
        .orderBy(MAIL_DRAFT.SEND_AT, MAIL_DRAFT.ID)
        .limit(limit)
        .fetch(
            r ->
                new MailScheduledSummary(
                    r.get(MAIL_DRAFT.ID),
                    r.get(MAIL_DRAFT.ACCOUNT_ID),
                    r.get(MAIL_DRAFT.MODE),
                    List.of(r.get(MAIL_DRAFT.TO_ADDRS)),
                    r.get(MAIL_DRAFT.SUBJECT),
                    r.get(MAIL_DRAFT.PREVIEW),
                    r.get(attachments),
                    r.get(MAIL_DRAFT.UPDATED_AT),
                    r.get(MAIL_DRAFT.SEND_AT)));
  }

  /**
   * 되돌리기 — 아직 대기(QUEUED)일 때만 대기를 풀어 일반 임시저장으로 돌린다. 이미 스케줄러가 집었으면(SENDING) 늦은 것이라 건드리지 않는다.
   *
   * <p>예약 행(WP-1787)은 보낼 시각이 이미 지났으면(DB 시계) 풀지 않는다 — 「바로 보내기」로 당긴 행은 곧 스케줄러가 집으므로, 그 틈에 열기·예약 취소가
   * 방금 보낸 메일을 되돌리지 않게 한다(코드 리뷰). 즉시 보내기의 되돌리기 대기(WP-1786)는 이 조건을 걸지 않아 지금처럼 집히기 전까지 풀 수 있다.
   *
   * @return 풀었으면 true, 대기가 아니거나 남의 것이거나 보낼 때가 된 예약 행이면 false
   */
  public boolean cancelQueued(long userId, long draftId) {
    return dsl.update(MAIL_DRAFT)
            .set(MAIL_DRAFT.SEND_AT, (OffsetDateTime) null)
            .set(MAIL_DRAFT.SEND_STATE, (String) null)
            .where(MAIL_DRAFT.ID.eq(draftId))
            .and(MAIL_DRAFT.USER_ID.eq(userId))
            .and(MAIL_DRAFT.SEND_STATE.eq(SendState.QUEUED))
            .and(
                MAIL_DRAFT
                    .SENT_BY_SCHEDULE
                    .isFalse()
                    .or(MAIL_DRAFT.SEND_AT.gt(DSL.currentOffsetDateTime())))
            .execute()
        > 0;
  }

  /**
   * 내 임시저장의 발송 상태 — 행이 없으면(남의 것 포함) empty, 일반 임시보관(send_state NULL)이면 빈 문자열, 아니면
   * QUEUED·SENDING·FAILED.
   */
  public Optional<String> sendState(long userId, long draftId) {
    return readSendState(userId, draftId, false);
  }

  /** 발송 상태 읽기 공통 — lock 이면 행을 FOR UPDATE 로 잠근다. NULL(일반)은 빈 문자열로. */
  private Optional<String> readSendState(long userId, long draftId, boolean lock) {
    var select =
        dsl.select(MAIL_DRAFT.SEND_STATE)
            .from(MAIL_DRAFT)
            .where(MAIL_DRAFT.ID.eq(draftId))
            .and(MAIL_DRAFT.USER_ID.eq(userId));
    return (lock ? select.forUpdate().fetchOptional() : select.fetchOptional())
        .map(r -> r.value1() == null ? "" : r.value1());
  }

  /**
   * 때가 된 대기 행을 집는다 — send_at 순으로 limit 건을 FOR UPDATE SKIP LOCKED 로 잠가(여러 파드·틱이 겹쳐도 한 행은 한 곳만 집는다)
   * SENDING·sending_started_at=지금 으로 바꾼다. 고르기와 바꾸기를 UPDATE … WHERE id IN (SELECT … SKIP LOCKED)
   * RETURNING 한 문장으로 한다(왕복 한 번). 호출자의 트랜잭션 안에서 불러야 잠금이 유지된다.
   *
   * @return 집은 draft id(send_at 순 — RETURNING 은 순서를 보장하지 않아 받은 send_at 으로 다시 정렬한다)
   */
  public List<Long> claimDue(int limit) {
    var due =
        DSL.select(MAIL_DRAFT.ID)
            .from(MAIL_DRAFT)
            .where(MAIL_DRAFT.SEND_STATE.eq(SendState.QUEUED))
            .and(MAIL_DRAFT.SEND_AT.le(DSL.currentOffsetDateTime()))
            .orderBy(MAIL_DRAFT.SEND_AT, MAIL_DRAFT.ID)
            .limit(limit)
            .forUpdate()
            .skipLocked();
    return dsl
        .update(MAIL_DRAFT)
        .set(MAIL_DRAFT.SEND_STATE, SendState.SENDING)
        .set(MAIL_DRAFT.SENDING_STARTED_AT, DSL.currentOffsetDateTime())
        .where(MAIL_DRAFT.ID.in(due))
        .returning(MAIL_DRAFT.ID, MAIL_DRAFT.SEND_AT)
        .fetch()
        .stream()
        .sorted(
            Comparator.comparing(MailDraftRecord::getSendAt).thenComparing(MailDraftRecord::getId))
        .map(MailDraftRecord::getId)
        .toList();
  }

  /**
   * 잡았지만 아직 보내기 시작하지 않은 행을 대기(QUEUED)로 되돌린다(WP-1786 코드 리뷰) — 스케줄러가 한 회차의 시간 예산을 다 써 남은 행을 다음 회차로 넘길
   * 때 쓴다. 잡기 때 찍은 sending_started_at 이 그대로 SENDING 에 남으면 멈춤 정리(10분)가 한 번도 보내지 않은 메일을 「보냈는지 확인하지
   * 못함」으로 돌린다. send_at 은 그대로라 다음 회차가 가장 먼저 집는다. SENDING 인 행만 바꾼다(그 사이 다른 상태로 바뀐 행은 건드리지 않는다).
   *
   * @return 되돌린 행 수
   */
  public int releaseClaimed(Collection<Long> draftIds) {
    if (draftIds.isEmpty()) {
      return 0;
    }
    return dsl.update(MAIL_DRAFT)
        .set(MAIL_DRAFT.SEND_STATE, SendState.QUEUED)
        .set(MAIL_DRAFT.SENDING_STARTED_AT, (OffsetDateTime) null)
        .where(MAIL_DRAFT.ID.in(draftIds))
        .and(MAIL_DRAFT.SEND_STATE.eq(SendState.SENDING))
        .execute();
  }

  /**
   * 이 행의 전송을 지금 시작한다 — sending_started_at 을 DB now() 로 다시 찍으며 보낼 값을 같은 UPDATE … RETURNING 으로 읽는다(왕복
   * 한 번, 묶인 첨부 id 만 따로 읽는다). 소유 조건 없이 id 로 찾는다(스케줄러에는 사용자 문맥이 없다).
   *
   * <p>다시 찍는 이유(코드 리뷰): 잡기(claimDue)는 한 회차의 행을 한꺼번에 찍지만 전송은 하나씩 차례로 하므로, 앞 행들이 오래 걸리면 아직 손대지 않은 행이
   * 멈춤 정리(10분)에 걸려 「확인하지 못함」으로 바뀔 수 있다. 전송 직전에 행마다 다시 찍어 멈춤 시계가 실제 전송 시작부터 돌게 한다(잡기 때 찍은 값은 그대로 두어,
   * 보내기 전에 파드가 죽은 행도 멈춤 정리가 잡는다).
   *
   * <p>발송 중(SENDING)인 행만 — 잡지 않은 대기 행, 그 사이 멈춤 정리가 실패로 돌렸거나 지워진 행이면 빈 값이라 호출자가 보내지 않는다.
   */
  public Optional<QueuedRow> startSend(long draftId) {
    return dsl.update(MAIL_DRAFT)
        .set(MAIL_DRAFT.SENDING_STARTED_AT, DSL.currentOffsetDateTime())
        .where(MAIL_DRAFT.ID.eq(draftId))
        .and(MAIL_DRAFT.SEND_STATE.eq(SendState.SENDING))
        .returning()
        .fetchOptional()
        .map(
            r ->
                new QueuedRow(
                    r.getId(),
                    r.getUserId(),
                    r.getAccountId(),
                    List.of(r.getToAddrs()),
                    List.of(r.getCcAddrs()),
                    List.of(r.getBccAddrs()),
                    r.getSubject(),
                    r.getBodyHtml(),
                    r.getBodyText(),
                    r.getInReplyToMessageId(),
                    fromJsonb(r.getInlineImages(), new TypeReference<List<InlineImageRef>>() {}),
                    fromJsonb(r.getInlineUploads(), new TypeReference<List<InlineUploadRef>>() {}),
                    boundFileIds(r.getId()),
                    forwardIds(r.getId())));
  }

  /**
   * 너무 오래 SENDING 인 행을 실패로 돌린다 — 발송 중 프로세스가 죽으면 SENDING 에 영영 머문다. 실제로 갔는지 알 수 없어 재시도하지 않고(중복 발송 방지)
   * FAILED·send_error='UNKNOWN' 으로 두어 사용자가 확인하게 한다.
   *
   * @return 실패로 돌린 행(알림용)
   */
  public List<StuckRow> failStuck(Duration olderThan) {
    // Duration → 초 단위 interval. 앱 시각이 아니라 DB 시계 기준(sending_started_at 도 DB now() 로 찍는다).
    return dsl.update(MAIL_DRAFT)
        .set(MAIL_DRAFT.SEND_STATE, SendState.FAILED)
        .set(MAIL_DRAFT.SEND_ERROR, SendState.UNKNOWN_ERROR)
        .set(MAIL_DRAFT.SEND_AT, (OffsetDateTime) null)
        .where(MAIL_DRAFT.SEND_STATE.eq(SendState.SENDING))
        .and(
            MAIL_DRAFT.SENDING_STARTED_AT.lt(
                DSL.field(
                    "now() - make_interval(secs => {0})",
                    OffsetDateTime.class, DSL.val(olderThan.toMillis() / 1000.0))))
        .returning(MAIL_DRAFT.ID, MAIL_DRAFT.USER_ID, MAIL_DRAFT.SUBJECT)
        .fetch(r -> new StuckRow(r.getId(), r.getUserId(), r.getSubject()));
  }

  /**
   * 발송 실패 기록 — 대기(send_at)를 풀고 FAILED·사유를 남긴다. 행은 임시저장으로 다시 보인다. 발송 중(SENDING)인 행만 바꾼다 — 그 사이 지워졌거나
   * 다른 상태로 바뀐 행을 늦은 실패 기록이 덮어쓰지 않게.
   *
   * @return 바꿨으면 true
   */
  public boolean markFailed(long draftId, String error) {
    return dsl.update(MAIL_DRAFT)
            .set(MAIL_DRAFT.SEND_AT, (OffsetDateTime) null)
            .set(MAIL_DRAFT.SEND_STATE, SendState.FAILED)
            .set(MAIL_DRAFT.SEND_ERROR, error)
            .where(MAIL_DRAFT.ID.eq(draftId))
            .and(MAIL_DRAFT.SEND_STATE.eq(SendState.SENDING))
            .execute()
        > 0;
  }

  /** 내 계정의 임시저장 목록 — 갱신 최신순(같으면 id 큰 것 먼저), 최대 limit 건. 본문 HTML 은 읽지 않는다. */
  public List<MailDraftSummary> listByAccount(long userId, long accountId, int limit) {
    Field<Integer> attachments = attachmentCount();
    return dsl.select(
            MAIL_DRAFT.ID,
            MAIL_DRAFT.ACCOUNT_ID,
            MAIL_DRAFT.MODE,
            MAIL_DRAFT.TO_ADDRS,
            MAIL_DRAFT.SUBJECT,
            MAIL_DRAFT.PREVIEW,
            MAIL_DRAFT.UPDATED_AT,
            attachments)
        .from(MAIL_DRAFT)
        .where(MAIL_DRAFT.USER_ID.eq(userId))
        .and(MAIL_DRAFT.ACCOUNT_ID.eq(accountId))
        // 대기 중(send_at 있음)인 행은 임시저장 목록에 보이지 않는다 — 일반·FAILED 만.
        .and(MAIL_DRAFT.SEND_AT.isNull())
        .orderBy(MAIL_DRAFT.UPDATED_AT.desc(), MAIL_DRAFT.ID.desc())
        .limit(limit)
        .fetch(
            r ->
                new MailDraftSummary(
                    r.get(MAIL_DRAFT.ID),
                    r.get(MAIL_DRAFT.ACCOUNT_ID),
                    r.get(MAIL_DRAFT.MODE),
                    List.of(r.get(MAIL_DRAFT.TO_ADDRS)),
                    r.get(MAIL_DRAFT.SUBJECT),
                    r.get(MAIL_DRAFT.PREVIEW),
                    r.get(attachments),
                    r.get(MAIL_DRAFT.UPDATED_AT)));
  }

  /**
   * 내 계정의 임시저장 개수(배지)와 보내기 대기 수(WP-1786)를 한 쿼리로 — 대기 중(send_at 있음)인 행은 임시저장 수에 세지 않고(일반·FAILED 만)
   * 대기 수로 센다(QUEUED·SENDING).
   */
  public MailDraftCount countByAccount(long userId, long accountId) {
    Field<Integer> drafts = DSL.count().filterWhere(MAIL_DRAFT.SEND_AT.isNull());
    Field<Integer> queued = DSL.count().filterWhere(MAIL_DRAFT.SEND_AT.isNotNull());
    // 예약(WP-1787) — 대기 중이면서 예약으로 올린 것만. 즉시 보내기 되돌리기 대기·발송 중은 세지 않는다.
    Condition isScheduled = scheduledRow();
    Field<Integer> scheduled = DSL.count().filterWhere(isScheduled);
    // 가장 이른 예약 시각(코드 리뷰) — 웹이 그 시각 근처에서만 다시 받게(예약이 있다고 늘 30초마다 받지 않게).
    Field<OffsetDateTime> nextSendAt = DSL.min(MAIL_DRAFT.SEND_AT).filterWhere(isScheduled);
    var r =
        dsl.select(drafts, queued, scheduled, nextSendAt)
            .from(MAIL_DRAFT)
            .where(MAIL_DRAFT.USER_ID.eq(userId))
            .and(MAIL_DRAFT.ACCOUNT_ID.eq(accountId))
            .fetchOne();
    return new MailDraftCount(r.value1(), r.value2(), r.value3(), r.value4());
  }

  /**
   * 내 임시저장 상세 — 보통은 계정이 비활성(삭제 대기)이면 없는 것으로 본다(목록과 같은 기준).
   *
   * @param includeDisabledAccount true 면 계정이 비활성(삭제 대기)이어도 읽는다 — 되돌리기(cancel)가 방금 대기를 푼 행을 돌려줄 때만
   *     쓴다(코드 리뷰: 읽기가 404 로 실패해 대기 풀기까지 롤백되면 행이 QUEUED 로 남는다)
   */
  public Optional<DraftRow> findOwned(long userId, long draftId, boolean includeDisabledAccount) {
    var cond = MAIL_DRAFT.ID.eq(draftId).and(MAIL_DRAFT.USER_ID.eq(userId));
    if (!includeDisabledAccount) {
      cond = cond.and(EMAIL_ACCOUNT.DISABLED_AT.isNull());
    }
    return dsl.select(MAIL_DRAFT.fields())
        .from(MAIL_DRAFT)
        .join(EMAIL_ACCOUNT)
        .on(EMAIL_ACCOUNT.ID.eq(MAIL_DRAFT.ACCOUNT_ID))
        .where(cond)
        .fetchOptional(
            r ->
                new DraftRow(
                    r.get(MAIL_DRAFT.ID),
                    r.get(MAIL_DRAFT.ACCOUNT_ID),
                    r.get(MAIL_DRAFT.MODE),
                    List.of(r.get(MAIL_DRAFT.TO_ADDRS)),
                    List.of(r.get(MAIL_DRAFT.CC_ADDRS)),
                    List.of(r.get(MAIL_DRAFT.BCC_ADDRS)),
                    r.get(MAIL_DRAFT.SUBJECT),
                    r.get(MAIL_DRAFT.BODY_HTML),
                    r.get(MAIL_DRAFT.SOURCE_MESSAGE_ID),
                    r.get(MAIL_DRAFT.QUOTE_REMOVED),
                    r.get(MAIL_DRAFT.VERSION),
                    r.get(MAIL_DRAFT.UPDATED_AT),
                    r.get(MAIL_DRAFT.BODY_TEXT),
                    r.get(MAIL_DRAFT.IN_REPLY_TO_MESSAGE_ID),
                    fromJsonb(
                        r.get(MAIL_DRAFT.INLINE_IMAGES),
                        new TypeReference<List<InlineImageRef>>() {}),
                    fromJsonb(
                        r.get(MAIL_DRAFT.INLINE_UPLOADS),
                        new TypeReference<List<InlineUploadRef>>() {}),
                    r.get(MAIL_DRAFT.SEND_STATE),
                    r.get(MAIL_DRAFT.SEND_ERROR)));
  }

  /** 임시저장에 묶인 업로드 file id — 묶은 순서. */
  public List<Long> boundFileIds(long draftId) {
    return dsl.select(MAIL_DRAFT_ATTACHMENT.FILE_ID)
        .from(MAIL_DRAFT_ATTACHMENT)
        .where(MAIL_DRAFT_ATTACHMENT.DRAFT_ID.eq(draftId))
        .orderBy(MAIL_DRAFT_ATTACHMENT.ID)
        .fetch(MAIL_DRAFT_ATTACHMENT.FILE_ID);
  }

  /**
   * 파일을 내 임시저장(어느 것이든) 정션에서 빼고 만료를 expiresAt 으로 건다 — 저장이 내 다른 임시저장의 업로드를 옮겨 묶기 전(임시로 풀어 평범한 클레임을
   * 받게), 발송 성공 뒤(보낸 업로드를 남은 임시저장에서 빼기) 같은 정의로 쓴다. 만료는 ATTACHMENT 범주만 바꾼다 — 보류(발송 중·소비)된 파일은 그대로라
   * 저장의 뒤이은 클레임이 거절한다. 남의 임시저장·남의 파일은 건드리지 않는다.
   */
  public void releaseFromOwnedDrafts(
      long userId, Collection<Long> fileIds, OffsetDateTime expiresAt) {
    if (fileIds.isEmpty()) {
      return;
    }
    var ownedDraftIds =
        DSL.select(MAIL_DRAFT.ID).from(MAIL_DRAFT).where(MAIL_DRAFT.USER_ID.eq(userId));
    dsl.update(FILE)
        .set(FILE.EXPIRES_AT, expiresAt)
        .where(FILE.ID.in(fileIds))
        .and(FILE.UPLOADED_BY.eq(userId))
        .and(FILE.CATEGORY.eq(StagedFileClaimer.CATEGORY_ATTACHMENT))
        .and(
            FILE.ID.in(
                DSL.select(MAIL_DRAFT_ATTACHMENT.FILE_ID)
                    .from(MAIL_DRAFT_ATTACHMENT)
                    .where(MAIL_DRAFT_ATTACHMENT.DRAFT_ID.in(ownedDraftIds))))
        .execute();
    dsl.deleteFrom(MAIL_DRAFT_ATTACHMENT)
        .where(MAIL_DRAFT_ATTACHMENT.FILE_ID.in(fileIds))
        .and(MAIL_DRAFT_ATTACHMENT.DRAFT_ID.in(ownedDraftIds))
        .execute();
  }

  /** 업로드를 임시저장에 묶는다(호출자가 같은 트랜잭션에서 먼저 PERMANENT 클레임해야 한다). */
  public void bindFiles(long draftId, List<Long> fileIds) {
    if (fileIds.isEmpty()) {
      return;
    }
    var insert =
        dsl.insertInto(
            MAIL_DRAFT_ATTACHMENT, MAIL_DRAFT_ATTACHMENT.DRAFT_ID, MAIL_DRAFT_ATTACHMENT.FILE_ID);
    for (Long id : fileIds) {
      insert = insert.values(draftId, id);
    }
    insert.execute();
  }

  /**
   * 임시저장에서 빠진 업로드를 풀어 다시 임시 파일로 만든다 — 만료 = expiresAt(보통 지금 + 24시간), 정션 행 삭제. 보류(발송 중) 파일은 건드리지 않고
   * 묶인 채 둔다 — 풀면 그 발송이 실패해 보류가 되돌려질 때 만료 없는 고아가 된다.
   *
   * @return 실제로 푼 파일 id
   */
  public List<Long> releaseFiles(
      long userId, long draftId, Collection<Long> fileIds, OffsetDateTime expiresAt) {
    if (fileIds.isEmpty()) {
      return List.of();
    }
    List<Long> released =
        dsl.update(FILE)
            .set(FILE.EXPIRES_AT, expiresAt)
            .where(FILE.ID.in(fileIds))
            .and(FILE.UPLOADED_BY.eq(userId))
            .and(FILE.CATEGORY.eq(StagedFileClaimer.CATEGORY_ATTACHMENT))
            .and(
                FILE.ID.in(
                    DSL.select(MAIL_DRAFT_ATTACHMENT.FILE_ID)
                        .from(MAIL_DRAFT_ATTACHMENT)
                        .where(MAIL_DRAFT_ATTACHMENT.DRAFT_ID.eq(draftId))))
            .returning(FILE.ID)
            .fetch(FILE.ID);
    if (!released.isEmpty()) {
      dsl.deleteFrom(MAIL_DRAFT_ATTACHMENT)
          .where(MAIL_DRAFT_ATTACHMENT.DRAFT_ID.eq(draftId))
          .and(MAIL_DRAFT_ATTACHMENT.FILE_ID.in(released))
          .execute();
    }
    return released;
  }

  /**
   * 내 임시저장을 상태와 상관없이 지운다(발송 성공 뒤 정리 — 대기열이 SENDING 으로 보낸 행도 지워야 한다). 지우는 방식은 {@link #deleteLocked}.
   *
   * @param expiresAt 묶였던 업로드에 걸 만료 시각
   * @return 지웠으면 true, 없거나 남의 것이면 false
   */
  public boolean deleteOwned(long userId, long draftId, OffsetDateTime expiresAt) {
    // 행을 먼저 잠가 같은 임시저장의 동시 저장(새 업로드 묶기)·스케줄러 잡기(SKIP LOCKED)와 엇갈리지 않게 한다.
    if (lockSendState(userId, draftId).isEmpty()) {
      return false;
    }
    deleteLocked(userId, draftId, expiresAt);
    return true;
  }

  /**
   * 내 임시저장을 보내는 중이 아닐 때만 지운다(사용자의 버리기) — 잠금은 한 번: 행을 FOR UPDATE 로 읽으며 발송 상태도 함께 본다(코드 리뷰: 상태용 잠금
   * SELECT 를 따로 하지 않는다). 보내는 중(QUEUED·SENDING)인 행은 지우지 않는다 — 되돌리기는 별도 취소 경로다.
   *
   * @param expiresAt 묶였던 업로드에 걸 만료 시각
   * @return 지웠으면 DELETED, 없거나 남의 것이면 NOT_FOUND, 보내는 중이라 거절했으면 SENDING
   */
  public DeleteResult deleteOwnedIfIdle(long userId, long draftId, OffsetDateTime expiresAt) {
    Optional<String> state = lockSendState(userId, draftId);
    if (state.isEmpty()) {
      return DeleteResult.NOT_FOUND;
    }
    if (SendState.isInFlight(state.get())) {
      return DeleteResult.SENDING;
    }
    deleteLocked(userId, draftId, expiresAt);
    return DeleteResult.DELETED;
  }

  /**
   * 잠근 행을 지운다 — 묶인 업로드에 expiresAt 만료를 걸어 만료 스윕이 정리하게 하고(보류 중인 것은 그 발송이 정리한다), 정션은 CASCADE 로 사라진다.
   * 사용자가 버린 것은 「되돌리기」가 같은 업로드로 다시 만들 수 있게 임시 수명(24시간)을, 발송 뒤 정리는 지금을 넘긴다.
   */
  private void deleteLocked(long userId, long draftId, OffsetDateTime expiresAt) {
    dsl.update(FILE)
        // 앱 시각 기준 만료(호출자가 계산) — 만료 스윕·클레임 판정이 앱 시각(OffsetDateTime.now())과 비교하므로 DB 시계와 섞지 않는다.
        .set(FILE.EXPIRES_AT, expiresAt)
        .where(FILE.UPLOADED_BY.eq(userId))
        .and(FILE.CATEGORY.eq(StagedFileClaimer.CATEGORY_ATTACHMENT))
        .and(
            FILE.ID.in(
                DSL.select(MAIL_DRAFT_ATTACHMENT.FILE_ID)
                    .from(MAIL_DRAFT_ATTACHMENT)
                    .where(MAIL_DRAFT_ATTACHMENT.DRAFT_ID.eq(draftId))))
        .execute();
    dsl.deleteFrom(MAIL_DRAFT).where(MAIL_DRAFT.ID.eq(draftId)).execute();
  }

  /** {@link #deleteOwnedIfIdle} 결과. */
  public enum DeleteResult {
    /** 지웠다. */
    DELETED,
    /** 없거나 남의 것. */
    NOT_FOUND,
    /** 보내는 중(QUEUED·SENDING)이라 지우지 않았다. */
    SENDING
  }

  /**
   * 계정 하드 삭제 전 정리 — 그 계정 임시저장에 묶인 업로드를 지금 만료시킨다. 하드 삭제의 CASCADE 는 정션만 지우고 FILE 은 영구로 남기므로, 먼저 만료를
   * 걸어야 만료 스윕이 지운다. AccountPurgeService 의 트랜잭션 안에서 부른다.
   */
  public int expireBoundFilesOfAccount(long accountId) {
    return dsl.update(FILE)
        // 앱 시각으로 만료 — 만료 스윕·클레임 판정이 앱 시각(OffsetDateTime.now())과 비교하므로 DB 시계와 섞지 않는다.
        .set(FILE.EXPIRES_AT, OffsetDateTime.now())
        .where(FILE.CATEGORY.eq(StagedFileClaimer.CATEGORY_ATTACHMENT))
        .and(
            FILE.ID.in(
                DSL.select(MAIL_DRAFT_ATTACHMENT.FILE_ID)
                    .from(MAIL_DRAFT_ATTACHMENT)
                    .join(MAIL_DRAFT)
                    .on(MAIL_DRAFT.ID.eq(MAIL_DRAFT_ATTACHMENT.DRAFT_ID))
                    .where(MAIL_DRAFT.ACCOUNT_ID.eq(accountId))))
        .execute();
  }

  /**
   * 묶임이 사라진 영구 업로드를 다시 임시로 — 발송 실패로 보류를 되돌렸는데(원래 만료 NULL) 그 사이 임시저장이 지워졌거나 그 파일이 빠졌으면, 만료 없는 고아가 되지
   * 않게 만료를 건다. 아직 묶여 있으면 그대로 둔다.
   */
  public int expireUnboundPermanent(long userId, Collection<Long> fileIds, OffsetDateTime at) {
    if (fileIds.isEmpty()) {
      return 0;
    }
    return dsl.update(FILE)
        .set(FILE.EXPIRES_AT, at)
        .where(FILE.ID.in(fileIds))
        .and(FILE.UPLOADED_BY.eq(userId))
        .and(FILE.CATEGORY.eq(StagedFileClaimer.CATEGORY_ATTACHMENT))
        .and(FILE.EXPIRES_AT.isNull())
        .andNotExists(
            DSL.selectOne()
                .from(MAIL_DRAFT_ATTACHMENT)
                .where(MAIL_DRAFT_ATTACHMENT.FILE_ID.eq(FILE.ID)))
        .execute();
  }

  /** 상세의 업로드 첨부 — 묶은 순서. */
  public List<Attachment> uploadAttachments(long draftId) {
    return dsl.select(FILE.ID, FILE.ORIGINAL_NAME, FILE.SIZE_BYTES, FILE.MIME_TYPE)
        .from(MAIL_DRAFT_ATTACHMENT)
        .join(FILE)
        .on(FILE.ID.eq(MAIL_DRAFT_ATTACHMENT.FILE_ID))
        .where(MAIL_DRAFT_ATTACHMENT.DRAFT_ID.eq(draftId))
        .orderBy(MAIL_DRAFT_ATTACHMENT.ID)
        .fetch(
            r ->
                new Attachment(
                    r.get(FILE.ID),
                    r.get(FILE.ORIGINAL_NAME),
                    r.get(FILE.SIZE_BYTES),
                    r.get(FILE.MIME_TYPE),
                    MailDraftDetail.SOURCE_UPLOAD));
  }

  /** 전달 원본 첨부 id — 저장 순서. 원본이 지워진 것은 CASCADE 로 이미 빠져 있다. */
  public List<Long> forwardIds(long draftId) {
    return dsl.select(MAIL_DRAFT_FORWARD.EMAIL_ATTACHMENT_ID)
        .from(MAIL_DRAFT_FORWARD)
        .where(MAIL_DRAFT_FORWARD.DRAFT_ID.eq(draftId))
        .orderBy(MAIL_DRAFT_FORWARD.ID)
        .fetch(MAIL_DRAFT_FORWARD.EMAIL_ATTACHMENT_ID);
  }

  /** 전달 원본 첨부 참조를 더한다(저장 순서대로). */
  public void addForwards(long draftId, Collection<Long> attachmentIds) {
    if (attachmentIds.isEmpty()) {
      return;
    }
    var insert =
        dsl.insertInto(
            MAIL_DRAFT_FORWARD,
            MAIL_DRAFT_FORWARD.DRAFT_ID,
            MAIL_DRAFT_FORWARD.EMAIL_ATTACHMENT_ID);
    for (Long id : attachmentIds) {
      insert = insert.values(draftId, id);
    }
    insert.execute();
  }

  /** 전달 원본 첨부 참조를 뺀다. */
  public void removeForwards(long draftId, Collection<Long> attachmentIds) {
    if (attachmentIds.isEmpty()) {
      return;
    }
    dsl.deleteFrom(MAIL_DRAFT_FORWARD)
        .where(MAIL_DRAFT_FORWARD.DRAFT_ID.eq(draftId))
        .and(MAIL_DRAFT_FORWARD.EMAIL_ATTACHMENT_ID.in(attachmentIds))
        .execute();
  }
}
