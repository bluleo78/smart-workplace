package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.tables.EmailContent.EMAIL_CONTENT;

import com.workplace.jooq.tables.records.EmailContentRecord;
import com.workplace.mail.dto.ContentSource;
import com.workplace.mail.dto.ParsedMessage;
import com.workplace.mail.util.MailContentHash;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.InsertSetMoreStep;
import org.jooq.UpdateSetMoreStep;
import org.springframework.stereotype.Repository;

/**
 * email_content 접근 레포지터리.
 *
 * <p>테넌트 내 (message_id, 공유 지문) 단위로 find-or-create 를 제공하고(WP-130), 후속 본문 적재(lazy)는 {@code claimBody}
 * 로 첫 적재자만 기록한다. 모든 메서드는 호출자가 테넌트 GUC 가 주입된 트랜잭션 내에서 실행해야 한다 — RLS WITH CHECK 위반 방지.
 */
@Repository
@RequiredArgsConstructor
public class EmailContentRepository {

  private final DSLContext dsl;

  /**
   * 공유 가능한 기존 content 를 찾거나, 없으면 헤더만으로 신규 생성해 id 를 반환한다.
   *
   * <p>WP-130: 공유 키 = (tenant_id, message_id, fingerprint). fingerprint 는 {@link
   * MailContentHash#fingerprint} — 수신 경로·발신자·Date·제목·[IMAP] 본문 구조. Message-ID 만 같은 위조 메일은 지문이 달라 별도
   * content 가 된다. message_id 가 없거나 지문을 만들 수 없으면(IMAP 구조 요약 실패) 공유하지 않고 항상 신규 생성한다.
   *
   * <p>동시 삽입 경쟁(race) 처리: {@code ON CONFLICT DO NOTHING} 이 충돌하면 returning 결과가 없으므로 재조회로 폴백한다.
   *
   * @param tenantId 현재 테넌트
   * @param m 파싱된 메시지(헤더 정보 사용, 본문은 사용하지 않음 — lazy 적재)
   * @param source 수신 경로(지문 재료 — 경로가 다르면 공유하지 않음)
   * @return email_content.id
   */
  public long findOrCreate(long tenantId, ParsedMessage m, ContentSource source) {
    String fingerprint = m.messageId() == null ? null : MailContentHash.fingerprint(source, m);

    // 공유 불가(message_id 또는 지문 없음) → 부분 유니크 인덱스 제외 대상이라 항상 신규 삽입
    if (fingerprint == null) {
      return createDedicated(tenantId, m);
    }

    Optional<Long> existing = findShared(tenantId, m.messageId(), fingerprint);
    if (existing.isPresent()) return existing.get();

    // 부분 유니크 인덱스(email_content_tenant_message_fp_uk) — 타겟 미지정 onConflictDoNothing 으로 경쟁 삽입 흡수
    insertContent(tenantId, m, fingerprint).onConflictDoNothing().execute();

    // 삽입 또는 기존 행 재조회 — 행을 찾지 못하면 RLS GUC 미설정 의심으로 명시적 예외
    return findShared(tenantId, m.messageId(), fingerprint)
        .orElseThrow(
            () ->
                new IllegalStateException(
                    "email_content find-or-create 재조회 실패: tenant/message_id/fingerprint 행을 찾지 못함 (RLS GUC 미설정 의심)"));
  }

  private Optional<Long> findShared(long tenantId, String messageId, String fingerprint) {
    return dsl.select(EMAIL_CONTENT.ID)
        .from(EMAIL_CONTENT)
        .where(EMAIL_CONTENT.TENANT_ID.eq(tenantId))
        .and(EMAIL_CONTENT.MESSAGE_ID.eq(messageId))
        .and(EMAIL_CONTENT.FINGERPRINT.eq(fingerprint))
        .fetchOptionalInto(Long.class);
  }

  private InsertSetMoreStep<EmailContentRecord> insertContent(
      long tenantId, ParsedMessage m, String fingerprint) {
    return dsl.insertInto(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.TENANT_ID, tenantId)
        .set(EMAIL_CONTENT.MESSAGE_ID, m.messageId())
        .set(EMAIL_CONTENT.FINGERPRINT, fingerprint)
        .set(EMAIL_CONTENT.SUBJECT, m.subject())
        .set(EMAIL_CONTENT.IN_REPLY_TO, m.inReplyTo())
        .set(EMAIL_CONTENT.MAIL_REFERENCES, m.references())
        .set(EMAIL_CONTENT.THREAD_ID, m.threadId());
  }

  /**
   * 아직 본문이 없는 content 에 한해 본문을 기록한다(첫 적재자 선점). WP-130: 공유 본문은 한 번 기록되면 다른 수신자의 적재로 덮어쓰지 않는다 — 덮어쓰기는
   * 위조 메일이 원본 수신자들의 본문을 바꾸는 경로였다.
   *
   * <p>조건부 UPDATE({@code body_fetched_at IS NULL})라 동시 적재 경쟁에서도 정확히 한 쪽만 true 를 받는다(행 잠금 후 재평가).
   *
   * @return true: 이번 호출이 본문을 기록함. false: 이미 다른 envelope 가 기록함(호출자가 해시 비교).
   */
  public boolean claimBody(long contentId, String bodyText, String bodyHtml, String snippet) {
    return setBody(bodyText, bodyHtml, snippet)
            .where(EMAIL_CONTENT.ID.eq(contentId))
            .and(EMAIL_CONTENT.BODY_FETCHED_AT.isNull())
            .execute()
        > 0;
  }

