package com.workplace.agentruntime.screen;

import com.workplace.agentruntime.dto.AgentRuntimeStatus;
import com.workplace.agentruntime.dto.AgentScreenSessionResponse;
import com.workplace.agentruntime.exception.AgentScreenConflictException;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.agentruntime.repository.AgentScreenRepository;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeStatusResolver;
import com.workplace.audit.service.AuditLogService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import com.workplace.user.service.WorkspaceMemberGuard;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * AI 작업 화면 세션 서비스(WP-1277) — 관리자가 화면을 열 때의 확인·기록·접속 표 발급과, WebSocket 중계({@link AgentScreenRelay})가
 * 부르는 기록 쓰기(입력 허용·닫힘·입력 기록)를 맡는다.
 *
 * <p>중계 쪽 메서드는 Tomcat·타이머 스레드에서 불려 테넌트 컨텍스트가 없다 — 그래서 받은 테넌트로 컨텍스트를 세우고 새 트랜잭션을 열어(RLS GUC 주입) 쓴다.
 * 감사 로그도 같은 트랜잭션에 남는다.
 */
@Service
@Slf4j
public class AgentScreenService {

  /** 접속 표 수명 — 화면 창을 연 브라우저가 곧바로 연결하므로 짧게. */
  static final long TICKET_TTL_SECONDS = 30;

  /** AI 하나에 동시에 열 수 있는 작업 화면 수. */
  static final int MAX_SESSIONS_PER_AGENT = 3;

  private static final String NOT_RUNNING = "실행 중인 AI 만 작업 화면을 볼 수 있어요";

  private final AgentRuntimeSettingRepository settings;
  private final AgentLocationService locationService;
  private final AgentScreenRepository screens;
  private final WorkspaceMemberGuard memberGuard;
  private final UserRepository userRepository;
  private final AuditLogService auditLogService;
  private final AgentScreenTickets tickets;
  private final AgentScreenRelay relay;
  private final TenantScopedRunner tenantScopedRunner;
  private final TransactionTemplate tx;

