package com.workplace.agentaccount.service;

import com.workplace.agentaccount.repository.AgentAccountBindingRepository;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.auth.dto.AiAgentCredentialRow;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.service.AgentProviders;
import com.workplace.auth.service.LoginInfoNormalizer;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 기존 연결 이관 백필(WP-1448) — 작업 공간(Pod) 실행 방식 AI 가 쓰던 옛 연결({@code ai_agent_credential})을 계정 목록의 계정으로
 * 옮기고 그 AI 가 계정을 가리키게 한다. 같은 키(같은 종류·같은 지문)를 쓰던 AI 들은 계정 하나를 함께 가리킨다.
 *
 * <p>대상: 실행 설정 행이 있고(Pod 방식), 아직 묶이지 않았고, 개인 비서가 아니고, 활성 연결이 있는 AI. 개인 비서·다른 실행 방식 AI 는 지금 방식 그대로
 * 둔다(설계 「이관」).
 *
 * <ul>
 *   <li><b>그룹을 먼저 모은다</b> — 테넌트의 대상 원문을 모두 읽어 지문으로 묶은 뒤 계정을 만든다. 로그인형(chatgpt·genia)은 같은 계정이어도 AI
 *       마다 갱신 토큰이 다를 수 있어 auth.json {@code last_refresh} 가 가장 최근인 원문을 살린다(없거나 읽지 못하면 가장 옛것). 옛 갱신
 *       토큰은 이미 쓰여 무효일 수 있다.
 *   <li><b>만들고 묶기는 다리와 같은 경로</b> — {@link AgentAccountService#findOrRegisterFromBackfill}·{@link
 *       AgentAccountBindingService#bindFromBackfill}. 새 로그인형 계정은 「확인 필요」. 묶음에 그 AI 의 옛 연결 id 를 버전
 *       원천으로 남겨 runner 가 받는 claude/login 버전이 이관 전과 똑같다 — 일하던 Pod 가 서버 쪽 이관 때문에 다시 만들어지지 않는다. 합쳐진
 *       그룹의 AI 도 저마다 자기 옛 연결 id 를 이어받는다(실제 변경 — 원문 교체·다른 계정으로 옮기기 — 이 생길 때까지 Pod 는 가진 것을 쓴다). 버전이
 *       그대로이므로 runner 알림도 내지 않는다.
 *   <li><b>연결 행은 고치지 않는다</b> — 롤링 배포 중 옛 버전이 계속 읽는다. 정리는 다음 단계(contract).
 *   <li><b>AI 하나의 실패는 그 AI 만</b> — 원문을 읽지 못하면 경고 로그(원문·암호문은 싣지 않는다) 후 건너뛴다. 묶기 검사(템플릿 사라짐·맞지 않는
 *       종류)에 걸리면 그 AI 의 savepoint 만 되돌린다.
 *   <li><b>여러 대 동시 기동</b> — 테넌트마다 advisory xact lock 을 시도해 한 대만 처리한다. 묶인 AI 는 대상에서 빠지므로 다시 돌아도 계정이
 *       늘지 않는다(멱등).
 * </ul>
 */
@Slf4j
@Component
public class AgentAccountBackfill {

  private final TenantScopedRunner tenantRunner;
  private final AgentAccountRepository accounts;
  private final AgentAccountBindingRepository bindings;
  private final AgentRuntimeSettingRepository settings;
  private final AiAgentCredentialRepository credentials;
  private final UserRepository userRepository;
  private final EncryptionService encryptionService;
  private final AgentAccountService accountService;
  private final AgentAccountBindingService bindingService;

  /** 테넌트 하나를 한 트랜잭션에서 — 이미 트랜잭션 안이면(테넌트 순회·테스트) 그것에 합류한다. */
  private final TransactionTemplate tenantTx;

  /** AI 하나의 savepoint — 묶기 검사 실패가 테넌트 트랜잭션 전체를 rollback-only 로 만들지 않게. */
  private final TransactionTemplate savepoint;

  /** 기동 때 돌지 — 테스트 프로파일은 끈다(캐시된 테스트 컨텍스트마다 돌지 않게, 스케줄러 WP-80 과 같은 까닭). */
  private final boolean onStartup;

  public AgentAccountBackfill(
      TenantScopedRunner tenantRunner,
      AgentAccountRepository accounts,
      AgentAccountBindingRepository bindings,
      AgentRuntimeSettingRepository settings,
      AiAgentCredentialRepository credentials,
      UserRepository userRepository,
      EncryptionService encryptionService,
      AgentAccountService accountService,
      AgentAccountBindingService bindingService,
      PlatformTransactionManager txManager,
      @Value("${workplace.agent-account.backfill-on-startup:true}") boolean onStartup) {
    this.tenantRunner = tenantRunner;
    this.accounts = accounts;
    this.bindings = bindings;
    this.settings = settings;
    this.credentials = credentials;
    this.userRepository = userRepository;
    this.encryptionService = encryptionService;
    this.accountService = accountService;
    this.bindingService = bindingService;
    this.tenantTx = new TransactionTemplate(txManager);
    this.savepoint = new TransactionTemplate(txManager);
    this.savepoint.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
    this.onStartup = onStartup;
  }

  /** 옮길 AI 하나 — 원문은 평문이라 {@link #toString()} 에 싣지 않는다. */
  private record Candidate(
      UserResponse agent,
      long credentialId,
      String provider,
      String plaintext,
      String fingerprint,
      Instant lastRefresh) {
    @Override
    public String toString() {
      return "Candidate[agent=" + agent.id() + ", provider=" + provider + "]";
    }
  }

  /** 기동 뒤 진입점 — 켜져 있으면 모든 활성 테넌트를 돈다. 어떤 실패도 기동을 막지 않는다. */
  @EventListener(ApplicationReadyEvent.class)
  public void onApplicationReady() {
    if (onStartup) backfillAllTenants();
  }

  /** 모든 활성 테넌트를 테넌트별 트랜잭션(GUC)에서 이관한다 — 한 테넌트의 실패는 경고 후 다음 테넌트로(TenantScopedRunner). */
  public void backfillAllTenants() {
    try {
      tenantRunner.forEachActiveTenant(this::backfillTenant);
    } catch (RuntimeException e) {
      // 테넌트 목록 조회 실패 등 — 기동을 막지 않고 다음 기동에 다시 시도한다.
      log.warn("AI 계정 이관 백필 실패 — 다음 기동에 다시 시도: {}", e.getClass().getSimpleName());
    }
  }

  /**
   * 테넌트 하나를 이관한다. 다른 대가 이 테넌트를 처리 중이면(잠금을 못 잡음) 아무것도 하지 않는다.
   *
   * @return 이 테넌트에서 새로 계정에 묶은 AI 수
   */
  public int backfillTenant(long tenantId) {
    Integer n = TenantContext.callAs(tenantId, () -> tenantTx.execute(s -> backfillInTx(tenantId)));
    return n == null ? 0 : n;
  }

  /** 테넌트 트랜잭션 안의 본체 — 잠금 → 대상 모으기 → 지문 그룹 → AI 마다 savepoint 에서 계정 찾기·만들기와 묶기. */
  private int backfillInTx(long tenantId) {
    if (!accounts.tryLockBackfill(tenantId)) {
      log.info("AI 계정 이관 백필 — 다른 서버가 처리 중이라 건너뜀 tenant={}", tenantId);
      return 0;
    }
    Map<String, List<Candidate>> groups = collectGroups();
    int bound = 0;
    for (List<Candidate> group : groups.values()) {
      Candidate best = latest(group);
      for (Candidate c : group) {
        if (bindOne(c, best)) bound++;
      }
    }
    if (bound > 0) log.info("AI 계정 이관 백필 — tenant={} 묶은 AI {}개", tenantId, bound);
    return bound;
  }

  /** 대상 AI 의 옛 연결 원문을 읽어 (종류, 지문) 으로 묶는다 — AI id 순서를 지킨다(먼저 나온 AI 의 이름이 계정 라벨이 된다). */
  private Map<String, List<Candidate>> collectGroups() {
    Map<String, List<Candidate>> groups = new LinkedHashMap<>();
    List<Long> podAgents =
        settings.findAll().stream().map(AgentRuntimeSettingRepository.Row::agentUserId).toList();
    if (podAgents.isEmpty()) return groups; // 옮길 것이 없으면 여기서 끝(기동 비용 최소)
    Map<Long, Long> alreadyBound = bindings.findAccountIds(podAgents);
    List<Long> unbound = podAgents.stream().filter(id -> !alreadyBound.containsKey(id)).toList();
    if (unbound.isEmpty()) return groups;
    // 순서는 unbound 를 따라 도므로 맵 순서는 상관없다.
    Map<Long, UserResponse> users =
        userRepository.findByIds(unbound).stream()
            .collect(Collectors.toMap(UserResponse::id, Function.identity(), (a, b) -> a));
    for (Long agentId : unbound) {
      UserResponse agent = users.get(agentId);
      if (agent == null || AgentUsernames.isPersonalAssistant(agent.username())) continue;
      Optional<AiAgentCredentialRow> credential = credentials.findActive(agentId);
      if (credential.isEmpty()) continue;
      Candidate c = read(agent, credential.get());
      if (c == null) continue;
      groups.computeIfAbsent(c.provider() + ":" + c.fingerprint(), k -> new ArrayList<>()).add(c);
    }
    return groups;
  }

  /** 연결 원문을 복호화·정규화해 후보로 — 읽지 못하면 경고 후 null(원문·암호문은 로그에 싣지 않는다). */
  private Candidate read(UserResponse agent, AiAgentCredentialRow row) {
    String provider = AgentProviders.normalize(row.provider());
    if (!AgentProviders.ALL.contains(provider)) {
      log.warn("AI 계정 이관 건너뜀 — 모르는 계정 종류 agent={} provider={}", agent.id(), provider);
      return null;
    }
    try {
      String plaintext = encryptionService.decrypt(row.encryptedToken());
      boolean login = AgentProviders.isLogin(provider);
      String normalized = login ? LoginInfoNormalizer.normalize(provider, plaintext) : plaintext;
      return new Candidate(
          agent,
          row.id(),
          provider,
          normalized,
          AgentAccountService.fingerprint(provider, normalized),
          login ? AgentAccountService.lastRefreshOf(normalized) : null);
    } catch (RuntimeException e) {
      log.warn(
          "AI 계정 이관 건너뜀 — 연결 원문을 읽지 못함 agent={} credential={} ({})",
          agent.id(),
          row.id(),
          e.getClass().getSimpleName());
      return null;
    }
  }

  /** 그룹에서 살릴 원문 — last_refresh 가 가장 최근인 후보(없는 것은 가장 옛것, 같으면 먼저 나온 AI). 로그인형이 아니면 원문이 모두 같다. */
  private static Candidate latest(List<Candidate> group) {
    Candidate best = group.getFirst();
    for (Candidate c : group) {
      if (c.lastRefresh() != null
          && (best.lastRefresh() == null || c.lastRefresh().isAfter(best.lastRefresh()))) {
        best = c;
      }
    }
    return best;
  }

  /**
   * AI 하나를 savepoint 안에서 그룹 원문의 계정에 묶는다. 그룹 첫 AI 가 계정을 만들고, 나머지는 같은 지문으로 그 계정을 찾는다.
   *
   * @return 묶었으면 true, 검사·검증에 걸려 건너뛰었으면 false(연결은 그대로)
   */
  private boolean bindOne(Candidate c, Candidate best) {
    long agentId = c.agent().id();
    try {
      savepoint.executeWithoutResult(
          s -> {
            long accountId =
                accountService.findOrRegisterFromBackfill(
                    best.provider(),
                    best.plaintext(),
                    AgentAccountPodSource.defaultLabel(c.agent()));
            bindingService.bindFromBackfill(agentId, accountId, c.credentialId());
          });
      return true;
    } catch (RuntimeException e) {
      // 예외 메시지는 싣지 않는다 — DB 오류 메시지에 값이 섞일 수 있다.
      log.warn(
          "AI 계정 이관 건너뜀 — agent={} provider={} ({})",
          agentId,
          c.provider(),
          e.getClass().getSimpleName());
      return false;
    }
  }
}
