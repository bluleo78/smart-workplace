package com.workplace.wiki.repository;

import static com.workplace.jooq.Tables.WIKI_HTML_SCRIPTS_CHECK;
import static com.workplace.jooq.Tables.WIKI_PAGE;

import com.workplace.fileai.security.FileSecurityCheckPipeline;
import com.workplace.fileai.security.FileSecurityCheckRepository;
import com.workplace.global.util.Texts;
import com.workplace.jooq.tables.records.WikiHtmlScriptsCheckRecord;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * wiki_html_scripts_check(WP-1290 노트 HTML 블록 보안 점검) 접근. 키는 (페이지, 소스 지문). 상태 전이·lease·판정 기준 판은 파일
 * 점검({@link FileSecurityCheckRepository})과 같은 규칙이고, 전이는 모두 WHERE 가드가 붙은 CAS 라 요청 점검과 스케줄러가 겹쳐도 한쪽만
 * 이긴다. 테넌트 GUC 가 주입된 트랜잭션 안에서 불러야 한다(RLS).
 */
@Repository
@RequiredArgsConstructor
public class WikiHtmlScriptsCheckRepository {

  private static final int ERROR_MAX = 500;
  private static final int HEADLINE_MAX = 300;

  private final DSLContext dsl;

  /** 점검 행의 키 — 페이지와 소스 지문. */
  public record Key(long pageId, String hash) {}

  /**
   * PENDING 행을 만든다(점검 입력 요지째) — 이미 있으면 그대로 둔다(멱등).
   *
   * @return 이 호출이 새 행을 넣었으면 true
   */
  public boolean insertPendingIfAbsent(
      long pageId, String hash, int blockCount, String digest, boolean truncated) {
    return insertIfAbsent(pageId, hash, blockCount, digest, truncated, "PENDING", null);
  }

  /**
   * 크기 상한을 넘어 AI 를 부르지 않는 행 — 바로 FAILED(too-large)로 만든다. 지문이 같으면 내용이 같으므로 다시 점검해도 결과가 같다.
   *
   * @return 이 호출이 새 행을 넣었으면 true
   */
  public boolean insertTooLargeIfAbsent(long pageId, String hash, int blockCount) {
    return insertIfAbsent(
        pageId, hash, blockCount, "", false, "FAILED", FileSecurityCheckPipeline.ERROR_TOO_LARGE);
  }

  private boolean insertIfAbsent(
      long pageId,
      String hash,
      int blockCount,
      String digest,
      boolean truncated,
      String status,
      String error) {
    return dsl.insertInto(WIKI_HTML_SCRIPTS_CHECK)
            .set(WIKI_HTML_SCRIPTS_CHECK.PAGE_ID, pageId)
            .set(WIKI_HTML_SCRIPTS_CHECK.SOURCE_HASH, hash)
            .set(WIKI_HTML_SCRIPTS_CHECK.BLOCK_COUNT, blockCount)
            .set(WIKI_HTML_SCRIPTS_CHECK.DIGEST, digest)
            .set(WIKI_HTML_SCRIPTS_CHECK.TRUNCATED, truncated)
            .set(WIKI_HTML_SCRIPTS_CHECK.STATUS, status)
            .set(WIKI_HTML_SCRIPTS_CHECK.ERROR, error)
            .onConflict(WIKI_HTML_SCRIPTS_CHECK.PAGE_ID, WIKI_HTML_SCRIPTS_CHECK.SOURCE_HASH)
            .doNothing()
            .execute()
        == 1;
  }

