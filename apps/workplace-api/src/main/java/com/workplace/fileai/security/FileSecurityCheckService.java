package com.workplace.fileai.security;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.fileai.outbound.AiAgentDriveClient.Evidence;
import com.workplace.fileai.security.dto.SecurityCheckView;
import com.workplace.global.util.AfterCommit;
import com.workplace.jooq.tables.records.FileSecurityCheckRecord;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.jooq.JSONB;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * HTML 보안 점검 조회·요청(WP-1262). 출처별 컨트롤러(드라이브·이슈 첨부·챗 첨부·메일)가 접근 권한을 확인한 뒤 file id 로 부른다 — 이 서비스는 권한을
 * 보지 않는다.
 *
 * <p>요청은 트랜잭션 안에서 상태만 바꾸고, 점검은 커밋 뒤 전용 실행기로 넘긴다(LLM 호출이 요청 스레드·DB 커넥션을 쥐지 않게).
 */
@Slf4j
@Service
public class FileSecurityCheckService {

  private static final TypeReference<List<Evidence>> EVIDENCE_LIST = new TypeReference<>() {};

  /** 점검을 깨울 상태 — 요청(저장소 파일은 스케줄러가 줍는다)은 PENDING 만. */
  private static final Set<String> WAKE_ON_REQUEST = Set.of("PENDING");

  /** 메일 사본은 스케줄러가 줍지 않으므로 CHECKING 도 깨운다 — lease 가 끝났으면 다시 선점하고, 아직이면 CAS 가 막는다. */
  private static final Set<String> WAKE_ON_BYTES_REQUEST = Set.of("PENDING", "CHECKING");

  private final FileSecurityCheckRepository repo;
  private final FileSecurityCheckPipeline pipeline;
  private final AssistantResolver assistantResolver;
  private final ObjectMapper objectMapper;
  private final Executor executor;

  public FileSecurityCheckService(
      FileSecurityCheckRepository repo,
      FileSecurityCheckPipeline pipeline,
      AssistantResolver assistantResolver,
      ObjectMapper objectMapper,
      @Qualifier(FileSecurityCheckExecutorConfig.EXECUTOR) Executor executor) {
    this.repo = repo;
    this.pipeline = pipeline;
    this.assistantResolver = assistantResolver;
    this.objectMapper = objectMapper;
    this.executor = executor;
  }

  /** 현재 점검 상태. 행이 없으면 status null(AI 가 없으면 reason NO_AI). */
  @Transactional(readOnly = true)
  public SecurityCheckView view(long fileId) {
    return toView(repo.find(fileId).orElse(null), aiAvailable());
  }

  /**
   * 점검 요청(「AI 보안 점검」·「다시 점검」). 행이 없거나 FAILED·SKIPPED·지난 기준의 DONE 이면 PENDING(시도 0)으로 만들고 커밋 뒤 점검한다.
   * PENDING·CHECKING·지금 기준의 DONE 은 그대로 둔다(PENDING 이면 점검을 한 번 더 깨운다 — 선점 CAS 라 겹쳐도 한 번만 돈다). AI 가
   * 없으면 행을 만들지 않고 reason NO_AI.
   */
  @Transactional
  public SecurityCheckView request(long fileId) {
    if (!aiAvailable()) {
      return toView(repo.find(fileId).orElse(null), false);
    }
    FileSecurityCheckRecord row = resetAndFind(fileId);
    if (wakeable(row, WAKE_ON_REQUEST)) {
      runAfterCommit(fileId, () -> pipeline.check(fileId));
    }
    return toView(row, true);
  }

  /**
   * 메일 첨부 점검 요청 — 전이는 {@link #request} 와 같고, 점검은 받은 원본 바이트로 한다(사본 바이너리는 추출 직후 지워진다). 메일 사본은 스케줄러가
   * 줍지 않으므로 CHECKING 도 깨운다 — lease 가 끝났으면 다시 선점하고, 아직이면 CAS 가 막는다.
   *
   * <p>원본(최대 25MiB)은 이 요청 스레드에서 디코드·스크립트 판정·요지까지 줄인다. 크기 초과·스크립트 없음은 AI 를 부르지 않으니 그 자리에서 FAILED·
   * SKIPPED 로 적고, 스크립트가 있으면 요지(≤ 60k자)만 실행기에 넘긴다 — 큐(100건)에 원본 바이트를 붙잡아 힙을 크게 쓰지 않게.
   */
  @Transactional
  public SecurityCheckView requestWithBytes(long fileId, String fileName, byte[] bytes) {
    if (!aiAvailable()) {
      return toView(repo.find(fileId).orElse(null), false);
    }
    FileSecurityCheckRecord row = resetAndFind(fileId);
    if (!wakeable(row, WAKE_ON_BYTES_REQUEST)) {
      return toView(row, true);
    }
    FileSecurityCheckPipeline.Prepared prepared = FileSecurityCheckPipeline.prepare(bytes);
    if (prepared.terminal()) {
      // 이 트랜잭션에 합류해 바로 선점·기록한다(AI 호출 없음). lease 가 남은 CHECKING 이면 CAS 가 막아 그대로 둔다.
      pipeline.check(fileId, prepared, fileName);
      return toView(repo.find(fileId).orElse(null), true);
    }
    runAfterCommit(fileId, () -> pipeline.check(fileId, prepared, fileName));
    return toView(row, true);
  }

