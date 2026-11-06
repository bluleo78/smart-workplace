// MailAttachmentSourceProvider.java — 메일(MAIL) 첨부 가상 뷰 제공(WP-1392)
package com.workplace.mail.service;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import com.workplace.drive.api.AttachmentSourceProvider;
import com.workplace.global.util.LikePatternUtils;
import com.workplace.mail.dto.EmailAttachmentMeta;
import com.workplace.mail.repository.EmailAttachmentRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.mail.util.MailAttachmentSizes;
import com.workplace.mail.util.MailDeepLinks;
import com.workplace.mail.util.MailInlineImages;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.jooq.impl.SQLDataType;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 메일 첨부 가상 뷰 제공자(sourceType "MAIL"). 호출자 자신의 메일 계정(활성)에 든 메일의 첨부만 노출한다 — 소유 규칙은 메일 첨부 내려받기와 같은
 * {@link EmailAttachmentRepository#ownedBy}(email_account.user_id = 호출자 AND disabled_at IS NULL).
 *
 * <p>메일 첨부는 file 행이 없다(바이트는 메일 서버에서 받아 오는 캐시). 그래서 Entry.fileId 는 null 이고, 내려받기·미리보기 키는 {@code
 * mailAttachmentId}(email_attachment.id)로 따로 준다 — file id 와 다른 id 공간이라 섞이면 엉뚱한 파일을 가리킨다. 같은 이유로
 * 드라이브 가져오기는 지원하지 않고(fileId 가 없다), {@link #canAccessFile} 은 항상 false 다.
 */
@Component
@RequiredArgsConstructor
public class MailAttachmentSourceProvider implements AttachmentSourceProvider {

  /**
   * 메일 첨부의 시각 — 받은 시각, 없으면 보낸 시각, 둘 다 없으면 행이 만들어진 시각(정렬·커서가 NULL 로 깨지지 않게). select·정렬·커서 비교가 모두 이 한
   * 식을 쓴다 — 식이 갈리면 페이지가 어긋난다.
   */
  private static final Field<OffsetDateTime> MAIL_AT =
      DSL.coalesce(EMAIL_MESSAGE.RECEIVED_AT, EMAIL_MESSAGE.SENT_AT, EMAIL_MESSAGE.CREATED_AT);

  /**
   * 화면에 보이는 첨부 이름 — 파일명, 없거나 빈 값이면 「attachment-{id}」(메일 화면 mailAttachmentName 과 같은 규칙). manifest 가
   * 없는 레거시 행(content_attachment_id NULL)도 이 이름으로 보이고 검색된다.
   */
  private static final Field<String> DISPLAY_NAME =
      DSL.coalesce(
          DSL.nullif(CONTENT_ATTACHMENT.FILENAME, ""),
          DSL.inline(MailAttachmentResolver.UNNAMED_PREFIX)
              .concat(EMAIL_ATTACHMENT.ID.cast(SQLDataType.VARCHAR)));

  /** 첫 회에 읽는 후보 행 수의 하한 — 인라인 이미지를 걸러 내고도 한 페이지를 채우려고 조금 넉넉히 읽는다. */
  private static final int MIN_BATCH = 20;

  /**
   * 후보 다시 읽기 횟수 상한. 매 회 읽는 수를 두 배로 늘리므로 4회면 첫 회의 15배(최소 20 → 누적 300 행)를 훑는다 — 한 페이지 요청이 인라인 이미지가 몰린
   * 메일함에서도 몇 번의 짧은 쿼리로 끝나게 하는 값이다(한 요청이 수만 행을 훑지 않게). 서명 로고 등 인라인 이미지가 300 개 넘게 연달아 있는 드문 경우 상한에
   * 닿으면 모은 만큼만 돌려준다 — limit+1 을 못 채워 그 페이지가 마지막처럼 보일 수 있다(웹이 「더 보기」를 숨김). 검색어로 좁히면 이어서 볼 수 있다. 커서가
   * 매 회 앞으로 가므로 원래도 끝나지만, 판정 버그로 같은 자리를 맴도는 일도 막는다.
   */
  private static final int MAX_PASSES = 4;

  private final DSLContext dsl;
  private final EmailMessageRepository messages;

  @Override
  public String sourceType() {
    return "MAIL";
  }

  /**
   * 내 메일 첨부를 (메일 시각, email_attachment.id) 내림차순으로 limit+1 개까지. q=이름 부분일치, cursor=커서.
   *
   * <p>범위: 내 활성 계정(소유 규칙은 내려받기와 같다) + 「모든 메일함」 범위({@link EmailMessageRepository#allMailboxesScope}
   * — 통합 검색과 같다: 휴지통·스팸으로 보이는 메일함과 앱 발송본의 서버 사본은 빠진다).
   *
   * <p>본문에 그려지는 인라인 이미지(서명 로고 등)는 메일 화면처럼 첨부 목록에서 뺀다 — 판정은 {@link MailInlineImages}(화면과 같은 규칙). 이
   * 판정은 SQL 로 못 해서 후보를 읽은 뒤 걸러 내고, 모자라면 마지막 후보 다음부터 더 읽는다(걸러진 행 때문에 limit+1 을 못 채운 채 돌려주면 웹이 「끝」으로
   * 보고 나머지를 놓친다). 다시 읽을 때마다 읽는 수를 두 배로 늘리고, 횟수는 {@link #MAX_PASSES} 로 묶는다.
   *
   * <p>성능: 내 계정(idx_email_account_user) → 계정의 메일 → 메일의 첨부(idx_email_attachment_message) →
   * manifest(PK) 로 좁혀 들어가고, 정렬은 내 첨부 행만 대상으로 한다(한 사람 수천 건 규모). 본문은 이미지 후보가 있는 메일 중 cid: 를 포함한 것만
   * 보고, HTML 전체가 아니라 DB 에서 뽑은 cid 참조 값만 받는다.
   */
  @Override
  @Transactional(readOnly = true)
  public List<Entry> list(long callerId, String q, Cursor cursor, int limit) {
    int batch = Math.max(limit + 1, MIN_BATCH);
    List<Entry> out = new ArrayList<>();
    Cursor at = cursor;
    for (int pass = 0; pass < MAX_PASSES && out.size() < limit + 1; pass++, batch *= 2) {
      List<Record> rows = candidates(callerId, q, at, batch);
      if (rows.isEmpty()) break;
      Set<Long> inlined = inlinedIds(rows);
      for (Record r : rows) {
        if (inlined.contains(r.get(EMAIL_ATTACHMENT.ID))) continue;
        out.add(toEntry(r));
        if (out.size() == limit + 1) break;
      }
      if (rows.size() < batch) break; // 더 읽을 후보가 없다
      Record last = rows.get(rows.size() - 1);
      at = new Cursor(last.get(MAIL_AT).toInstant(), sourceType(), last.get(EMAIL_ATTACHMENT.ID));
    }
    return out;
  }

  /** 정렬된 후보 첨부 행(인라인 판정 전) — cursor 다음부터 batch 개. */
  private List<Record> candidates(long callerId, String q, Cursor cursor, int batch) {
    var query =
        dsl.select(
                EMAIL_ATTACHMENT.ID,
                DISPLAY_NAME,
                CONTENT_ATTACHMENT.FILENAME,
                CONTENT_ATTACHMENT.CONTENT_TYPE,
                CONTENT_ATTACHMENT.SIZE_BYTES,
                EMAIL_MESSAGE.ID,
                EMAIL_MESSAGE.ACCOUNT_ID,
                EMAIL_MESSAGE.IMAP_UID,
                EMAIL_MESSAGE.FROM_NAME,
                EMAIL_MESSAGE.FROM_ADDRESS,
                EMAIL_CONTENT.SUBJECT,
                MAIL_AT)
            .from(EMAIL_ACCOUNT)
            .join(EMAIL_MESSAGE)
            .on(EMAIL_MESSAGE.ACCOUNT_ID.eq(EMAIL_ACCOUNT.ID))
            .join(EMAIL_FOLDER)
            .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
            .join(EMAIL_ATTACHMENT)
            .on(EMAIL_ATTACHMENT.MESSAGE_ID.eq(EMAIL_MESSAGE.ID))
            // manifest 가 없는 레거시 행(content_attachment_id NULL)도 내려받기(findContextForDownload, LEFT
            // JOIN)와 메일
            // 화면이 보여 주므로 빠뜨리지 않는다 — 이름·형식·크기는 화면·내려받기와 같은 대체값(attachment-{id}·octet-stream·0)
            .leftJoin(CONTENT_ATTACHMENT)
            .on(CONTENT_ATTACHMENT.ID.eq(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID))
            // 제목은 email_content 에 있다(envelope 중복 제거) — 본문 미적재 메일도 빠지지 않게 LEFT JOIN
            .leftJoin(EMAIL_CONTENT)
            .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
            // 소유 규칙 — 내 계정 + 비활성 계정 제외(내려받기와 같은 규칙)
            .where(EmailAttachmentRepository.ownedBy(callerId))
            // 휴지통·스팸 등은 빼고 다른 메일 목록(통합 검색)과 같은 메일함 범위
            .and(EmailMessageRepository.allMailboxesScope());

    // 이름 부분일치 필터 (선택) — 화면에 보이는 이름 기준
    if (q != null && !q.isBlank()) {
      query = query.and(DISPLAY_NAME.likeIgnoreCase(LikePatternUtils.containsPattern(q), '\\'));
    }

    // 커서 기반 페이지네이션 — (메일 시각, 첨부 id) 가 커서 다음인 행(한 메일의 첨부는 시각이 같아 id 로 순서를 고정)
    query = query.and(Cursor.after(cursor, sourceType(), MAIL_AT, EMAIL_ATTACHMENT.ID));

    return new ArrayList<Record>(
        query.orderBy(Cursor.order(MAIL_AT, EMAIL_ATTACHMENT.ID)).limit(batch).fetch());
  }

  /** 후보 한 행 → Entry. */
  private Entry toEntry(Record r) {
    long attachmentId = r.get(EMAIL_ATTACHMENT.ID);
    long accountId = r.get(EMAIL_MESSAGE.ACCOUNT_ID);
    long messageId = r.get(EMAIL_MESSAGE.ID);
    String contentType = r.get(CONTENT_ATTACHMENT.CONTENT_TYPE);
    return new Entry(
        null, // file 행이 없다 — 다른 출처의 file id 와 섞이지 않게 비운다(그래서 드라이브로 가져올 수도 없다)
        r.get(DISPLAY_NAME),
        // 형식을 모르면(레거시 행 등) 내려받기 응답과 같은 octet-stream
        contentType != null ? contentType : "application/octet-stream",
        sizeOf(r),
        false, // 메일 첨부는 썸네일을 만들지 않는다
        sourceLabel(
            r.get(EMAIL_CONTENT.SUBJECT),
            r.get(EMAIL_MESSAGE.FROM_NAME),
            r.get(EMAIL_MESSAGE.FROM_ADDRESS)),
        MailDeepLinks.message(accountId, messageId),
        // 메일 첨부 내려받기 (MailInboxController GET /attachments/{attachmentId}/content —
        // email_attachment.id)
        "/api/v1/mail/attachments/" + attachmentId + "/content",
        r.get(MAIL_AT).toInstant(),
        null,
        attachmentId);
  }

  /** WP-1329: IMAP 수신 첨부의 저장 크기는 base64 인코딩 크기 — 메일 화면과 같은 실제 크기 추정으로. */
  private static long sizeOf(Record r) {
    return MailAttachmentSizes.estimatedRawBytes(
        Objects.requireNonNullElse(r.get(CONTENT_ATTACHMENT.SIZE_BYTES), 0L),
        r.get(EMAIL_MESSAGE.IMAP_UID) != null);
  }

  /**
   * 후보 중 메일 화면이 본문 인라인 이미지로 그려 첨부 목록에서 빼는 것의 email_attachment.id.
   *
   * <p>화면은 HTML 본문을 iframe 으로 보일 때만(검증된 본문 + HTML 있음 + text 본문 없음) 인라인 치환·목록 숨김을 한다(MailInboxPage
   * showsHtml). 같은 조건의 메일만 본문의 cid 참조를 보고, 판정에는 그 메일의 첨부 전체를 화면과 같은 순서로 넘긴다 — 한 cid 에 여러 첨부가 맞을 때
   * 앞의 것만 쓰이기 때문이다(후보에 없는 첨부가 앞에 있을 수 있다).
   */
  private Set<Long> inlinedIds(List<Record> rows) {
    // 인라인 후보(이미지·상한 이하)가 있는 메일만 본다 — 대부분의 페이지는 여기서 쿼리 없이 끝난다
    Set<Long> messageIds = new HashSet<>();
    for (Record r : rows) {
      if (MailInlineImages.isInlinable(r.get(CONTENT_ATTACHMENT.CONTENT_TYPE), sizeOf(r))) {
        messageIds.add(r.get(EMAIL_MESSAGE.ID));
      }
    }
    if (messageIds.isEmpty()) return Set.of();
    Map<Long, List<String>> refsByMessage = cidRefs(messageIds);
    if (refsByMessage.isEmpty()) return Set.of();
    Map<Long, List<EmailAttachmentMeta>> attsByMessage =
        messages.listAttachments(refsByMessage.keySet());
    Set<Long> out = new HashSet<>();
    refsByMessage.forEach(
        (messageId, refs) ->
            out.addAll(
                MailInlineImages.inlinedIds(
                    refs, attsByMessage.getOrDefault(messageId, List.of()))));
    return out;
  }

  /**
   * 화면이 HTML 로 보이는 메일 본문의 cid 참조 값(message id → 정규화 전 값, 참조가 없는 메일은 빠진다). 검증된 사본(fetched_at 있음,
   * WP-130 — 화면도 미검증 본문은 받지 못한다)이고 HTML 이 있으며 text 본문이 비어 있는 것 중 cid: 를 포함한 것만.
   *
   * <p>본문 HTML 전체를 앱으로 읽지 않으려고 참조 추출은 DB 에서 한다 — regexp_matches 가 참조 하나당 한 행([큰따옴표, 작은따옴표, 따옴표 없음]
   * 중 맞은 칸 하나만 값)을 돌려준다. 정규식은 화면과 같은 규칙({@link MailInlineImages#CID_SRC_PG_REGEX}), 정규화는 Java
   * 쪽({@link MailInlineImages#inlinedIds})에서 한다.
   */
  private Map<Long, List<String>> cidRefs(Collection<Long> messageIds) {
    Field<String[]> match =
        DSL.field(
            "regexp_matches({0}, {1}, 'gi')",
            String[].class, EMAIL_CONTENT.BODY_HTML, DSL.val(MailInlineImages.CID_SRC_PG_REGEX));
    Map<Long, List<String>> out = new HashMap<>();
    dsl.select(EMAIL_MESSAGE.ID, match)
        .from(EMAIL_MESSAGE)
        .join(EMAIL_CONTENT)
        .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
        .where(EMAIL_MESSAGE.ID.in(messageIds))
        .and(EMAIL_MESSAGE.FETCHED_AT.isNotNull())
        .and(EMAIL_CONTENT.BODY_TEXT.isNull().or(EMAIL_CONTENT.BODY_TEXT.eq("")))
        // 정규식 앞의 값싼 거르기 — cid: 가 없는 본문은 정규식을 돌리지 않는다
        .and(EMAIL_CONTENT.BODY_HTML.likeIgnoreCase("%cid:%"))
        .forEach(
            r -> {
              String[] groups = r.get(match);
              String raw = null;
              for (String g : groups) {
                if (g != null) {
                  raw = g;
                  break;
                }
              }
              out.computeIfAbsent(r.get(EMAIL_MESSAGE.ID), k -> new ArrayList<>()).add(raw);
            });
    return out;
  }

  /** 「제목 — 보낸 사람」. 보낸 사람은 이름, 없으면 주소. 제목이 없으면 「(제목 없음)」. */
  static String sourceLabel(String subject, String fromName, String fromAddress) {
    String s = subject == null || subject.isBlank() ? "(제목 없음)" : subject;
    String from = fromName != null && !fromName.isBlank() ? fromName : fromAddress;
    return from == null || from.isBlank() ? s : s + " — " + from;
  }

  /**
   * 항상 false. 메일 첨부는 file 행이 없어 importAttachment 가 받는 fileId 와 같은 id 공간이 아니다 — 여기서
   * email_attachment.id 로 판정하면 같은 숫자의 남의 file 이 인가될 수 있어, 메일 출처는 가져오기 인가에 절대 참여하지 않는다.
   */
  @Override
  public boolean canAccessFile(long callerId, long fileId) {
    return false;
  }
}