  /** 기록된 본문 해시. 본문 미적재 또는 해시 미계산이면 null. */
  public String findContentHash(long contentId) {
    return dsl.select(EMAIL_CONTENT.CONTENT_HASH)
        .from(EMAIL_CONTENT)
        .where(EMAIL_CONTENT.ID.eq(contentId))
        .fetchOneInto(String.class);
  }

  /**
   * 공유 content 에서 분리할 envelope 용 새 content 를 만든다(WP-130). 헤더(제목·스레드)만 복사하고 본문은 비운다. fingerprint 는
   * NULL 이라 다른 수신과 다시 공유되지 않는다.
   *
   * @return 새 email_content.id
   */
  public long forkHeaders(long contentId) {
    // 헤더 컬럼만 조회 — 원본 본문(대용량 가능)은 옮기지 않는다
    var src =
        dsl.select(
                EMAIL_CONTENT.TENANT_ID,
                EMAIL_CONTENT.MESSAGE_ID,
                EMAIL_CONTENT.SUBJECT,
                EMAIL_CONTENT.IN_REPLY_TO,
                EMAIL_CONTENT.MAIL_REFERENCES,
                EMAIL_CONTENT.THREAD_ID)
            .from(EMAIL_CONTENT)
            .where(EMAIL_CONTENT.ID.eq(contentId))
            .fetchSingle();
    return dsl.insertInto(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.TENANT_ID, src.value1())
        .set(EMAIL_CONTENT.MESSAGE_ID, src.value2())
        .set(EMAIL_CONTENT.SUBJECT, src.value3())
        .set(EMAIL_CONTENT.IN_REPLY_TO, src.value4())
        .set(EMAIL_CONTENT.MAIL_REFERENCES, src.value5())
        .set(EMAIL_CONTENT.THREAD_ID, src.value6())
        .returning(EMAIL_CONTENT.ID)
        .fetchOne()
        .get(EMAIL_CONTENT.ID);
  }

  /**
   * 공유하지 않는 전용 content 를 헤더만으로 만든다(보낸메일 행 — WP-130). 지문이 NULL 이라 어떤 수신과도 공유되지 않는다.
   *
   * @return 새 email_content.id
   */
  public long createDedicated(long tenantId, ParsedMessage m) {
    return insertContent(tenantId, m, null)
        .returning(EMAIL_CONTENT.ID)
        .fetchOne()
        .get(EMAIL_CONTENT.ID);
  }

  /**
   * 본문을 무조건 기록한다(덮어쓰기). 공유되지 않는 전용 content({@link #createDedicated})에만 쓴다 — 공유 가능한 content 에는
   * {@link #claimBody} 를 쓴다. content_hash 는 {@link MailContentHash#of} — V93 백필과 동일 알고리즘·구분자.
   */
  public void updateBody(long contentId, String bodyText, String bodyHtml, String snippet) {
    setBody(bodyText, bodyHtml, snippet).where(EMAIL_CONTENT.ID.eq(contentId)).execute();
  }

  /** 본문·snippet·해시·fetched_at 기록 단계(claimBody/updateBody 공통). */
  private UpdateSetMoreStep<EmailContentRecord> setBody(
      String bodyText, String bodyHtml, String snippet) {
    return dsl.update(EMAIL_CONTENT)
        .set(EMAIL_CONTENT.BODY_TEXT, bodyText)
        .set(EMAIL_CONTENT.BODY_HTML, bodyHtml)
        .set(EMAIL_CONTENT.SNIPPET, snippet)
        .set(EMAIL_CONTENT.CONTENT_HASH, MailContentHash.of(bodyText, bodyHtml))
        .set(EMAIL_CONTENT.BODY_FETCHED_AT, OffsetDateTime.now());
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

  /**
   * WP-149 ②: 대량·자동 발송 원본으로 표시한다. 원본(content) 속성이라 공유 content 에 둔다. 수신자마다 헤더가 다를 수 있어(리스트 확장) 한
   * 번이라도 자동 발송으로 판정되면 true 로 남긴다(되돌리지 않음).
   *
   * @return true: 이번 호출로 false→true 가 바뀜(이미 판정된 사본의 ⑤ 를 다시 계산해야 함)
   */
  public boolean markAutoGenerated(long contentId) {
    return dsl.update(EMAIL_CONTENT)
            .set(EMAIL_CONTENT.AUTO_GENERATED, true)
            .where(EMAIL_CONTENT.ID.eq(contentId))
            .and(EMAIL_CONTENT.AUTO_GENERATED.isFalse())
            .execute()
        > 0;
  }

  /**
   * WP-149: 분석 결과 저장 직렬화용 행 잠금(SELECT … FOR UPDATE). ④ 저장이 ③ 분류 저장과 엇갈리면 서로의 결과를 못 보고 ⑤ 재계산을 놓칠 수
   * 있어, ④ 는 content 행을 잠근 뒤 raw 를 쓰고 그 시점의 분류로 ⑤ 를 계산한다(③ 의 UPDATE 도 같은 행 잠금을 잡는다). 트랜잭션 안에서 호출한다.
   */
  public void lockForAnalysis(long contentId) {
    dsl.select(EMAIL_CONTENT.ID)
        .from(EMAIL_CONTENT)
        .where(EMAIL_CONTENT.ID.eq(contentId))
        .forUpdate()
        .fetch();
  }
}
