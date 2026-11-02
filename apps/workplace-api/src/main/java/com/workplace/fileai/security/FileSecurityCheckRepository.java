package com.workplace.fileai.security;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_SECURITY_CHECK;

import com.workplace.file.api.InternalFileCategories;
import com.workplace.fileai.repository.WorkerJobRepository;
import com.workplace.global.util.Texts;
import com.workplace.jooq.tables.records.FileSecurityCheckRecord;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.springframework.stereotype.Repository;

/**
 * file_security_check(WP-1262) 접근. 상태 전이는 모두 WHERE 가드가 붙은 CAS 라 인라인 점검과 스케줄러가 겹쳐도 한쪽만 이긴다. 테넌트 GUC
 * 가 주입된 트랜잭션 안에서 불러야 한다(RLS).
 */
@Repository
@RequiredArgsConstructor
public class FileSecurityCheckRepository {

  /**
   * CHECKING 선점 기간 — 이 안에 끝나지 않으면(프로세스 중단 등) 스케줄러가 다시 줍는다. 요약 lease({@link
   * WorkerJobRepository#SUMMARY_LEASE_DURATION}, 10분)와 같은 LLM 장시간 호출이라 같은 값을 쓴다. 처음 정한 5분은 비서 사양
   * timeoutMs(상한 없음)와 이어지지 않아 호출 도중 lease 가 끝나 두 번 부르거나 FAILED 로 오판할 수 있었다 — 호출 timeout 은 파이프라인이
   * 8분으로 잘라 이 안에 끝나게 한다({@link FileSecurityCheckPipeline#MAX_AGENT_TIMEOUT_MS}).
   */
  public static final Duration LEASE = WorkerJobRepository.SUMMARY_LEASE_DURATION;

  /**
   * 판정 기준 판(WP-1283). 프롬프트·요지의 판정 기준을 바꿀 때 올린다 — 이보다 낮은(또는 NULL) 판으로 낸 DONE 결과는 낡은 결과로 보고 「다시 점검」
   * 요청을 받는다. 1판 = WP-1262 첫 기준(칸 없음 = NULL), 2판 = 실제 위협 중심 기준.
   */
  public static final short CRITERIA_VERSION = 2;

  private static final int ERROR_MAX = 500;
  private static final int HEADLINE_MAX = 300;

  private final DSLContext dsl;

  /**
   * PENDING 행을 만든다 — 이미 있으면 그대로 둔다(멱등).
   *
   * @return 이 호출이 새 행을 넣었으면 true(이미 있었으면 false)
   */
  public boolean insertPendingIfAbsent(long fileId) {
    return dsl.insertInto(FILE_SECURITY_CHECK)
            .set(FILE_SECURITY_CHECK.FILE_ID, fileId)
            .set(FILE_SECURITY_CHECK.STATUS, "PENDING")
            .onConflict(FILE_SECURITY_CHECK.FILE_ID)
            .doNothing()
            .execute()
        == 1;
  }

  /**
   * 다시 점검 요청: 행이 없으면 PENDING 으로 만들고, FAILED·SKIPPED 이거나 지난 판정 기준으로 낸 DONE 이면 시도 횟수·오류를 비워 PENDING
   * 으로 돌린다. 그 밖의 상태(PENDING·CHECKING·지금 기준의 DONE)는 건드리지 않는다 — 지금 기준의 결과를 누를 때마다 AI 를 다시 부르지 않게.
   * SKIPPED 를 되돌리는 까닭: 웹은 스크립트를 봤는데 서버 판정이 어긋난 경우(인코딩 등)에도 사용자가 점검을 요청할 수 있게 한다.
   */
  public void resetToPending(long fileId) {
    insertPendingIfAbsent(fileId);
    dsl.update(FILE_SECURITY_CHECK)
        .set(FILE_SECURITY_CHECK.STATUS, "PENDING")
        .set(FILE_SECURITY_CHECK.ATTEMPTS, 0)
        .setNull(FILE_SECURITY_CHECK.ERROR)
        .setNull(FILE_SECURITY_CHECK.LEASED_UNTIL)
        .set(FILE_SECURITY_CHECK.UPDATED_AT, OffsetDateTime.now())
        .where(FILE_SECURITY_CHECK.FILE_ID.eq(fileId))
        .and(FILE_SECURITY_CHECK.STATUS.in("FAILED", "SKIPPED").or(outdatedDone()))
        .execute();
  }

  /** 이 판정 기준 판이 지금보다 낡았는지(NULL = 1판) — 화면 표시({@code outdated})와 되돌림 조건이 같은 규칙을 쓴다. */
  public static boolean isOutdated(Short criteriaVersion) {
    return criteriaVersion == null || criteriaVersion < CRITERIA_VERSION;
  }

