package com.workplace.fileai.repository;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.WORKER_JOB;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** worker_job + file_extraction CAS 전이 레포지토리. */
@Repository
@RequiredArgsConstructor
public class WorkerJobRepository {

  /**
   * 요약 단계 최대 시도 횟수. 이 값에 도달한 행은 FAILED(단말) 로 전이되어 무한 재시도 루프를 방지한다.
   *
   * <p>추출 단계에는 별도 상한이 없음(워커 레벨 타임아웃으로 관리).
   */
  public static final int MAX_SUMMARY_ATTEMPTS = 3;

  /**
   * 요약 리스 유효 기간. ai-agent 최대 응답 예산(180s) + 스케줄러 주기(3분) 여유를 합산해 아직 살아있는 요약 잡을 잘못 재클레임하지 않도록 한다.
   *
   * <p>이 값보다 짧으면 진행 중인 LLM 요청이 두 번 호출되어 이중 LLM 비용이 발생한다.
   */
  public static final java.time.Duration SUMMARY_LEASE_DURATION = java.time.Duration.ofMinutes(10);

  /** 추출 리스 유효 기간. 워커 최대 응답 예산 + 스케줄러 주기 여유. 리스 만료 전에는 stuck EXTRACTING 행을 재클레임하지 않는다. */
  public static final java.time.Duration EXTRACTION_LEASE_DURATION =
      java.time.Duration.ofMinutes(10);

  private final DSLContext dsl;
  private final ObjectMapper objectMapper;

  /**
   * 백필 스케줄러 한 틱당 재개 파일 상한(#735). V125 마이그레이션이 SKIPPED 로 굳어있던 다수 행을 PENDING 으로 재개방하는데, 상한이 없으면
   * findResumable() 이 그 전량을 한 틱에 디스패치해 워커·ai-agent 를 폭주시킬 수 있다.
   */
  @org.springframework.beans.factory.annotation.Value(
      "${workplace.worker.extract.resume-batch-size:50}")
  private int resumeBatchSize;

  /**
   * file_extraction PENDING→EXTRACTING CAS. 1행 업데이트 시 이 디스패처가 소유(이중 잡 방지).
   *
   * <p>다음 두 조건 중 하나를 만족하는 경우에만 클레임: (1) status='PENDING', (2) status='EXTRACTING' AND leased_until
   * &lt; now() — 프로세스 크래시로 리스가 만료된 stuck 행을 재클레임. 성공 시 leased_until 을 EXTRACTION_LEASE_DURATION 만큼
   * 갱신해 진행 중인 다른 추출 잡을 잘못 재클레임하지 않도록 한다.
   *
   * @return true 이면 이 디스패처가 추출을 소유함
   */
  public boolean claimForExtraction(long fileId) {
    OffsetDateTime now = OffsetDateTime.now();
    return dsl.update(FILE_EXTRACTION)
            .set(FILE_EXTRACTION.STATUS, "EXTRACTING")
            .set(FILE_EXTRACTION.LEASED_UNTIL, now.plus(EXTRACTION_LEASE_DURATION))
            .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
            .and(
                FILE_EXTRACTION
                    .STATUS
                    .eq("PENDING")
                    .or(
                        FILE_EXTRACTION
                            .STATUS
                            .eq("EXTRACTING")
                            .and(FILE_EXTRACTION.LEASED_UNTIL.lessThan(now))))
            .execute()
        == 1;
  }

  /**
   * 추출 claim 해제: EXTRACTING→PENDING (lease 클리어). 워커 디스패치 실패(도달 불가) 시 즉시 재개 가능하게 한다.
   *
   * <p>멱등 — 이미 다른 콜백이 TEXT_READY/SKIPPED 등으로 전이했으면 0행(EXTRACTING 조건 불충족). 연결 실패는 FAILED 가 아닌
   * PENDING 으로 되돌려 transient 로 취급한다(lease 만료 대기 회피).
   */
  public void releaseExtractionClaim(long fileId) {
    dsl.update(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.STATUS, "PENDING")
        .set(FILE_EXTRACTION.LEASED_UNTIL, (OffsetDateTime) null)
        .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
        .and(FILE_EXTRACTION.STATUS.eq("EXTRACTING"))
        .execute();
  }