  /** 워크스페이스에 AI(비서)가 있는지 — 메일처럼 원본을 받기 전에 먼저 걸러야 하는 호출부가 쓴다. */
  public boolean aiAvailable() {
    return assistantResolver.resolveWorkspaceOrEmpty().isPresent();
  }

  /** FAILED·SKIPPED·지난 기준의 DONE·행 없음을 PENDING 으로 만든 뒤 현재 행을 읽는다. */
  private FileSecurityCheckRecord resetAndFind(long fileId) {
    repo.resetToPending(fileId);
    return repo.find(fileId).orElse(null);
  }

  /** 현재 상태가 {@code wakeStatuses} 에 들어 점검을 깨워야 하는지. */
  private static boolean wakeable(FileSecurityCheckRecord row, Set<String> wakeStatuses) {
    return row != null && wakeStatuses.contains(row.getStatus());
  }

  /**
   * 커밋 뒤 전용 실행기로 점검을 넘긴다. 큐가 넘치면 실행기가 버리고 행은 PENDING 으로 남는다 — 저장소 파일은 스케줄러가 다시 줍고, 메일 사본은 사용자가 다시
   * 요청하면(PENDING 이라 깨운다) 돈다. 업로드 리스너도 같은 제출·예외 로그 경로를 쓴다.
   */
  void runAfterCommit(long fileId, Runnable check) {
    AfterCommit.run(
        () ->
            executor.execute(
                () -> {
                  try {
                    check.run();
                  } catch (RuntimeException e) {
                    log.warn("보안 점검 처리 실패 — 행은 PENDING 으로 남는다: fileId={}", fileId, e);
                  }
                }));
  }

  /** 행 → 응답 — 칸을 {@link #viewOf} 로 넘긴다. */
  private SecurityCheckView toView(FileSecurityCheckRecord row, boolean hasAi) {
    if (row == null) {
      return viewOf(null, null, null, List.of(), null, null, null, hasAi);
    }
    return viewOf(
        row.getStatus(),
        row.getRisk(),
        row.getHeadline(),
        parseEvidence(objectMapper, row.getEvidence(), "fileId=" + row.getFileId()),
        row.getCheckedAt(),
        row.getError(),
        row.getCriteriaVersion(),
        hasAi);
  }

  /**
   * 점검 행 칸 → 응답. 행이 없으면({@code status} null) status null(AI 가 없으면 reason NO_AI). 실패 까닭은 오류 코드로, AI
   * 없음은 점검이 진행될 수 없는 상태(행 없음·PENDING·CHECKING)에서만 알린다. 노트 HTML 블록 점검(WP-1290)도 같은 규칙으로 응답을 만든다.
   */
  public static SecurityCheckView viewOf(
      String status,
      String risk,
      String headline,
      List<Evidence> evidence,
      OffsetDateTime checkedAt,
      String error,
      Short criteriaVersion,
      boolean hasAi) {
    if (status == null) {
      return new SecurityCheckView(
          null, null, null, List.of(), null, hasAi ? null : SecurityCheckView.REASON_NO_AI);
    }
    String reason = null;
    if ("FAILED".equals(status)) {
      reason =
          FileSecurityCheckPipeline.ERROR_TOO_LARGE.equals(error)
              ? SecurityCheckView.REASON_TOO_LARGE
              : SecurityCheckView.REASON_ERROR;
    } else if (!hasAi && ("PENDING".equals(status) || "CHECKING".equals(status))) {
      reason = SecurityCheckView.REASON_NO_AI;
    }
    // 지난 판정 기준의 DONE — 화면이 결과는 그대로 보이되 「다시 점검」을 권한다(WP-1283).
    boolean outdated =
        "DONE".equals(status) && FileSecurityCheckRepository.isOutdated(criteriaVersion);
    return new SecurityCheckView(status, risk, headline, evidence, checkedAt, reason, outdated);
  }

  /** 근거 JSON 을 읽는다 — 깨졌으면 빈 목록(결과 표시 전체를 막지 않는다). {@code subject} 는 로그용 대상 표시. */
  public static List<Evidence> parseEvidence(
      ObjectMapper objectMapper, JSONB json, String subject) {
    if (json == null) return List.of();
    try {
      return objectMapper.readValue(json.data(), EVIDENCE_LIST);
    } catch (Exception e) {
      log.warn("보안 점검 근거 JSON 파싱 실패: {}", subject, e);
      return List.of();
    }
  }
}
