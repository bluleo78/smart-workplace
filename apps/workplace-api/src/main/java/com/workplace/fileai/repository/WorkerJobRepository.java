package com.workplace.fileai.repository;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.WORKER_JOB;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.JSONB;
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
        .fetch(FILE_EXTRACTION.FILE_ID);
  }

  /** 요약 컨텍스트 — ai-agent 호출에 필요한 파일 정보. */
  public record SummaryContext(String text, String fileName, String mime, long tenantId) {}
}