  /**
   * extract 워커 잡을 RUNNING 상태로 생성해 id 를 반환한다.
   *
   * <p>params JSONB 는 Jackson ObjectMapper 로 직렬화해 수동 문자열 조합의 이스케이프 버그를 방지한다.
   *
   * @param fileId 대상 파일 id (jobId→fileId 역조회에 사용)
   * @param storageKey 스토리지 경로
   * @param mime MIME 타입
   */
  public long createExtractJob(long tenantId, long fileId, String storageKey, String mime) {
    String paramsJson;
    try {
      paramsJson =
          objectMapper.writeValueAsString(
              Map.of("fileId", fileId, "storageKey", storageKey, "mime", mime));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("worker_job params 직렬화 실패", e);
    }
    return dsl.insertInto(WORKER_JOB)
        .set(WORKER_JOB.TASK_TYPE, "extract")
        .set(WORKER_JOB.PARAMS, JSONB.valueOf(paramsJson))
        .set(WORKER_JOB.STATUS, "RUNNING")
        .set(WORKER_JOB.TENANT_ID, tenantId)
        .returning(WORKER_JOB.ID)
        .fetchOne()
        .getId();
  }

  /** 워커 잡을 DONE 으로 마킹한다(콜백 수신 후). */
  public void markJobDone(long jobId) {
    dsl.update(WORKER_JOB).set(WORKER_JOB.STATUS, "DONE").where(WORKER_JOB.ID.eq(jobId)).execute();
  }

  /**
   * worker_job.params 에서 fileId 를 조회한다(콜백 수신 시 역조회).
   *
   * <p>PostgreSQL JSONB ->> 연산자로 fileId 필드를 문자열로 추출한다.
   *
   * @return fileId, 잡이 없으면 null
   */
  public Long findFileIdByJobId(long jobId) {
    String fileIdStr =
        dsl.select(
                org.jooq.impl.DSL.field(
                    "{0} ->> {1}",
                    String.class, WORKER_JOB.PARAMS, org.jooq.impl.DSL.inline("fileId")))
            .from(WORKER_JOB)
            .where(WORKER_JOB.ID.eq(jobId))
            .fetchOne(0, String.class);
    if (fileIdStr == null) return null;
    try {
      return Long.parseLong(fileIdStr.trim());
    } catch (NumberFormatException e) {
      return null;
    }
  }

  /**
   * file_extraction EXTRACTING→TEXT_READY CAS (스테일 콜백 가드).
   *
   * <p>status 가 여전히 EXTRACTING 인 경우에만 TEXT_READY 로 전이해
   * extracted_text/char_count/truncated/lang/extracted_at 을 저장한다. 이미 TEXT_READY/DONE/FAILED 이면 0행
   * 업데이트 → 무시(스테일 콜백).
   *
   * @return 실제로 전이된 경우 true
   */
  public boolean advanceToTextReady(
      long fileId, String extractedText, int charCount, boolean truncated, String lang) {
    return dsl.update(FILE_EXTRACTION)
            .set(FILE_EXTRACTION.STATUS, "TEXT_READY")
            .set(FILE_EXTRACTION.EXTRACTED_TEXT, extractedText)
            .set(FILE_EXTRACTION.CHAR_COUNT, charCount)
            .set(FILE_EXTRACTION.TRUNCATED, truncated)
            .set(FILE_EXTRACTION.LANG, lang)
            .set(FILE_EXTRACTION.EXTRACTED_AT, OffsetDateTime.now())
            .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
            .and(FILE_EXTRACTION.STATUS.eq("EXTRACTING"))
            .execute()
        == 1;
  }