  /**
   * 다시 점검 요청: FAILED(크기 초과 제외)·SKIPPED 이거나 지난 판정 기준으로 낸 DONE 이면 시도 횟수·오류를 비워 PENDING 으로 돌린다. 그 밖의
   * 상태는 건드리지 않는다(파일 점검 {@code resetToPending} 과 같다). 크기 초과는 지문이 곧 내용이라 다시 해도 같고, 요지가 비어 있어 AI 에 보낼
   * 것이 없다.
   */
  public void resetToPending(long pageId, String hash) {
    dsl.update(WIKI_HTML_SCRIPTS_CHECK)
        .set(WIKI_HTML_SCRIPTS_CHECK.STATUS, "PENDING")
        .set(WIKI_HTML_SCRIPTS_CHECK.ATTEMPTS, 0)
        .setNull(WIKI_HTML_SCRIPTS_CHECK.ERROR)
        .setNull(WIKI_HTML_SCRIPTS_CHECK.LEASED_UNTIL)
        .set(WIKI_HTML_SCRIPTS_CHECK.UPDATED_AT, OffsetDateTime.now())
        .where(key(pageId, hash))
        .and(
            WIKI_HTML_SCRIPTS_CHECK
                .STATUS
                .eq("FAILED")
                .and(
                    WIKI_HTML_SCRIPTS_CHECK
                        .ERROR
                        .isNull()
                        .or(
                            WIKI_HTML_SCRIPTS_CHECK.ERROR.ne(
                                FileSecurityCheckPipeline.ERROR_TOO_LARGE)))
                .or(WIKI_HTML_SCRIPTS_CHECK.STATUS.eq("SKIPPED"))
                .or(outdatedDone()))
        .execute();
  }

  /** 지난 판정 기준으로 낸 DONE 결과인지 — {@link FileSecurityCheckRepository#isOutdated} 의 SQL 판. */
  private static Condition outdatedDone() {
    return WIKI_HTML_SCRIPTS_CHECK
        .STATUS
        .eq("DONE")
        .and(
            WIKI_HTML_SCRIPTS_CHECK
                .CRITERIA_VERSION
                .isNull()
                .or(
                    WIKI_HTML_SCRIPTS_CHECK.CRITERIA_VERSION.lt(
                        FileSecurityCheckRepository.CRITERIA_VERSION)));
  }

  /**
   * 점검 선점 CAS: PENDING 또는 lease 가 끝난 CHECKING 이면 CHECKING 으로 바꾸고 시도 횟수를 하나 올린다.
   *
   * @return 이 호출이 선점했으면 true
   */
  public boolean claim(long pageId, String hash) {
    OffsetDateTime now = OffsetDateTime.now();
    return dsl.update(WIKI_HTML_SCRIPTS_CHECK)
            .set(WIKI_HTML_SCRIPTS_CHECK.STATUS, "CHECKING")
            .set(WIKI_HTML_SCRIPTS_CHECK.ATTEMPTS, WIKI_HTML_SCRIPTS_CHECK.ATTEMPTS.add(1))
            .set(WIKI_HTML_SCRIPTS_CHECK.LEASED_UNTIL, now.plus(FileSecurityCheckRepository.LEASE))
            .set(WIKI_HTML_SCRIPTS_CHECK.UPDATED_AT, now)
            .where(key(pageId, hash))
            .and(resumable(now))
            .execute()
        == 1;
  }

  /** 점검 성공: CHECKING→DONE + 위험도·한 줄 요약·근거(JSON)·모델·판정 기준 판·점검 시각. */
  public void markDone(
      long pageId, String hash, String risk, String headline, String evidenceJson, String model) {
    OffsetDateTime now = OffsetDateTime.now();
    dsl.update(WIKI_HTML_SCRIPTS_CHECK)
        .set(WIKI_HTML_SCRIPTS_CHECK.STATUS, "DONE")
        .set(WIKI_HTML_SCRIPTS_CHECK.RISK, risk)
        .set(WIKI_HTML_SCRIPTS_CHECK.HEADLINE, Texts.headUtf16(headline, HEADLINE_MAX))
        .set(
            WIKI_HTML_SCRIPTS_CHECK.EVIDENCE,
            evidenceJson == null ? null : JSONB.valueOf(evidenceJson))
        .set(WIKI_HTML_SCRIPTS_CHECK.MODEL, model)
        .set(WIKI_HTML_SCRIPTS_CHECK.CRITERIA_VERSION, FileSecurityCheckRepository.CRITERIA_VERSION)
        .set(WIKI_HTML_SCRIPTS_CHECK.CHECKED_AT, now)
        .setNull(WIKI_HTML_SCRIPTS_CHECK.ERROR)
        .setNull(WIKI_HTML_SCRIPTS_CHECK.LEASED_UNTIL)
        .set(WIKI_HTML_SCRIPTS_CHECK.UPDATED_AT, now)
        .where(key(pageId, hash))
        .and(WIKI_HTML_SCRIPTS_CHECK.STATUS.eq("CHECKING"))
        .execute();
  }

