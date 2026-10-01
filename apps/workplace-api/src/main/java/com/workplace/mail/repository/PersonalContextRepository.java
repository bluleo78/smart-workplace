package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.CONTENT_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;

import com.workplace.mail.outbound.MailAiMessages.IssueRef;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record3;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * ④ 개인 분석 보강 입력(WP-150) 조회 — 같은 스레드의 이전 메일, 첨부 행, 이 메일로 만든 이슈. RLS 테이블이라 테넌트 트랜잭션 안에서 부른다. 연결 이슈는
 * issue 패키지를 import 하지 않도록 jOOQ 테이블로 직접 읽는다(IssueRepository.findSourceIssueKey 와 같은 술어).
 */
@Repository
@RequiredArgsConstructor
public class PersonalContextRepository {

  /** 스레드 맥락에 넣는 폴더 — 동기화하는 받은편지함과 이 앱에서 보낸 메일(MailComposeService 의 SENT). 보낸편지함은 동기화하지 않는다. */
  public static final List<String> THREAD_FOLDERS = List.of("INBOX", "SENT");

  /** 이 메일로 만든 이슈의 source_type(MailIssueService 가 기록). */
  static final String MAIL_SOURCE = "MAIL";

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

  /**
   * 이 사본으로 만든 이슈(source_type=MAIL, source_id=사본 id, 삭제 제외) 중 최신 1건 — "키 제목 (상태)". source_id 는
   * 사본(envelope) id 라 소유자 본인의 메일에서만 걸린다. 테넌트 RLS 안의 이슈만 보인다.
   */
  public Optional<IssueRef> findLinkedIssue(long userId, long messageId) {
    return dsl.select(PROJECT.KEY, ISSUE.NUMBER, ISSUE.TITLE, ISSUE.STATUS)
        .from(ISSUE)
        .join(PROJECT)
        .on(ISSUE.PROJECT_ID.eq(PROJECT.ID))
        .where(ISSUE.SOURCE_TYPE.eq(MAIL_SOURCE))
        .and(ISSUE.SOURCE_ID.eq(messageId))
        .and(ISSUE.DELETED_AT.isNull())
        // 이슈 가시성 규칙(IssueRepository.findVisibleRefsByIds)과 같다 — 호출자가 멤버인 프로젝트의 이슈만.
        // 이슈 패키지를 import 하지 않으려고 같은 조건을 jOOQ 로 다시 쓴다. 프로젝트에서 빠진 사용자에게 제목·상태를 새지 않게 한다.
        .and(
            DSL.exists(
                DSL.selectOne()
                    .from(PROJECT_MEMBER)
                    .where(PROJECT_MEMBER.PROJECT_ID.eq(ISSUE.PROJECT_ID))
                    .and(PROJECT_MEMBER.USER_ID.eq(userId))))
        .orderBy(ISSUE.ID.desc())
        .limit(1)
        .fetchOptional(r -> new IssueRef(r.value1() + "-" + r.value2(), r.value3(), r.value4()));
  }
}