  /** 지난 판정 기준으로 낸 DONE 결과인지(판이 NULL 이면 1판) — {@link #isOutdated} 의 SQL 판. */
  private static Condition outdatedDone() {
    return FILE_SECURITY_CHECK
        .STATUS
        .eq("DONE")
        .and(
            FILE_SECURITY_CHECK
                .CRITERIA_VERSION
                .isNull()
                .or(FILE_SECURITY_CHECK.CRITERIA_VERSION.lt(CRITERIA_VERSION)));
  }

  /**
   * 점검 선점 CAS: PENDING 또는 lease 가 끝난 CHECKING 이면 CHECKING 으로 바꾸고 시도 횟수를 하나 올린다.
   *
   * @return 이 호출이 선점했으면 true
   */
  public boolean claim(long fileId) {
    OffsetDateTime now = OffsetDateTime.now();
    return dsl.update(FILE_SECURITY_CHECK)
            .set(FILE_SECURITY_CHECK.STATUS, "CHECKING")
            .set(FILE_SECURITY_CHECK.ATTEMPTS, FILE_SECURITY_CHECK.ATTEMPTS.add(1))
            .set(FILE_SECURITY_CHECK.LEASED_UNTIL, now.plus(LEASE))
            .set(FILE_SECURITY_CHECK.UPDATED_AT, now)
            .where(FILE_SECURITY_CHECK.FILE_ID.eq(fileId))
            .and(
                FILE_SECURITY_CHECK
                    .STATUS
                    .eq("PENDING")
                    .or(
                        FILE_SECURITY_CHECK
                            .STATUS
                            .eq("CHECKING")
                            .and(FILE_SECURITY_CHECK.LEASED_UNTIL.lessThan(now))))
            .execute()
        == 1;
  }

  /** 점검 성공: CHECKING→DONE + 위험도·한 줄 요약·근거(JSON)·모델·점검 시각. */
  public void markDone(
      long fileId, String risk, String headline, String evidenceJson, String model) {
    OffsetDateTime now = OffsetDateTime.now();
    dsl.update(FILE_SECURITY_CHECK)
        .set(FILE_SECURITY_CHECK.STATUS, "DONE")
        .set(FILE_SECURITY_CHECK.RISK, risk)
        .set(FILE_SECURITY_CHECK.HEADLINE, Texts.headUtf16(headline, HEADLINE_MAX))
        .set(
            FILE_SECURITY_CHECK.EVIDENCE, evidenceJson == null ? null : JSONB.valueOf(evidenceJson))
        .set(FILE_SECURITY_CHECK.MODEL, model)
        .set(FILE_SECURITY_CHECK.CRITERIA_VERSION, CRITERIA_VERSION)
        .set(FILE_SECURITY_CHECK.CHECKED_AT, now)
        .setNull(FILE_SECURITY_CHECK.ERROR)
        .setNull(FILE_SECURITY_CHECK.LEASED_UNTIL)
        .set(FILE_SECURITY_CHECK.UPDATED_AT, now)
        .where(FILE_SECURITY_CHECK.FILE_ID.eq(fileId))
        .and(FILE_SECURITY_CHECK.STATUS.eq("CHECKING"))
        .execute();
  }

  /** 스크립트가 없어 점검할 것이 없다: CHECKING→SKIPPED. */
  public void markSkipped(long fileId) {
    OffsetDateTime now = OffsetDateTime.now();
    dsl.update(FILE_SECURITY_CHECK)
        .set(FILE_SECURITY_CHECK.STATUS, "SKIPPED")
        .set(FILE_SECURITY_CHECK.CHECKED_AT, now)
        .setNull(FILE_SECURITY_CHECK.LEASED_UNTIL)
        .set(FILE_SECURITY_CHECK.UPDATED_AT, now)
        .where(FILE_SECURITY_CHECK.FILE_ID.eq(fileId))
        .and(FILE_SECURITY_CHECK.STATUS.eq("CHECKING"))
        .execute();
  }

  /** 더 시도하지 않는다: CHECKING→FAILED + 오류(최대 500자). */
  public void markFailed(long fileId, String error) {
    dsl.update(FILE_SECURITY_CHECK)
        .set(FILE_SECURITY_CHECK.STATUS, "FAILED")
        .set(FILE_SECURITY_CHECK.ERROR, Texts.headUtf16(error, ERROR_MAX))
        .setNull(FILE_SECURITY_CHECK.LEASED_UNTIL)
        .set(FILE_SECURITY_CHECK.UPDATED_AT, OffsetDateTime.now())
        .where(FILE_SECURITY_CHECK.FILE_ID.eq(fileId))
        .and(FILE_SECURITY_CHECK.STATUS.eq("CHECKING"))
        .execute();
  }

