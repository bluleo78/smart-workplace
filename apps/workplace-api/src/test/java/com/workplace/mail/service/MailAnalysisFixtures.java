package com.workplace.mail.service;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_CONTENT;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;

import com.workplace.mail.repository.EmailContentRepository;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;

/**
 * WP-149 분석 통합 테스트 공용 시드 — 메일함·공유 content·envelope 를 직접 만든다(테넌트#1, 세션 GUC). envelope 는 본문 적재·검증
 * 완료(fetched_at) 상태로 만든다 — 공유 본문은 검증된 envelope 에만 보이기 때문이다(WP-130).
 */
public final class MailAnalysisFixtures {

  /** 요약 생략 기준(400자)을 넘는 새 본문. */
  public static final String LONG_BODY =
      "배포 일정 확인 부탁드립니다. 스테이징 검증은 끝났고 운영 반영 날짜만 정하면 됩니다. ".repeat(10);

  /** 요약 생략 기준 이하의 짧은 본문. */
  public static final String SHORT_BODY = "확인 부탁드립니다.";

  /** 시드한 메일함. address 는 계정 주소(소문자). */
  public record Box(long userId, long accountId, long folderId, String address) {}

  private MailAnalysisFixtures() {}

  /** 사용자 1명 + 계정 + INBOX. aiEnabled 는 계정 AI 사용 여부. */
  public static Box mailbox(DSLContext dsl, boolean aiEnabled) {
    String address = "box-" + System.nanoTime() + "@test.local";
    long[] m = TestFixtures.seedMailbox(dsl, address);
    dsl.update(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.AI_ENABLED, aiEnabled)
        .where(EMAIL_ACCOUNT.ID.eq(m[1]))
        .execute();
    return new Box(m[0], m[1], m[2], address);
  }

  /** 공유 content 1행 + 본문(평문). */
  public static long content(
      DSLContext dsl, EmailContentRepository contentRepo, String bodyText, String snippet) {
    long nano = System.nanoTime();
    long id =
        dsl.insertInto(EMAIL_CONTENT)
            .set(EMAIL_CONTENT.TENANT_ID, 1L)
            .set(EMAIL_CONTENT.MESSAGE_ID, "<analysis-" + nano + "@corp>")
            .set(EMAIL_CONTENT.THREAD_ID, "<analysis-thread-" + nano + ">")
            .set(EMAIL_CONTENT.SUBJECT, "배포 일정 확인")
            .returning(EMAIL_CONTENT.ID)
            .fetchOne()
            .getId();
    contentRepo.updateBody(id, bodyText, null, snippet);
    return id;
  }

  /** box 의 INBOX 에 content 를 가리키는 안 읽은 envelope. */
  public static long envelope(
      DSLContext dsl, Box box, long contentId, String from, String to, String cc) {
    return envelope(dsl, box.accountId(), box.folderId(), contentId, from, to, cc);
  }

  /** 지정 폴더에 content 를 가리키는 안 읽은 envelope(적재 완료). */
  public static long envelope(
      DSLContext dsl,
      long accountId,
      long folderId,
      long contentId,
      String from,
      String to,
      String cc) {
    long nano = System.nanoTime();
    return dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.TENANT_ID, 1L)
        .set(EMAIL_MESSAGE.MESSAGE_ID, "env-" + nano + "@corp")
        .set(EMAIL_MESSAGE.THREAD_ID, "thread-" + nano)
        .set(EMAIL_MESSAGE.FROM_ADDRESS, from)
        .set(EMAIL_MESSAGE.TO_ADDRESSES, to)
        .set(EMAIL_MESSAGE.CC_ADDRESSES, cc)
        .set(EMAIL_MESSAGE.SEEN, false)
        .set(EMAIL_MESSAGE.HAS_ATTACHMENT, false)
        .set(EMAIL_MESSAGE.CONTENT_ID, contentId)
        .set(EMAIL_MESSAGE.RECEIVED_AT, OffsetDateTime.now())
        .set(EMAIL_MESSAGE.FETCHED_AT, OffsetDateTime.now())
        .returning(EMAIL_MESSAGE.ID)
        .fetchOne()
        .getId();
  }

  /** ④ 를 이미 마친 것처럼 raw·최종값·시도 시각을 직접 기록한다(③ 재계산 검증용). */
  public static void markPersonallyAnalyzed(DSLContext dsl, long envelopeId, boolean raw) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.AI_NEEDS_REPLY_RAW, raw)
        .set(EMAIL_MESSAGE.AI_NEEDS_REPLY, raw)
        .set(EMAIL_MESSAGE.AI_ANALYZED_AT, OffsetDateTime.now())
        .where(EMAIL_MESSAGE.ID.eq(envelopeId))
        .execute();
  }

  /** 수신 시각을 며칠 전으로 옮긴다(회신필요 기간 밖 옛 메일 검증용). */
  public static void receivedDaysAgo(DSLContext dsl, long envelopeId, int days) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.RECEIVED_AT, OffsetDateTime.now().minusDays(days))
        .where(EMAIL_MESSAGE.ID.eq(envelopeId))
        .execute();
  }

  /**
   * 사본을 읽음으로 바꾼다(판단 13: 읽은 메일은 선제 분석 대상이 아님을 검증). 서버 역동기화와 무관한 시드라 seen_push_pending(WP-148)은 건드리지
   * 않는다.
   */
  public static void markSeen(DSLContext dsl, long envelopeId) {
    dsl.update(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.SEEN, true)
        .where(EMAIL_MESSAGE.ID.eq(envelopeId))
        .execute();
  }
}