  /**
   * file_extraction EXTRACTING→SKIPPED CAS (워커가 추출 불가 판정 시).
   *
   * @return 실제로 전이된 경우 true
   */
  public boolean advanceToSkipped(long fileId, String error) {
    return dsl.update(FILE_EXTRACTION)
            .set(FILE_EXTRACTION.STATUS, "SKIPPED")
            .set(FILE_EXTRACTION.ERROR, error)
            .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
            .and(FILE_EXTRACTION.STATUS.eq("EXTRACTING"))
            .execute()
        == 1;
  }

  /**
   * file_extraction TEXT_READY→SUMMARIZING CAS (이중 요약 방지).
   *
   * <p>다음 두 조건 중 하나를 만족하는 경우에만 클레임: (1) status='TEXT_READY', (2) status='SUMMARIZING' AND
   * leased_until &lt; now() — 프로세스 크래시로 리스가 만료된 stuck 행을 재클레임. 성공 시 attempts 증가 + leased_until 갱신.
   * leased_until 이 없으면 진행 중인 LLM 호출이 만료 직후 재클레임되어 이중 호출이 발생한다.
   *
   * @return true 이면 이 디스패처가 요약 처리를 소유함
   */
  public boolean claimForSummary(long fileId) {
    OffsetDateTime now = OffsetDateTime.now();
    return dsl.update(FILE_EXTRACTION)
            .set(FILE_EXTRACTION.STATUS, "SUMMARIZING")
            .set(FILE_EXTRACTION.ATTEMPTS, FILE_EXTRACTION.ATTEMPTS.add(1))
            .set(FILE_EXTRACTION.LEASED_UNTIL, now.plus(SUMMARY_LEASE_DURATION))
            .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
            .and(
                FILE_EXTRACTION
                    .STATUS
                    .eq("TEXT_READY")
                    .or(
                        FILE_EXTRACTION
                            .STATUS
                            .eq("SUMMARIZING")
                            .and(FILE_EXTRACTION.LEASED_UNTIL.lessThan(now))))
            .execute()
        == 1;
  }

  /**
   * 요약 성공: SUMMARIZING→DONE 전이 및 요약 결과 저장.
   *
   * @param fileId 대상 파일 id
   * @param summary 생성된 요약문
   * @param model 사용한 모델 ID
   */
  public void markSummarized(long fileId, String summary, String model) {
    dsl.update(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.STATUS, "DONE")
        .set(FILE_EXTRACTION.SUMMARY, summary)
        .set(FILE_EXTRACTION.SUMMARY_MODEL, model)
        .set(FILE_EXTRACTION.SUMMARIZED_AT, OffsetDateTime.now())
        .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
        .execute();
  }

  /**
   * 요약 실패(attempts &lt; MAX): SUMMARIZING→TEXT_READY 복귀. 재시도 가능 상태로 되돌린다.
   *
   * <p>attempts 는 claimForSummary 에서 이미 증가했으므로 여기서는 error 만 기록한다. WHERE status='SUMMARIZING' 가드로 이미
   * 다른 상태(DONE/FAILED)로 전이된 행을 덮어쓰지 않는다.
   *
   * @param fileId 대상 파일 id
   * @param error 오류 메시지 (최대 500자)
   */
  public void revertToTextReady(long fileId, String error) {
    String truncated = error != null && error.length() > 500 ? error.substring(0, 500) : error;
    dsl.update(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.STATUS, "TEXT_READY")
        .set(FILE_EXTRACTION.ERROR, truncated)
        .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
        .and(FILE_EXTRACTION.STATUS.eq("SUMMARIZING"))
        .execute();
  }

  /**
   * 요약 실패(attempts &gt;= MAX): SUMMARIZING→FAILED 단말 전이. 이 이후 findResumable 에서 제외되어 무한 재시도를 막는다.
   *
   * <p>WHERE status='SUMMARIZING' 가드로 이미 다른 상태로 전이된 행은 변경하지 않는다.
   *
   * @param fileId 대상 파일 id
   * @param error 오류 메시지 (최대 500자)
   */
  public void markFailed(long fileId, String error) {
    String truncated = error != null && error.length() > 500 ? error.substring(0, 500) : error;
    dsl.update(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.STATUS, "FAILED")
        .set(FILE_EXTRACTION.ERROR, truncated)
        .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
        .and(FILE_EXTRACTION.STATUS.eq("SUMMARIZING"))
        .execute();
  }

