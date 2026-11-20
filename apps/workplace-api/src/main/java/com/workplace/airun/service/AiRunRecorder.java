package com.workplace.airun.service;

import com.workplace.airun.dto.AiRunBatchResponse;
import com.workplace.airun.dto.AiRunRecord;
import com.workplace.airun.repository.AiRunRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.global.tenant.TenantStatusChecker;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * AI 처리 기록(ai_run) 기록 서비스(WP-1827). 기록은 부가 기능이라 어떤 실패도 호출자(본 작업)에게 던지지 않는다.
 *
 * <p>테넌트별로 {@link TenantScopedRunner#runForTenant} 의 독립 트랜잭션에서 저장해 RLS GUC 가 보장되고, 한 테넌트 실패가 다른 테넌트
 * 묶음을 깨지 않는다.
 */
@Service
public class AiRunRecorder {

  private static final Logger log = LoggerFactory.getLogger(AiRunRecorder.class);
  private static final Pattern KIND = Pattern.compile("^[A-Z][A-Z0-9_]*$");
  private static final Set<String> STATUSES = Set.of("RUNNING", "SUCCEEDED", "FAILED", "SKIPPED");
  // 표의 actor_type CHECK 와 같은 값 — 틀린 값 하나가 묶음 트랜잭션 전체를 롤백시키지 않게 미리 거른다.
  private static final Set<String> ACTOR_TYPES = Set.of("AUTO", "USER", "AGENT");

  private final AiRunRepository repository;
  private final TenantScopedRunner tenantRunner;
  private final TenantStatusChecker tenantStatusChecker;

  public AiRunRecorder(
      AiRunRepository repository,
      TenantScopedRunner tenantRunner,
      TenantStatusChecker tenantStatusChecker) {
    this.repository = repository;
    this.tenantRunner = tenantRunner;
    this.tenantStatusChecker = tenantStatusChecker;
  }

  /**
   * API 안에서 한 건을 기록한다. TenantContext 가 있으면 그 테넌트, 없으면 {@code r.tenantId()} 로 저장한다. 예외는 잡아 WARN 로그만
   * 남긴다. runForTenant 가 끝나며 TenantContext 를 지우므로, 호출자의 컨텍스트를 저장해 두었다가 반드시 되돌린다(기록이 본 작업의 테넌트 맥락을 깨지
   * 않게).
   */
  public void upsert(AiRunRecord r) {
    Long previous = TenantContext.get();
    try {
      // ingest 와 같은 형식 검사(테넌트는 아래에서 따로 정한다) — 틀린 건은 예외 없이 WARN 만 남기고 버린다.
      if (!isValidShape(r)) {
        log.warn("AI 처리 기록 건너뜀 — 형식 오류: runId={}", r == null ? null : r.runId());
        return;
      }
      Long tenantId = previous != null ? previous : r.tenantId();
      if (tenantId == null) {
        log.warn("AI 처리 기록 건너뜀 — 테넌트 없음: runId={}", r.runId());
        return;
      }
      tenantRunner.runForTenant(tenantId, t -> repository.upsert(r));
    } catch (Exception e) {
      log.warn("AI 처리 기록 저장 실패(무시): runId={}", r.runId(), e);
    } finally {
      // 호출자 맥락 복원 — 없었다면 비운 채로 둔다.
      if (previous != null) {
        TenantContext.set(previous);
      } else {
        TenantContext.clear();
      }
    }
  }

  /**
   * 내부 수신 묶음을 저장한다. 필수값(테넌트·처리 ID·시작 시각)·status·kind·actorType 형식이 틀린 건은 버리고, 테넌트별로 묶어 활성 테넌트만 순서대로
   * 저장한다. 정지·없는 테넌트나 저장 예외는 그 테넌트 묶음만 버린다.
   */
  public AiRunBatchResponse ingest(List<AiRunRecord> records) {
    int dropped = 0;
    Map<Long, List<AiRunRecord>> byTenant = new LinkedHashMap<>();
    for (AiRunRecord r : records) {
      if (!isValid(r)) {
        dropped++;
        continue;
      }
      byTenant.computeIfAbsent(r.tenantId(), k -> new ArrayList<>()).add(r);
    }
    int accepted = 0;
    for (Map.Entry<Long, List<AiRunRecord>> e : byTenant.entrySet()) {
      List<AiRunRecord> group = e.getValue();
      if (!tenantStatusChecker.isActive(e.getKey())) {
        log.info("비활성·없는 테넌트 AI 처리 기록 무시: tenantId={}, {}건", e.getKey(), group.size());
        dropped += group.size();
        continue;
      }
      try {
        // 같은 처리 ID 가 묶음 안에 여러 번이어도 순서대로 upsert 가 한 행으로 합친다.
        tenantRunner.runForTenant(e.getKey(), t -> group.forEach(repository::upsert));
        accepted += group.size();
      } catch (Exception ex) {
        log.warn("AI 처리 기록 묶음 저장 실패 — 테넌트 {} {}건 버림", e.getKey(), group.size(), ex);
        dropped += group.size();
      }
    }
    return new AiRunBatchResponse(accepted, dropped);
  }

  private static boolean isValid(AiRunRecord r) {
    return r != null && r.tenantId() != null && isValidShape(r);
  }

  /** 테넌트를 뺀 필수값·형식 검사 — upsert 는 TenantContext 로 테넌트를 정할 수 있어 따로 둔다. */
  private static boolean isValidShape(AiRunRecord r) {
    return r != null
        && r.runId() != null
        && r.startedAt() != null
        && r.status() != null
        && STATUSES.contains(r.status())
        && r.kind() != null
        && KIND.matcher(r.kind()).matches()
        && (r.actorType() == null || ACTOR_TYPES.contains(r.actorType()));
  }
}