  /** 더 시도하지 않는다: CHECKING→FAILED + 오류(최대 500자). */
  public void markFailed(long pageId, String hash, String error) {
    dsl.update(WIKI_HTML_SCRIPTS_CHECK)
        .set(WIKI_HTML_SCRIPTS_CHECK.STATUS, "FAILED")
        .set(WIKI_HTML_SCRIPTS_CHECK.ERROR, Texts.headUtf16(error, ERROR_MAX))
        .setNull(WIKI_HTML_SCRIPTS_CHECK.LEASED_UNTIL)
        .set(WIKI_HTML_SCRIPTS_CHECK.UPDATED_AT, OffsetDateTime.now())
        .where(key(pageId, hash))
        .and(WIKI_HTML_SCRIPTS_CHECK.STATUS.eq("CHECKING"))
        .execute();
  }

  /**
   * 재시도 가능 실패: CHECKING→PENDING + 오류. {@code refundAttempt} 면 이번 시도를 되돌린다 — 요청이 ai-agent 에 닿지도 못한
   * 실패(연결 거부·503)는 내용 탓이 아니다.
   */
  public void revertToPending(long pageId, String hash, String error, boolean refundAttempt) {
    var update =
        dsl.update(WIKI_HTML_SCRIPTS_CHECK)
            .set(WIKI_HTML_SCRIPTS_CHECK.STATUS, "PENDING")
            .set(WIKI_HTML_SCRIPTS_CHECK.ERROR, Texts.headUtf16(error, ERROR_MAX))
            .setNull(WIKI_HTML_SCRIPTS_CHECK.LEASED_UNTIL)
            .set(WIKI_HTML_SCRIPTS_CHECK.UPDATED_AT, OffsetDateTime.now());
    if (refundAttempt) {
      update.set(
          WIKI_HTML_SCRIPTS_CHECK.ATTEMPTS,
          DSL.greatest(WIKI_HTML_SCRIPTS_CHECK.ATTEMPTS.sub(1), DSL.inline(0)));
    }
    update.where(key(pageId, hash)).and(WIKI_HTML_SCRIPTS_CHECK.STATUS.eq("CHECKING")).execute();
  }

  /** 점검 행 하나. */
  public Optional<WikiHtmlScriptsCheckRecord> find(long pageId, String hash) {
    return dsl.selectFrom(WIKI_HTML_SCRIPTS_CHECK).where(key(pageId, hash)).fetchOptional();
  }

  /** 점검 대상 페이지 제목 — AI 에 파일명 자리로 넘긴다(없으면 empty). */
  public Optional<String> findPageTitle(long pageId) {
    return dsl.select(WIKI_PAGE.TITLE)
        .from(WIKI_PAGE)
        .where(WIKI_PAGE.ID.eq(pageId))
        .fetchOptional(WIKI_PAGE.TITLE);
  }

  /** 스케줄러가 다시 주울 행 — PENDING 이거나 lease 가 끝난 CHECKING(오래 기다린 것부터). */
  public List<Key> findResumable(int limit) {
    return dsl.select(WIKI_HTML_SCRIPTS_CHECK.PAGE_ID, WIKI_HTML_SCRIPTS_CHECK.SOURCE_HASH)
        .from(WIKI_HTML_SCRIPTS_CHECK)
        .where(resumable(OffsetDateTime.now()))
        .orderBy(WIKI_HTML_SCRIPTS_CHECK.UPDATED_AT.asc())
        .limit(limit)
        .fetch(
            r ->
                new Key(
                    r.get(WIKI_HTML_SCRIPTS_CHECK.PAGE_ID),
                    r.get(WIKI_HTML_SCRIPTS_CHECK.SOURCE_HASH)));
  }

  /** PENDING 이거나 lease 가 끝난 CHECKING. */
  private static Condition resumable(OffsetDateTime now) {
    return WIKI_HTML_SCRIPTS_CHECK
        .STATUS
        .eq("PENDING")
        .or(
            WIKI_HTML_SCRIPTS_CHECK
                .STATUS
                .eq("CHECKING")
                .and(WIKI_HTML_SCRIPTS_CHECK.LEASED_UNTIL.lessThan(now)));
  }

  private static Condition key(long pageId, String hash) {
    return WIKI_HTML_SCRIPTS_CHECK
        .PAGE_ID
        .eq(pageId)
        .and(WIKI_HTML_SCRIPTS_CHECK.SOURCE_HASH.eq(hash));
  }
}
