package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.tables.EmailContent.EMAIL_CONTENT;

import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.util.MailContentHash;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * email_content 접근 레포지터리.
 *
 * <p>테넌트 내 {@code message_id} 단위로 find-or-create 를 제공하고, 후속 본문 적재(lazy)를 {@code updateBody} 로 기록한다.
 * 모든 메서드는 호출자가 테넌트 GUC 가 주입된 트랜잭션 내에서 실행해야 한다 — RLS WITH CHECK 위반 방지.
 */
@Repository
@RequiredArgsConstructor
public class EmailContentRepository {

  private final DSLContext dsl;

  /**
   * (tenant_id, message_id) 로 기존 content 를 찾거나, 없으면 헤더만으로 신규 생성해 id 를 반환한다.
   *
   * <p>동시 삽입 경쟁(race) 처리: {@code ON CONFLICT DO NOTHING} 이 충돌하면 returning 결과가 없으므로 재조회로 폴백한다.
   * {@code message_id} 가 NULL 이면 중복 체크 없이 항상 신규 생성한다.
   *
   * @param tenantId 현재 테넌트
   * @param m 파싱된 메시지(헤더 정보 사용, 본문은 사용하지 않음 — lazy 적재)
   * @return email_content.id
   */
  public long findOrCreate(long tenantId, ParsedMessage m) {
    // message_id 가 있으면 기존 content 먼저 조회(중복 방지)
    if (m.messageId() != null) {
      Optional<Long> existing =
          dsl.select(EMAIL_CONTENT.ID)
              .from(EMAIL_CONTENT)
              .where(EMAIL_CONTENT.TENANT_ID.eq(tenantId))
              .and(EMAIL_CONTENT.MESSAGE_ID.eq(m.messageId()))
              .fetchOptionalInto(Long.class);
      if (existing.isPresent()) return existing.get();
    }

    // message_id NULL 행은 부분 인덱스 제외 → 항상 신규 삽입 가능
    if (m.messageId() == null) {
      return dsl.insertInto(EMAIL_CONTENT)
          .set(EMAIL_CONTENT.TENANT_ID, tenantId)
          .set(EMAIL_CONTENT.SUBJECT, m.subject())
          .set(EMAIL_CONTENT.IN_REPLY_TO, m.inReplyTo())
          .set(EMAIL_CONTENT.MAIL_REFERENCES, m.references())
          .set(EMAIL_CONTENT.THREAD_ID, m.threadId())
          .returning(EMAIL_CONTENT.ID)
          .fetchOne()
          .get(EMAIL_CONTENT.ID);
    }

    // message_id 있는 경우: INSERT ON CONFLICT DO NOTHING 후 재조회
    // 부분 인덱스(WHERE message_id IS NOT NULL) — onConflictDoNothing() 은 타겟 미지정으로 안전하게 충돌 억제
    dsl.insertInto(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.TENANT_ID, tenantId)
        .set(EMAIL_CONTENT.MESSAGE_ID, m.messageId())
        .set(EMAIL_CONTENT.SUBJECT, m.subject())
        .set(EMAIL_CONTENT.IN_REPLY_TO, m.inReplyTo())
        .set(EMAIL_CONTENT.MAIL_REFERENCES, m.references())
        .set(EMAIL_CONTENT.THREAD_ID, m.threadId())
        .onConflictDoNothing()
        .execute();

    // 삽입 또는 기존 행 재조회 — 행을 찾지 못하면 RLS GUC 미설정 의심으로 명시적 예외
    return dsl.select(EMAIL_CONTENT.ID)
        .from(EMAIL_CONTENT)
        .where(EMAIL_CONTENT.TENANT_ID.eq(tenantId))
        .and(EMAIL_CONTENT.MESSAGE_ID.eq(m.messageId()))
        .fetchOptionalInto(Long.class)
        .orElseThrow(
            () ->
                new IllegalStateException(
                    "email_content find-or-create 재조회 실패: tenant/message_id 행을 찾지 못함 (RLS GUC 미설정 의심)"));
  }

  /**
   * lazy 본문 적재: 본문·snippet·해시·fetched_at 을 기록한다.
   *
   * <p>content_hash 는 {@link MailContentHash#of} 로 계산 — V93 백필 마이그레이션과 동일 알고리즘·구분자.
   *
   * @param contentId email_content.id
   * @param bodyText 평문 본문 (nullable)
   * @param bodyHtml HTML 본문 (nullable)
   * @param snippet 미리보기 텍스트 (nullable)
   */
  public void updateBody(long contentId, String bodyText, String bodyHtml, String snippet) {
    dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.BODY_TEXT, bodyText)
        .set(EMAIL_CONTENT.BODY_HTML, bodyHtml)
        .set(EMAIL_CONTENT.SNIPPET, snippet)
        .set(EMAIL_CONTENT.CONTENT_HASH, MailContentHash.of(bodyText, bodyHtml))
        .set(EMAIL_CONTENT.BODY_FETCHED_AT, OffsetDateTime.now())
        .where(EMAIL_CONTENT.ID.eq(contentId))
        .execute();
  }

  /**
   * 지정된 content id 중 더 이상 email_message 에서 참조하지 않는 고아 행을 삭제한다.
   *
   * <p>envelope 삭제 후 호출해 참조 카운트 기반 GC 를 수행한다. 같은 content 를 다른 envelope 가 여전히 참조하는 경우에는 삭제하지
   * 않는다(andNotExists 조건). 빈 컬렉션이 전달되면 DB 를 건드리지 않는다.
   *
   * @param contentIds GC 후보 content id 집합 (envelope 삭제 전 수집)
   */
  public void deleteOrphans(Collection<Long> contentIds) {
    if (contentIds == null || contentIds.isEmpty()) return;
    // 참조 0 인 content 만 삭제: notExists 서브쿼리로 살아있는 envelope 존재 여부를 체크한다.
    dsl.deleteFrom(EMAIL_CONTENT)
        .where(EMAIL_CONTENT.ID.in(contentIds))
        .andNotExists(
            dsl.selectOne()
                .from(EMAIL_MESSAGE)
                .where(EMAIL_MESSAGE.CONTENT_ID.eq(EMAIL_CONTENT.ID)))
        .execute();
  }

  // ============================================================
  // 테스트 보조 메서드 (프로덕션 코드에서는 사용 금지)
  // ============================================================

  /** 테스트용: id 로 row 를 조회해 반환한다. */
  public ContentRow findByIdForTest(long id) {
    return dsl.select(
            EMAIL_CONTENT.BODY_TEXT, EMAIL_CONTENT.CONTENT_HASH, EMAIL_CONTENT.BODY_FETCHED_AT)
        .from(EMAIL_CONTENT)
        .where(EMAIL_CONTENT.ID.eq(id))
        .fetchOne(r -> new ContentRow(r.value1(), r.value2(), r.value3()));
  }

  /** 테스트용: id 로 row 를 삭제한다. */
  public void deleteByIdForTest(long id) {
    dsl.deleteFrom(EMAIL_CONTENT).where(EMAIL_CONTENT.ID.eq(id)).execute();
  }

  /** 테스트 조회 결과 캐리어. */
  public record ContentRow(String bodyText, String contentHash, OffsetDateTime bodyFetchedAt) {}
}