  /**
   * 재시도 가능 실패: CHECKING→PENDING + 오류. {@code refundAttempt} 면 이번 시도를 되돌린다 — 요청이 ai-agent 에 닿지도 못한
   * 실패(연결 거부·503)는 파일 탓이 아니라 최대 시도 판정에 넣지 않는다(요약 파이프라인 WP-177 과 같다).
   */
  public void revertToPending(long fileId, String error, boolean refundAttempt) {
    var update =
        dsl.update(FILE_SECURITY_CHECK)
            .set(FILE_SECURITY_CHECK.STATUS, "PENDING")
            .set(FILE_SECURITY_CHECK.ERROR, Texts.headUtf16(error, ERROR_MAX))
            .setNull(FILE_SECURITY_CHECK.LEASED_UNTIL)
            .set(FILE_SECURITY_CHECK.UPDATED_AT, OffsetDateTime.now());
    if (refundAttempt) {
      update.set(
          FILE_SECURITY_CHECK.ATTEMPTS,
          org.jooq.impl.DSL.greatest(
              FILE_SECURITY_CHECK.ATTEMPTS.sub(1), org.jooq.impl.DSL.inline(0)));
    }
    update
        .where(FILE_SECURITY_CHECK.FILE_ID.eq(fileId))
        .and(FILE_SECURITY_CHECK.STATUS.eq("CHECKING"))
        .execute();
  }

  /** 현재 시도 횟수 — 행이 없으면 null. */
  public Integer findAttempts(long fileId) {
    return dsl.select(FILE_SECURITY_CHECK.ATTEMPTS)
        .from(FILE_SECURITY_CHECK)
        .where(FILE_SECURITY_CHECK.FILE_ID.eq(fileId))
        .fetchOne(FILE_SECURITY_CHECK.ATTEMPTS);
  }

  /** 점검 행 하나. */
  public Optional<FileSecurityCheckRecord> find(long fileId) {
    return dsl.selectFrom(FILE_SECURITY_CHECK)
        .where(FILE_SECURITY_CHECK.FILE_ID.eq(fileId))
        .fetchOptional();
  }

  /**
   * 스케줄러가 다시 주울 행 — PENDING 이거나 lease 가 끝난 CHECKING. 내부 카테고리(메일 사본) 파일은 뺀다 — 바이너리가 추출 직후 지워져 저장소로는
   * 점검할 수 없고, 메일은 요청 때 원본 바이트를 받아 바로 점검한다.
   */
  public List<Long> findResumable(int limit) {
    OffsetDateTime now = OffsetDateTime.now();
    return dsl.select(FILE_SECURITY_CHECK.FILE_ID)
        .from(FILE_SECURITY_CHECK)
        .join(FILE)
        .on(FILE.ID.eq(FILE_SECURITY_CHECK.FILE_ID))
        .where(
            FILE_SECURITY_CHECK
                .STATUS
                .eq("PENDING")
                .or(
                    FILE_SECURITY_CHECK
                        .STATUS
                        .eq("CHECKING")
                        .and(FILE_SECURITY_CHECK.LEASED_UNTIL.lessThan(now))))
        .and(InternalFileCategories.notInternal())
        .orderBy(FILE_SECURITY_CHECK.UPDATED_AT.asc())
        .limit(limit)
        .fetch(FILE_SECURITY_CHECK.FILE_ID);
  }

  /** 점검에 필요한 file 행 정보 — 행이 없으면 empty. */
  public Optional<FileMeta> findFileMeta(long fileId) {
    return dsl.select(
            FILE.STORAGE_PATH, FILE.MIME_TYPE, FILE.ORIGINAL_NAME, FILE.SIZE_BYTES, FILE.CATEGORY)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOptional(
            r ->
                new FileMeta(
                    r.get(FILE.STORAGE_PATH),
                    r.get(FILE.MIME_TYPE),
                    r.get(FILE.ORIGINAL_NAME),
                    r.get(FILE.SIZE_BYTES) == null ? 0L : r.get(FILE.SIZE_BYTES),
                    r.get(FILE.CATEGORY)));
  }

  /** 점검 대상 file 행 요약. */
  public record FileMeta(
      String storagePath, String mime, String originalName, long sizeBytes, String category) {

    /** 내부 처리용 카테고리(메일 사본 등)인지. */
    public boolean internal() {
      return category != null && InternalFileCategories.ALL.contains(category);
    }
  }
}