  /**
   * 파일의 현재 attempts 값을 조회한다(단말 전이 판단에 사용).
   *
   * @param fileId 대상 파일 id
   * @return attempts 값, 행이 없으면 null
   */
  public Integer findAttempts(long fileId) {
    return dsl.select(FILE_EXTRACTION.ATTEMPTS)
        .from(FILE_EXTRACTION)
        .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
        .fetchOne(FILE_EXTRACTION.ATTEMPTS);
  }

  /**
   * 요약 컨텍스트 조회(요약 단계에서 ai-agent 에 전달할 정보).
   *
   * @param fileId 대상 파일 id
   * @return {extracted_text, original_name, mime_type, tenant_id}
   */
  public SummaryContext findSummaryContext(long fileId) {
    return dsl.select(
            FILE_EXTRACTION.EXTRACTED_TEXT,
            FILE.ORIGINAL_NAME,
            FILE.MIME_TYPE,
            FILE_EXTRACTION.TENANT_ID)
        .from(FILE_EXTRACTION)
        .join(FILE)
        .on(FILE.ID.eq(FILE_EXTRACTION.FILE_ID))
        .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
        .fetchOne(
            r ->
                new SummaryContext(
                    r.get(FILE_EXTRACTION.EXTRACTED_TEXT),
                    r.get(FILE.ORIGINAL_NAME),
                    r.get(FILE.MIME_TYPE),
                    r.get(FILE_EXTRACTION.TENANT_ID)));
  }

  /**
   * 백필 스케줄러가 처리해야 할 재개 대상 파일 목록을 반환한다.
   *
   * <ul>
   *   <li>PENDING: 아직 추출 시작 전
   *   <li>EXTRACTING: 리스 만료(leased_until &lt; now()) — 워커 타임아웃 추정
   *   <li>SUMMARIZING: 리스 만료 AND attempts &lt; MAX_SUMMARY_ATTEMPTS — AI 타임아웃 추정(상한 도달 시 제외, 다음
   *       claimForSummary 가 FAILED 로 전이)
   *   <li>TEXT_READY: 요약 대기 중. attempts &lt; MAX_SUMMARY_ATTEMPTS 인 행만 포함 — 상한 도달 행은 FAILED 로 이미
   *       전이되거나 다음 claimForSummary 에서 전이됨
   * </ul>
   *
   * @return 재개 대상 파일 id 목록 (tenantId 는 caller 가 TenantContext 로 설정)
   */
  public List<Long> findResumable() {
    OffsetDateTime now = OffsetDateTime.now();
    return dsl.select(FILE_EXTRACTION.FILE_ID)
        .from(FILE_EXTRACTION)
        .where(
            FILE_EXTRACTION
                .STATUS
                .eq("PENDING")
                .or(
                    FILE_EXTRACTION
                        .STATUS
                        .eq("EXTRACTING")
                        .and(FILE_EXTRACTION.LEASED_UNTIL.lessThan(now)))
                .or(
                    FILE_EXTRACTION
                        .STATUS
                        .eq("SUMMARIZING")
                        .and(FILE_EXTRACTION.LEASED_UNTIL.lessThan(now))
                        .and(FILE_EXTRACTION.ATTEMPTS.lessThan(MAX_SUMMARY_ATTEMPTS)))
                .or(
                    FILE_EXTRACTION
                        .STATUS
                        .eq("TEXT_READY")
                        .and(FILE_EXTRACTION.ATTEMPTS.lessThan(MAX_SUMMARY_ATTEMPTS))))
        // 재개방 백필 시 한 틱 전량 디스패치를 막는 상한(#735).
        .limit(resumeBatchSize)
        .fetch(FILE_EXTRACTION.FILE_ID);
  }

