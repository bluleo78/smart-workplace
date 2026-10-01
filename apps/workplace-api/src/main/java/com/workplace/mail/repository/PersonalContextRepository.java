package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record3;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * ④ 개인 분석 보강 입력(WP-150) 조회 — 같은 스레드의 이전 메일, 첨부 행. RLS 테이블이라 테넌트 트랜잭션 안에서 부른다. 연결 이슈는 issue 모듈의 공개
 * 조회 서비스가 맡는다({@link com.workplace.mail.service.PersonalContextLoader}).
 */
@Repository
@RequiredArgsConstructor
public class PersonalContextRepository {

  /** 스레드 맥락에 넣는 폴더 — 동기화하는 받은편지함과 이 앱에서 보낸 메일(MailComposeService 의 SENT). 보낸편지함은 동기화하지 않는다. */
  public static final List<String> THREAD_FOLDERS = List.of("INBOX", "SENT");

  /** 첨부 행 조회 상한(이름 상한은 서비스가 다시 건다). */
  static final int ATTACHMENT_ROWS_MAX = 50;

  private final DSLContext dsl;

  /** 이전 메일 원자료 — 본문은 검증된 사본만 읽으므로 그대로 쓴다. */
  public record PriorMailRow(
      String fromAddress,
      String fromName,
      OffsetDateTime receivedAt,
      String bodyText,
      String bodyHtml,
      String snippet) {}

  /** 첨부 행 — 인라인 이미지 판정용 형식·Content-ID 포함. */
  public record AttachmentRow(String filename, String contentType, String mimeContentId) {}

  /**
   * 같은 계정·같은 thread_id 에서 이 메일보다 앞선(received_at, id) 사본 중 최근 limit 건을 오래된 순으로. 폴더는 {@link
   * #THREAD_FOLDERS}, 자기 사본을 적재·검증한(fetched_at) 것만 — 검증 전 사본의 공유 본문은 보여 주지 않는다(WP-130). 소유 검증 포함(타인
   * 메일이면 빈 목록). thread_id·received_at 이 없으면 빈 목록.
   */
  public List<PriorMailRow> listPriorThreadMails(long userId, long messageId, int limit) {
    Record3<Long, String, OffsetDateTime> cur =
        dsl.select(EMAIL_MESSAGE.ACCOUNT_ID, EMAIL_MESSAGE.THREAD_ID, EMAIL_MESSAGE.RECEIVED_AT)
            .from(EMAIL_MESSAGE)
            .join(EMAIL_ACCOUNT)
            .on(EMAIL_ACCOUNT.ID.eq(EMAIL_MESSAGE.ACCOUNT_ID))
            .where(EMAIL_MESSAGE.ID.eq(messageId))
            .and(EMAIL_ACCOUNT.USER_ID.eq(userId))
            .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())
            .fetchOne();
    if (cur == null || cur.value2() == null || cur.value2().isBlank() || cur.value3() == null) {
      return List.of();
    }
    List<PriorMailRow> latestFirst =
        dsl.select(
                EMAIL_MESSAGE.FROM_ADDRESS,
                EMAIL_MESSAGE.FROM_NAME,
                EMAIL_MESSAGE.RECEIVED_AT,
                EMAIL_CONTENT.BODY_TEXT,
                EMAIL_CONTENT.BODY_HTML,
                EMAIL_CONTENT.SNIPPET)
            .from(EMAIL_MESSAGE)
            .join(EMAIL_FOLDER)
            .on(EMAIL_FOLDER.ID.eq(EMAIL_MESSAGE.FOLDER_ID))
            .join(EMAIL_CONTENT)
            .on(EMAIL_CONTENT.ID.eq(EMAIL_MESSAGE.CONTENT_ID))
            .where(EMAIL_MESSAGE.ACCOUNT_ID.eq(cur.value1()))
            .and(EMAIL_MESSAGE.THREAD_ID.eq(cur.value2()))
            .and(EMAIL_MESSAGE.ID.ne(messageId))
            .and(EMAIL_FOLDER.NAME.in(THREAD_FOLDERS))
            .and(EMAIL_MESSAGE.FETCHED_AT.isNotNull())
            .and(DSL.row(EMAIL_MESSAGE.RECEIVED_AT, EMAIL_MESSAGE.ID).lt(cur.value3(), messageId))
            .orderBy(EMAIL_MESSAGE.RECEIVED_AT.desc(), EMAIL_MESSAGE.ID.desc())
            .limit(limit)
            .fetch(
                r ->
                    new PriorMailRow(
                        r.value1(), r.value2(), r.value3(), r.value4(), r.value5(), r.value6()));
    List<PriorMailRow> out = new ArrayList<>(latestFirst);
    Collections.reverse(out); // 프롬프트는 오래된 순
    return out;
  }

  /** 사본의 첨부 행(순서대로). 호출자가 소유 검증된 사본 id 를 넘긴다(분석 컨텍스트). */
  public List<AttachmentRow> listAttachments(long messageId) {
    return dsl.select(
            CONTENT_ATTACHMENT.FILENAME,
            CONTENT_ATTACHMENT.CONTENT_TYPE,
            CONTENT_ATTACHMENT.MIME_CONTENT_ID)
        .from(EMAIL_ATTACHMENT)
        .join(CONTENT_ATTACHMENT)
        .on(CONTENT_ATTACHMENT.ID.eq(EMAIL_ATTACHMENT.CONTENT_ATTACHMENT_ID))
        .where(EMAIL_ATTACHMENT.MESSAGE_ID.eq(messageId))
        .orderBy(EMAIL_ATTACHMENT.ORDINAL.asc().nullsLast(), EMAIL_ATTACHMENT.ID.asc())
        .limit(ATTACHMENT_ROWS_MAX)
        .fetch(r -> new AttachmentRow(r.value1(), r.value2(), r.value3()));
  }
}
