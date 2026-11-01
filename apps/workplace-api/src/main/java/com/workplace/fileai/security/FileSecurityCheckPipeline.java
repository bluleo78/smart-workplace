package com.workplace.fileai.security;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.file.storage.FileStore;
import com.workplace.fileai.exception.FileAiException;
import com.workplace.fileai.outbound.AiAgentDriveClient;
import com.workplace.fileai.outbound.AiAgentDriveClient.SecurityCheckReq;
import com.workplace.fileai.outbound.AiAgentDriveClient.SecurityCheckRes;
import com.workplace.fileai.security.FileSecurityCheckRepository.FileMeta;
import com.workplace.global.outbound.AgentOutageGuard;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * HTML 보안 점검 한 건의 상태 전이(WP-1262). 요약 파이프라인({@code FileExtractionPipeline.summarizePending})을 따른다.
 *
 * <ol>
 *   <li>짧은 트랜잭션: 비서(AI) 확인 → file 행 조회(저장소 경로에서 내부 카테고리면 선점하지 않는다) → PENDING/lease 만료 CHECKING
 *       선점(CAS, 시도 +1)
 *   <li>트랜잭션 밖: 크기 확인 → 바이트 읽기 → 인코딩 판정·스크립트 판정·요지({@link #prepare}) → ai-agent 호출(최대 {@link
 *       #MAX_AGENT_TIMEOUT_MS}, DB 커넥션을 쥐지 않는다)
 *   <li>짧은 트랜잭션: DONE / SKIPPED / FAILED / PENDING 복귀
 * </ol>
 *
 * <p>비서 확인은 선점 전에 한다 — AI 가 없는 워크스페이스에서 CHECKING 행을 남기지 않는다. 요청이 ai-agent 에 닿지도 못한 실패(연결 거부·503)는
 * 시도 횟수를 되돌린다(파일 탓이 아니다).
 */
@Slf4j
@Service
public class FileSecurityCheckPipeline {

  /** 한 건의 처리 결과. */
  public enum Outcome {
    /** AI 점검을 마쳐 저장했다. */
    DONE,
    /** 스크립트가 없어 AI 를 부르지 않았다. */
    SKIPPED,
    /** 이번 시도가 실패했고 다시 시도할 수 있다(PENDING 복귀). */
    ATTEMPT_FAILED,
    /** 더 시도하지 않는다(FAILED). */
    FAILED,
    /** 선점하지 못했다 — 행이 없거나 다른 처리기가 쥐고 있거나 이미 끝났다. */
    NOT_CLAIMED,
    /** 워크스페이스에 AI 가 없어 손대지 않았다. */
    NO_AI
  }

  /** 원본 크기 상한 — 넘으면 읽지 않고 FAILED. */
  static final long MAX_BYTES = 20L * 1024 * 1024;

  /** 자동 점검 최대 시도 횟수. */
  static final int MAX_ATTEMPTS = 3;

  /** 단발 점검이라 turn 1 고정. */
  private static final int MAX_TURNS = 1;

  /**
   * ai-agent 호출 timeout 상한(8분). 비서 사양의 timeoutMs 는 상한이 없어 CHECKING lease(10분, {@link
   * FileSecurityCheckRepository#LEASE})보다 길면 lease 가 먼저 끝나 스케줄러가 같은 파일을 한 번 더 부르거나, 늦게 온 성공이 이미
   * FAILED 로 판정된 행에 닿지 못한다. lease 안에 끝나도록 여유를 두고 자른다.
   */
  static final long MAX_AGENT_TIMEOUT_MS = 8L * 60 * 1000;

  /** 저장해도 되는 위험도 — ai-agent 가 검증하지만 저장 전에 한 번 더 본다(어긋나면 재시도 대상 실패). */
  private static final Set<String> RISKS = Set.of("LOW", "CAUTION", "HIGH");

  /** 저장해도 되는 근거 종류. */
  private static final Set<String> EVIDENCE_KINDS =
      Set.of("EXTERNAL_REQUEST", "CREDENTIAL_INPUT", "OBFUSCATION", "NAVIGATION", "OTHER");

  static final String ERROR_TOO_LARGE = "too-large";
  static final String ERROR_MISSING_BINARY = "missing-binary";
  static final String ERROR_FILE_NOT_FOUND = "file-not-found";

  /**
   * 원본 바이트를 줄인 점검 입력 — 크기 초과·스크립트 없음·요지(≤ 60k자) 중 하나. 메일 원본(최대 25MiB)을 실행기 큐에 붙잡지 않으려고 요청 스레드에서 미리
   * 만들어 넘긴다.
   */
  public record Prepared(Kind kind, ScriptDigest.Result digest) {

    /** 줄인 결과의 종류. */
    public enum Kind {
      /** 원본이 {@link #MAX_BYTES} 를 넘는다. */
      TOO_LARGE,
      /** 스크립트가 없어 AI 를 부를 것이 없다. */
      NO_SCRIPTS,
      /** 스크립트가 있다 — {@code digest} 를 AI 에 보낸다. */
      SCRIPTS
    }

    /** AI 를 부르지 않고 바로 끝낼 수 있는지(크기 초과·스크립트 없음). */
    public boolean terminal() {
      return kind != Kind.SCRIPTS;
    }
  }

  /** 원본 바이트 → 점검 입력. 인코딩은 BOM·meta charset 으로 판정한다({@link HtmlCharset}). */
  public static Prepared prepare(byte[] bytes) {
    if (bytes.length > MAX_BYTES) return new Prepared(Prepared.Kind.TOO_LARGE, null);
    String html = HtmlCharset.decode(bytes);
    if (!HtmlScriptRules.hasScripts(html)) return new Prepared(Prepared.Kind.NO_SCRIPTS, null);
    return new Prepared(Prepared.Kind.SCRIPTS, ScriptDigest.build(html));
  }

  private final FileSecurityCheckRepository repo;
  private final AssistantResolver assistantResolver;
  private final AiAgentDriveClient driveClient;
  private final FileStore fileStore;
  private final ObjectMapper objectMapper;

  /** 짧은 트랜잭션 — 진입 시 TenantAwareTransactionManager 가 RLS GUC 를 주입한다. */
  private final TransactionTemplate tx;

  public FileSecurityCheckPipeline(
      FileSecurityCheckRepository repo,
      AssistantResolver assistantResolver,
      AiAgentDriveClient driveClient,
      FileStore fileStore,
      ObjectMapper objectMapper,
      PlatformTransactionManager txManager) {
    this.repo = repo;
    this.assistantResolver = assistantResolver;
    this.driveClient = driveClient;
    this.fileStore = fileStore;
    this.objectMapper = objectMapper;
    this.tx = new TransactionTemplate(txManager);
  }

  /** 저장소의 바이너리로 점검한다(업로드 자동 점검·스케줄러·다시 점검). TenantContext 가 세워져 있어야 한다. */
  public Outcome check(long fileId) {
    return run(fileId, null, null);
  }

  /**
   * 미리 줄인 입력으로 점검한다(메일 첨부 — 사본 바이너리는 추출 직후 지워져 저장소로 읽을 수 없고, 원본 바이트는 큐에 붙잡지 않는다). 결과는 그 사본 file id
   * 로 저장한다.
   *
   * <p>메일 사본 행은 스케줄러가 줍지 않으므로 실패하면 재시도 대기(PENDING) 없이 바로 FAILED 로 끝낸다 — PENDING 으로 두면 「점검 중」에 영원히
   * 머문다. 사용자는 「다시 점검」으로 새로 요청한다.
   */
  public Outcome check(long fileId, Prepared prepared, String fileName) {
    return run(fileId, prepared, fileName);
  }

  private Outcome run(long fileId, Prepared givenPrepared, String givenName) {
    boolean bytesMode = givenPrepared != null;
    // ① 선점 — 비서 확인을 CAS 앞에 둬 AI 없는 워크스페이스에 CHECKING 행을 남기지 않는다.
    final AssistantSpec[] specHolder = new AssistantSpec[1];
    final FileMeta[] metaHolder = new FileMeta[1];
    Outcome claimed =
        tx.execute(
            s -> {
              Optional<AssistantSpec> spec = assistantResolver.resolveWorkspaceOrEmpty();
              if (spec.isEmpty()) return Outcome.NO_AI;
              specHolder[0] = spec.get();
              FileMeta m = repo.findFileMeta(fileId).orElse(null);
              // 저장소 경로는 내부 카테고리(메일 사본)를 선점하지 않는다 — 바이너리가 곧 지워져 FAILED(missing-binary)로 끝나거나 메일 요청
              // 점검과
              // 같은 행을 두고 다툰다. 메일은 받은 바이트로 점검한다(이중 방어 — 리스너·스케줄러도 거른다).
              if (!bytesMode && m != null && m.internal()) return Outcome.NOT_CLAIMED;
              if (!repo.claim(fileId)) return Outcome.NOT_CLAIMED;
              metaHolder[0] = m;
              return null;
            });
    if (claimed != null) {
      return claimed;
    }
    AssistantSpec spec = specHolder[0];
    FileMeta meta = metaHolder[0];

    Prepared prepared;
    if (bytesMode) {
      prepared = givenPrepared;
    } else {
      if (meta == null) {
        return fail(fileId, ERROR_FILE_NOT_FOUND);
      }
      // ② 크기 — file 행 크기로 판정해 큰 파일을 읽지 않는다.
      if (meta.sizeBytes() > MAX_BYTES) {
        return fail(fileId, ERROR_TOO_LARGE);
      }
      // ③ 바이트 — 바이너리가 없으면(지워진 파일 등) 다시 해도 같으므로 재시도 없이 FAILED.
      byte[] bytes;
      try {
        if (meta.storagePath() == null || !fileStore.exists(meta.storagePath())) {
          return fail(fileId, ERROR_MISSING_BINARY);
        }
        bytes = fileStore.readAllBytes(meta.storagePath());
      } catch (RuntimeException e) {
        // 경로 거부·읽기 실패 — 바이너리를 쓸 수 없다는 점에서 없는 것과 같다.
        log.warn("보안 점검 원본 읽기 실패 — FAILED: fileId={}", fileId, e);
        return fail(fileId, ERROR_MISSING_BINARY);
      }
      prepared = prepare(bytes);
    }

    // ④ 크기 초과·스크립트 없음은 AI 를 부르지 않고 끝낸다.
    switch (prepared.kind()) {
      case TOO_LARGE -> {
        return fail(fileId, ERROR_TOO_LARGE);
      }
      case NO_SCRIPTS -> {
        tx.executeWithoutResult(s -> repo.markSkipped(fileId));
        return Outcome.SKIPPED;
      }
      case SCRIPTS -> {
        // 아래 AI 점검으로
      }
    }

    // ⑤ AI 점검 — 트랜잭션 밖
    ScriptDigest.Result digest = prepared.digest();
    String fileName =
        givenName != null
            ? givenName
            : (meta != null && meta.originalName() != null ? meta.originalName() : "");
    SecurityCheckRes res;
    String evidenceJson;
    try {
      res =
          driveClient.securityCheck(
              new SecurityCheckReq(
                  digest.text(),
                  fileName,
                  digest.truncated(),
                  spec.agentUserId(),
                  spec.model(),
                  MAX_TURNS,
                  Math.min(spec.timeoutMs(), MAX_AGENT_TIMEOUT_MS)));
      validate(res);
      evidenceJson =
          objectMapper.writeValueAsString(res.evidence() == null ? List.of() : res.evidence());
    } catch (JsonProcessingException | RuntimeException ex) {
      return onAgentFailure(fileId, ex, bytesMode);
    }

    // ⑥ 저장
    final SecurityCheckRes done = res;
    tx.executeWithoutResult(
        s -> repo.markDone(fileId, done.risk(), done.headline(), evidenceJson, spec.model()));
    log.debug("HTML 보안 점검 완료: fileId={} risk={}", fileId, done.risk());
    return Outcome.DONE;
  }

  /**
   * 응답 검증 — 비었거나 위험도·근거 종류가 고정 값이 아니면 재시도 대상 실패로 던진다. 저장 단계(markDone)에서 터지면 시도 상한 밖이라 행이 CHECKING 에
   * 남아 lease 마다 끝없이 다시 돈다.
   */
  private static void validate(SecurityCheckRes res) {
    if (res == null || res.risk() == null) {
      throw new IllegalStateException("security-check: 빈 응답");
    }
    if (!RISKS.contains(res.risk())) {
      throw new IllegalStateException("security-check: 알 수 없는 위험도 " + res.risk());
    }
    if (res.evidence() != null) {
      for (var e : res.evidence()) {
        if (e == null || !EVIDENCE_KINDS.contains(e.kind())) {
          throw new IllegalStateException(
              "security-check: 알 수 없는 근거 종류 " + (e == null ? null : e.kind()));
        }
      }
    }
  }

  /**
   * AI 호출 실패 처리. 메일(바이트) 경로는 바로 FAILED. 요청이 닿지도 못했으면 시도를 되돌려 PENDING, 그 밖엔 최대 시도에 닿았으면 FAILED, 아니면
   * PENDING 으로 돌려 스케줄러가 다시 줍게 한다.
   */
  private Outcome onAgentFailure(long fileId, Exception ex, boolean bytesMode) {
    String message = ex.getMessage();
    if (bytesMode) {
      log.warn("HTML 보안 점검 실패(메일 사본) — FAILED: fileId={}", fileId, ex);
      return fail(fileId, message);
    }
    if (ex instanceof FileAiException f && f.isUnreached()) {
      String cause = AgentOutageGuard.describe(ex);
      log.warn("ai-agent 불가 — 시도 횟수 유지, PENDING 복귀: fileId={} ({})", fileId, cause);
      tx.executeWithoutResult(s -> repo.revertToPending(fileId, cause, true));
      return Outcome.ATTEMPT_FAILED;
    }
    // 조회와 전이를 한 트랜잭션에서 — claim 이 이미 올린 시도 횟수로 판단한다.
    Boolean terminal =
        tx.execute(
            s -> {
              Integer attempts = repo.findAttempts(fileId);
              if (attempts != null && attempts >= MAX_ATTEMPTS) {
                repo.markFailed(fileId, message);
                return true;
              }
              repo.revertToPending(fileId, message, false);
              return false;
            });
    if (Boolean.TRUE.equals(terminal)) {
      log.warn("HTML 보안 점검 최대 시도({}) 도달 — FAILED: fileId={}", MAX_ATTEMPTS, fileId, ex);
      return Outcome.FAILED;
    }
    log.warn("HTML 보안 점검 실패 — PENDING 복귀(재시도): fileId={}", fileId, ex);
    return Outcome.ATTEMPT_FAILED;
  }

  /** CHECKING→FAILED. */
  private Outcome fail(long fileId, String error) {
    tx.executeWithoutResult(s -> repo.markFailed(fileId, error));
    return Outcome.FAILED;
  }
}