  /** 요약 컨텍스트 — ai-agent 호출에 필요한 파일 정보. */
  public record SummaryContext(String text, String fileName, String mime, long tenantId) {}

  // ─────────────────── 임베딩 큐 메서드 ───────────────────

  /** 임베딩 lease 기간 — 추출과 동일 10분. 워커 크래시 시 만료 후 재디스패치 가능. */
  private static final java.time.Duration EMBED_LEASE_DURATION = java.time.Duration.ofMinutes(10);

  /**
   * 임베딩 단말 실패 상한. 이 횟수 이상 FAILED embed 잡이 쌓인 파일은 독성 루프 방지를 위해 백필에서 영구 제외한다(#525 추출 MAX_ATTEMPTS
   * 미러).
   */
  private static final int MAX_EMBED_ATTEMPTS = 3;

  /**
   * embed 잡 생성. params 에 fileId 보관, RUNNING + lease(now+10분). lease 로 크래시 후 재디스패치 가능.
   *
   * @param tenantId 테넌트 ID
   * @param fileId 대상 파일 ID
   * @param text 임베딩할 텍스트 (전달 전용, DB 저장 안 함)
   * @return 생성된 worker_job.id
   */
  public long createEmbedJob(long tenantId, long fileId, String text) {
    try {
      String params = objectMapper.writeValueAsString(Map.of("fileId", fileId));
      return dsl.insertInto(WORKER_JOB)
          .set(WORKER_JOB.TASK_TYPE, "embed")
          .set(WORKER_JOB.PARAMS, JSONB.valueOf(params))
          .set(WORKER_JOB.STATUS, "RUNNING")
          .set(WORKER_JOB.LEASED_UNTIL, OffsetDateTime.now().plus(EMBED_LEASE_DURATION))
          .set(WORKER_JOB.TENANT_ID, tenantId)
          .returning(WORKER_JOB.ID)
          .fetchOne(WORKER_JOB.ID);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("embed job params 직렬화 실패", e);
    }
  }

  /**
   * 임베딩 결과를 멱등 적용. embedding IS NULL 인 행만 UPDATE(중복 콜백 무해). 영향 행 수 반환.
   *
   * <p>search_tv 는 GENERATED ALWAYS STORED → 절대 SET 하지 않는다.
   *
   * @param fileId 대상 파일 ID
   * @param vectorLiteral pgvector 텍스트 리터럴 (예: "[0.1,0.2,...]")
   * @return 업데이트된 행 수 (0=멱등, 1=적용)
   */
  public int applyEmbedResult(long fileId, String vectorLiteral) {
    // EMBEDDING 컬럼은 Object 타입(커스텀 pg vector) — UpdateSetMoreStep 의 set(Field<T>, T) 오버로드를 명시적으로 선택.
    // DSL.field("cast(? as vector)", ...) 는 Field<Object> 로 ambiguous → execute 전 plain SQL UPDATE
    // 사용.
    return dsl.execute(
        "UPDATE file_extraction SET embedding = cast(? as vector)"
            + " WHERE file_id = ? AND status = 'DONE' AND embedding IS NULL",
        vectorLiteral,
        fileId);
  }