  public AgentScreenService(
      AgentRuntimeSettingRepository settings,
      AgentLocationService locationService,
      AgentScreenRepository screens,
      WorkspaceMemberGuard memberGuard,
      UserRepository userRepository,
      AuditLogService auditLogService,
      AgentScreenTickets tickets,
      AgentScreenRelay relay,
      TenantScopedRunner tenantScopedRunner,
      PlatformTransactionManager txManager) {
    this.settings = settings;
    this.locationService = locationService;
    this.screens = screens;
    this.memberGuard = memberGuard;
    this.userRepository = userRepository;
    this.auditLogService = auditLogService;
    this.tickets = tickets;
    this.relay = relay;
    this.tenantScopedRunner = tenantScopedRunner;
    this.tx = new TransactionTemplate(txManager);
    // 요청 트랜잭션 안에서 불려도(open) 같은 트랜잭션에 합류하고, 중계 스레드에서는 새로 연다.
    this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRED);
    relay.setService(this);
  }

  /**
   * 작업 화면을 연다. 순서: 구성원 확인(아니면 404) → 실행 설정이 켜져 있고 상태가 RUNNING·APPLY_PENDING 인지(아니면 409) → 실제 위치(없으면
   * 409) → 이 AI 의 열린 화면 수 자리 잡기(3개면 409) → 세션 행·감사 → 접속 표 발급.
   */
  public AgentScreenSessionResponse open(long callerId, long agentId) {
    long tenantId = TenantContext.require();
    // 실행 설정 조회도 RLS 표라 트랜잭션(GUC) 안에서 해야 한다 — 확인·자리·기록을 한 트랜잭션에 둔다.
    return tx.execute(s -> doOpen(tenantId, callerId, agentId));
  }

  private AgentScreenSessionResponse doOpen(long tenantId, long callerId, long agentId) {
    memberGuard.require(agentId, tenantId);
    Row row =
        settings
            .find(agentId)
            .filter(AgentScreenService::isRunning)
            .orElseThrow(() -> new AgentScreenConflictException(NOT_RUNNING));
    Long locationId = locationService.effectiveLocationId(row.locationId());
    if (locationId == null) throw new AgentScreenConflictException(NOT_RUNNING);

    UUID sessionId = UUID.randomUUID();
    Instant expiresAt = Instant.now().plusSeconds(TICKET_TTL_SECONDS);
    if (!relay.reserve(sessionId, tenantId, agentId, locationId, callerId, expiresAt)) {
      throw new AgentScreenConflictException("이 AI 의 작업 화면이 이미 3개 열려 있어요");
    }
    try {
      screens.insert(sessionId, agentId, locationId, callerId);
      audit(
          callerId,
          "AGENT_SCREEN_OPENED",
          agentId,
          "작업 화면 열기",
          Map.of("sessionId", sessionId.toString(), "locationId", locationId));
    } catch (RuntimeException e) {
      // 기록에 실패하면 잡아 둔 자리를 바로 돌려준다(만료까지 자리를 막지 않게).
      relay.release(sessionId);
      throw e;
    }
    String ticket =
        tickets.issue(new AgentScreenTickets.Claims(sessionId, tenantId, callerId, expiresAt));
    return new AgentScreenSessionResponse(
        sessionId.toString(), ticket, expiresAt.atOffset(ZoneOffset.UTC));
  }

  /** 켜 둠이고 화면 상태가 실행 중(RUNNING) 또는 적용 대기(APPLY_PENDING)인지 — Pod 가 떠 있어야 runner 가 화면을 이을 수 있다. */
  private static boolean isRunning(Row r) {
    AgentRuntimeStatus s =
        AgentRuntimeStatusResolver.resolve(
            r.desired(), r.generation(), r.observedGeneration(), r.phase());
    return s == AgentRuntimeStatus.RUNNING || s == AgentRuntimeStatus.APPLY_PENDING;
  }

  /** 입력 허용을 세션 행과 감사 로그에 남긴다(중계 스레드에서 부름). */
  void recordInputEnabled(long tenantId, UUID sessionId, long agentId, long adminId) {
    inTenant(
        tenantId,
        () -> {
          screens.markInputEnabled(sessionId, adminId);
          audit(
              adminId,
              "AGENT_SCREEN_INPUT_ENABLED",
              agentId,
              "작업 화면 입력 허용",
              Map.of("sessionId", sessionId.toString()));
        });
  }

  /** 닫힌 때·까닭을 남긴다(중계 스레드에서 부름). */
  void recordClosed(long tenantId, UUID sessionId, String reason) {
    inTenant(tenantId, () -> screens.close(sessionId, reason));
  }

  /** 입력 기록 덩어리들을 순서대로 넣는다(중계 타이머에서 부름). */
  void recordInput(long tenantId, UUID sessionId, List<String> chunks) {
    if (chunks.isEmpty()) return;
    inTenant(tenantId, () -> chunks.forEach(c -> screens.insertInput(sessionId, c)));
  }

  /**
   * 닫히지 않은 채 남은 옛 세션 행을 닫는다 — 파드가 비정상 종료하면 그 파드의 세션 행이 열린 채 남는다(정상 종료는 중계가 스스로 닫는다). 열린 화면 수는 메모리로
   * 세므로 자리를 막지는 않지만 기록이 「열린 채」로 남지 않게 한다. 최대 수명(4시간)보다 오래된 행만 닫는다 — 롤링 배포 중 옛 파드에서 아직 살아 있는 세션의 기록을
   * 새 파드가 닫아 버리지 않게. 서버가 뜰 때와 한 시간마다 돈다(어느 파드가 돌아도 같은 결과).
   */
  @EventListener(ApplicationReadyEvent.class)
  @Scheduled(fixedDelay = 1, initialDelay = 1, timeUnit = TimeUnit.HOURS)
  @SchedulerLock(name = "AgentScreenService.closeStaleSessions")
  public void closeStaleSessions() {
    OffsetDateTime cutoff =
        OffsetDateTime.now().minus(AgentScreenRelay.MAX_LIFETIME).minusMinutes(5);
    tenantScopedRunner.forEachActiveTenant(
        t -> screens.closeOpenedBefore(cutoff, "작업 화면 서버가 끊겨 닫혔어요"));
  }

  private void inTenant(long tenantId, Runnable work) {
    TenantContext.runAs(tenantId, () -> tx.executeWithoutResult(s -> work.run()));
  }

  private void audit(
      long callerId, String action, long agentId, String description, Map<String, Object> meta) {
    String username =
        userRepository.findById(callerId).map(UserResponse::username).orElse("system");
    auditLogService.log(
        callerId,
        username,
        action,
        "user",
        String.valueOf(agentId),
        description,
        null,
        null,
        "SUCCESS",
        null,
        meta);
  }
}
