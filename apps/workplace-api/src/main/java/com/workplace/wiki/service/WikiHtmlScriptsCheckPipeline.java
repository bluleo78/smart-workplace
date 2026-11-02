package com.workplace.wiki.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.fileai.exception.FileAiException;
import com.workplace.fileai.outbound.AiAgentDriveClient;
import com.workplace.fileai.outbound.AiAgentDriveClient.SecurityCheckReq;
import com.workplace.fileai.outbound.AiAgentDriveClient.SecurityCheckRes;
import com.workplace.fileai.security.FileSecurityCheckPipeline;
import com.workplace.fileai.security.FileSecurityCheckPipeline.Outcome;
import com.workplace.global.outbound.AgentOutageGuard;
import com.workplace.jooq.tables.records.WikiHtmlScriptsCheckRecord;
import com.workplace.wiki.repository.WikiHtmlScriptsCheckRepository;
import java.util.List;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 노트 HTML 블록 보안 점검 한 건의 상태 전이(WP-1290). 파일 점검({@link FileSecurityCheckPipeline})과 같은 단계·규칙이고, 점검
 * 입력만 다르다 — 원본 바이트 대신 요청 때 행에 적어 둔 요지(digest·truncated)를 읽는다. 그래서 스케줄러가 소스 없이 다시 점검할 수 있다.
 *
 * <ol>
 *   <li>짧은 트랜잭션: 비서(AI) 확인 → PENDING/lease 만료 CHECKING 선점(CAS, 시도 +1) → 요지·페이지 제목 읽기
 *   <li>트랜잭션 밖: ai-agent 호출(최대 {@link FileSecurityCheckPipeline#MAX_AGENT_TIMEOUT_MS})
 *   <li>짧은 트랜잭션: DONE / FAILED / PENDING 복귀
 * </ol>
 *
 * <p>요청이 ai-agent 에 닿지도 못한 실패(연결 거부·503)는 시도 횟수를 되돌린다(내용 탓이 아니다). 최대 시도는 파일 점검과 같다.
 */
@Slf4j
@Service
public class WikiHtmlScriptsCheckPipeline {

  /** 단발 점검이라 turn 1 고정. */
  private static final int MAX_TURNS = 1;

  private final WikiHtmlScriptsCheckRepository repo;
  private final AssistantResolver assistantResolver;
  private final AiAgentDriveClient driveClient;
  private final ObjectMapper objectMapper;

  /** 짧은 트랜잭션 — 진입 시 TenantAwareTransactionManager 가 RLS GUC 를 주입한다. */
  private final TransactionTemplate tx;

  public WikiHtmlScriptsCheckPipeline(
      WikiHtmlScriptsCheckRepository repo,
      AssistantResolver assistantResolver,
      AiAgentDriveClient driveClient,
      ObjectMapper objectMapper,
      PlatformTransactionManager txManager) {
    this.repo = repo;
    this.assistantResolver = assistantResolver;
    this.driveClient = driveClient;
    this.objectMapper = objectMapper;
    this.tx = new TransactionTemplate(txManager);
  }

  /** 선점한 행의 점검 입력. */
  private record Claimed(AssistantSpec spec, String digest, boolean truncated, String title) {}

  /** (페이지, 지문) 행 하나를 점검한다. TenantContext 가 세워져 있어야 한다. */
  public Outcome check(long pageId, String hash) {
    // ① 선점 — 비서 확인을 CAS 앞에 둬 AI 없는 워크스페이스에 CHECKING 행을 남기지 않는다.
    final Claimed[] holder = new Claimed[1];
    Outcome early =
        tx.execute(
            s -> {
              Optional<AssistantSpec> spec = assistantResolver.resolveWorkspaceOrEmpty();
              if (spec.isEmpty()) return Outcome.NO_AI;
              if (!repo.claim(pageId, hash)) return Outcome.NOT_CLAIMED;
              WikiHtmlScriptsCheckRecord row = repo.find(pageId, hash).orElseThrow();
              holder[0] =
                  new Claimed(
                      spec.get(),
                      row.getDigest(),
                      Boolean.TRUE.equals(row.getTruncated()),
                      repo.findPageTitle(pageId).orElse(""));
              return null;
            });
    if (early != null) {
      return early;
    }
    Claimed c = holder[0];
    // 요지가 비었으면(크기 초과로 만든 행이 어떤 까닭으로 PENDING 이 됐을 때) AI 에 보낼 것이 없다.
    if (c.digest() == null || c.digest().isEmpty()) {
      tx.executeWithoutResult(
          s -> repo.markFailed(pageId, hash, FileSecurityCheckPipeline.ERROR_TOO_LARGE));
      return Outcome.FAILED;
    }

    // ② AI 점검 — 트랜잭션 밖
    AssistantSpec spec = c.spec();
    SecurityCheckRes res;
    String evidenceJson;
    try {
      res =
          driveClient.securityCheck(
              new SecurityCheckReq(
                  c.digest(),
                  c.title(),
                  c.truncated(),
                  spec.agentUserId(),
                  spec.model(),
                  MAX_TURNS,
                  Math.min(spec.timeoutMs(), FileSecurityCheckPipeline.MAX_AGENT_TIMEOUT_MS)));
      FileSecurityCheckPipeline.validate(res);
      evidenceJson =
          objectMapper.writeValueAsString(res.evidence() == null ? List.of() : res.evidence());
    } catch (JsonProcessingException | RuntimeException ex) {
      return onAgentFailure(pageId, hash, ex);
    }

    // ③ 저장
    final SecurityCheckRes done = res;
    tx.executeWithoutResult(
        s -> repo.markDone(pageId, hash, done.risk(), done.headline(), evidenceJson, spec.model()));
    log.debug("노트 HTML 보안 점검 완료: pageId={} risk={}", pageId, done.risk());
    return Outcome.DONE;
  }

  /**
   * AI 호출 실패 처리 — 요청이 닿지도 못했으면 시도를 되돌려 PENDING, 그 밖엔 최대 시도에 닿았으면 FAILED, 아니면 PENDING 으로 돌려 스케줄러가 다시
   * 줍게 한다.
   */
  private Outcome onAgentFailure(long pageId, String hash, Exception ex) {
    String message = ex.getMessage();
    if (ex instanceof FileAiException f && f.isUnreached()) {
      String cause = AgentOutageGuard.describe(ex);
      log.warn("ai-agent 불가 — 시도 횟수 유지, PENDING 복귀: pageId={} ({})", pageId, cause);
      tx.executeWithoutResult(s -> repo.revertToPending(pageId, hash, cause, true));
      return Outcome.ATTEMPT_FAILED;
    }
    // 조회와 전이를 한 트랜잭션에서 — claim 이 이미 올린 시도 횟수로 판단한다.
    Boolean terminal =
        tx.execute(
            s -> {
              Integer attempts =
                  repo.find(pageId, hash).map(WikiHtmlScriptsCheckRecord::getAttempts).orElse(null);
              if (attempts != null && attempts >= FileSecurityCheckPipeline.MAX_ATTEMPTS) {
                repo.markFailed(pageId, hash, message);
                return true;
              }
              repo.revertToPending(pageId, hash, message, false);
              return false;
            });
    if (Boolean.TRUE.equals(terminal)) {
      log.warn(
          "노트 HTML 보안 점검 최대 시도({}) 도달 — FAILED: pageId={}",
          FileSecurityCheckPipeline.MAX_ATTEMPTS,
          pageId,
          ex);
      return Outcome.FAILED;
    }
    log.warn("노트 HTML 보안 점검 실패 — PENDING 복귀(재시도): pageId={}", pageId, ex);
    return Outcome.ATTEMPT_FAILED;
  }
}