  /**
   * 재디스패치 가드: 살아있는(lease 미만료) RUNNING embed 잡이 있으면 true. 만료 lease 는 false(재디스패치 허용).
   *
   * @param fileId 대상 파일 ID
   * @return true 이면 중복 디스패치 방지
   */
  public boolean hasPendingEmbedJob(long fileId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(WORKER_JOB)
            .where(WORKER_JOB.TASK_TYPE.eq("embed"))
            .and(WORKER_JOB.STATUS.eq("RUNNING"))
            .and(WORKER_JOB.LEASED_UNTIL.gt(OffsetDateTime.now()))
            .and(
                DSL.field("{0} ->> {1}", String.class, WORKER_JOB.PARAMS, DSL.inline("fileId"))
                    .eq(String.valueOf(fileId))));
  }

  /**
   * 임베딩 컨텍스트(DONE 상태 추출 텍스트 + tenant). DONE 아니면 empty.
   *
   * @param fileId 대상 파일 ID
   * @return (text, tenantId) 또는 empty(추출 미완료 또는 없는 파일)
   */
  public Optional<EmbedContext> findEmbedContext(long fileId) {
    return dsl.select(FILE_EXTRACTION.EXTRACTED_TEXT, FILE_EXTRACTION.TENANT_ID)
        .from(FILE_EXTRACTION)
        .where(FILE_EXTRACTION.FILE_ID.eq(fileId))
        .and(FILE_EXTRACTION.STATUS.eq("DONE"))
        .fetchOptional(
            r ->
                new EmbedContext(
                    r.get(FILE_EXTRACTION.EXTRACTED_TEXT), r.get(FILE_EXTRACTION.TENANT_ID)));
  }

  /**
   * worker_job 을 FAILED 로 마킹한다(임베딩 단말 실패 — 파일 검색성은 키워드로 유지).
   *
   * @param jobId worker_job.id
   * @param error 오류 메시지
   */
  public void markEmbedJobFailed(long jobId, String error) {
    dsl.update(WORKER_JOB)
        .set(WORKER_JOB.STATUS, "FAILED")
        .set(
            WORKER_JOB.ERROR,
            error == null ? null : error.substring(0, Math.min(error.length(), 500)))
        .set(WORKER_JOB.UPDATED_AT, OffsetDateTime.now())
        .where(WORKER_JOB.ID.eq(jobId))
        .execute();
  }

  /**
   * 백필 대상: status=DONE 이고 embedding 이 아직 NULL 인 file_id 목록.
   *
   * <p>제외 조건 2가지: (1) 살아있는(lease 미만료) RUNNING embed 잡이 있는 파일, (2) FAILED embed 잡이
   * MAX_EMBED_ATTEMPTS 회 이상 쌓인 파일(영구 실패 — 매 틱 재디스패치되어 worker_job 행이 무한 누적되는 독성 루프 차단).
   *
   * @param limit 최대 반환 건수
   * @return 임베딩 대기 파일 ID 목록
   */
  public List<Long> findEmbeddable(int limit) {
    return dsl.select(FILE_EXTRACTION.FILE_ID)
        .from(FILE_EXTRACTION)
        .where(FILE_EXTRACTION.STATUS.eq("DONE"))
        .and(FILE_EXTRACTION.EMBEDDING.isNull())
        // (1) 살아있는 RUNNING embed 잡이 없는 것만
        .and(
            DSL.notExists(
                dsl.selectOne()
                    .from(WORKER_JOB)
                    .where(WORKER_JOB.TASK_TYPE.eq("embed"))
                    .and(WORKER_JOB.STATUS.eq("RUNNING"))
                    .and(WORKER_JOB.LEASED_UNTIL.gt(OffsetDateTime.now()))
                    .and(
                        DSL.field(
                                "{0} ->> {1}",
                                String.class, WORKER_JOB.PARAMS, DSL.inline("fileId"))
                            .eq(FILE_EXTRACTION.FILE_ID.cast(String.class)))))
        // (2) FAILED embed 잡이 MAX_EMBED_ATTEMPTS 미만인 것만(영구 실패 파일 영구 제외)
        .and(
            DSL.field(
                    "(SELECT count(*) FROM worker_job wj WHERE wj.task_type = 'embed'"
                        + " AND wj.status = 'FAILED' AND wj.params ->> 'fileId' = {0}::text)",
                    Integer.class, FILE_EXTRACTION.FILE_ID)
                .lt(MAX_EMBED_ATTEMPTS))
        .limit(limit)
        .fetch(FILE_EXTRACTION.FILE_ID);
  }

  /** 임베딩 디스패치 컨텍스트 — dispatchEmbed 에서 사용. */
  public record EmbedContext(String text, long tenantId) {}
}
