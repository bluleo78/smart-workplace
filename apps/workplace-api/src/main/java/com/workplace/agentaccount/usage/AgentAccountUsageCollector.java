package com.workplace.agentaccount.usage;

import static com.workplace.agentaccount.service.AgentAccountService.STATUS_ACTIVE;
import static com.workplace.agentaccount.service.AgentAccountService.STATUS_NEEDS_CHECK;
import static com.workplace.agentaccount.service.AgentAccountService.STATUS_RELOGIN_REQUIRED;

import com.workplace.agentaccount.dto.AgentAccountRow;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * AI 계정 사용량 수집 서비스(WP-1449). 테넌트의 조회 대상 계정(폐기 안 된 Claude·ChatGPT 계정)마다 임대를 잡고, 원문을 복호화해 provider 별
 * 조회기로 사용률을 읽어 저장한다.
 *
 * <ul>
 *   <li><b>트랜잭션 밖 네트워크</b> — 조회기 호출(외부 HTTPS)은 어떤 트랜잭션에도 싸이지 않는다. 계정 읽기·결과 저장만 짧은 트랜잭션(GUC 주입)으로
 *       연다. 감싸면 커넥션이 외부 왕복 내내 idle-in-transaction 으로 묶인다.
 *   <li><b>한 번에 한 쪽만</b> — 여러 대·여러 회차가 같은 계정을 잡아도 {@link AgentAccountUsageRepository#tryClaim} 이
 *       한쪽만 통과시킨다.
 *   <li><b>폐기·원문 교체 경합</b> — 결과를 저장할 때 계정 행을 잠가 다시 읽는다. 그 사이 폐기됐거나 원문이 바뀌었으면(secret_version) 결과를
 *       버리고 임대만 푼다 — 폐기 계정에 스냅샷이 새로 생기거나, 옛 원문의 401 로 새 원문 계정이 「다시 로그인 필요」가 되지 않게.
 *   <li><b>계정 상태 전이</b> — 「확인 필요(NEEDS_CHECK)」·「다시 로그인 필요(RELOGIN_REQUIRED)」 계정은 조회 성공이면
 *       「정상(ACTIVE)」, 「확인 필요」 계정이 401 계열(UNAUTHORIZED·TOKEN_EXPIRED)이면 「다시 로그인
 *       필요(RELOGIN_REQUIRED)」. 「정상」 계정의 401 은 상태를 바꾸지 않고 실패 이유만 남긴다(일시적 거절일 수 있다).
 *   <li><b>평문 금지</b> — 복호화한 원문은 지역 변수로만 조회기에 넘기고 저장·로그하지 않는다. 실패 이유는 조회기 예외의 코드·짧은 문구만.
 * </ul>
 */
@Slf4j
@Service
public class AgentAccountUsageCollector {

  /** 「확인 필요」 계정을 「다시 로그인 필요」로 넘기는 401 계열 실패 코드. */
  private static final Set<String> UNAUTHORIZED_CODES = Set.of("UNAUTHORIZED", "TOKEN_EXPIRED");

  private final AgentAccountRepository accounts;
  private final AgentAccountUsageRepository usage;
  private final EncryptionService encryption;
  private final AgentAccountUsageProperties props;

  /** provider → 조회기. */
  private final Map<String, UsageProbe> probes;

  /** 계정 읽기·결과 저장용 짧은 트랜잭션 — 이미 트랜잭션 안이면 합류한다(테스트). 네트워크 호출은 이 밖에서. */
  private final TransactionTemplate tx;

  public AgentAccountUsageCollector(
      AgentAccountRepository accounts,
      AgentAccountUsageRepository usage,
      EncryptionService encryption,
      List<UsageProbe> probes,
      AgentAccountUsageProperties props,
      PlatformTransactionManager txManager) {
    this.accounts = accounts;
    this.usage = usage;
    this.encryption = encryption;
    this.props = props;
    this.probes =
        probes.stream()
            .collect(Collectors.toUnmodifiableMap(UsageProbe::provider, Function.identity()));
    this.tx = new TransactionTemplate(txManager);
  }

  /** 조회 한 번의 결과 — 성공(reading) 또는 실패(코드·문구) 중 하나. 원문은 담지 않는다. */
  private record Outcome(UsageReading reading, String errorCode, String errorMessage) {
    static Outcome success(UsageReading reading) {
      return new Outcome(reading, null, null);
    }

    static Outcome failure(String code, String message) {
      return new Outcome(null, code, message);
    }

    boolean succeeded() {
      return reading != null;
    }
  }

  /**
   * 테넌트 하나의 조회 대상 계정을 모두 조회한다. 그 테넌트를 활성 테넌트로 세운 채(GUC 는 짧은 트랜잭션마다 주입) 돌고, 끝나면 이전 테넌트로 되돌린다. 한 계정의
   * 예외는 로그만 남기고(원문·예외 메시지 없이) 다음 계정으로 넘어간다.
   */
  public void collectTenant(long tenantId) {
    TenantContext.runAs(
        tenantId,
        () -> {
          List<AgentAccountRow> targets =
              tx.execute(
                  s ->
                      accounts.findAllActive().stream()
                          .filter(a -> isProbed(a.provider()))
                          .toList());
          for (AgentAccountRow a : targets) {
            try {
              collectAccount(tenantId, a);
            } catch (RuntimeException e) {
              // 예외 메시지에 URL·응답 조각이 섞일 수 있어 종류만 남긴다.
              log.warn(
                  "AI 계정 사용량 조회 실패 — 테넌트 {} 계정 {} 건너뜀: {}",
                  tenantId,
                  a.id(),
                  e.getClass().getSimpleName());
            }
          }
        });
  }

  /**
   * 계정 하나를 조회한다. 조회 대상이 아니거나(폐기·genia·opencode), 임대를 못 잡았거나(간격 안·다른 쪽이 조회 중), 조회 중 폐기·원문 교체로 결과를
   * 버렸으면 false. 조회 결과(성공·실패)를 저장했으면 true.
   *
   * <p>현재 테넌트(TenantContext)가 tenantId 로 서 있어야 한다 — {@link #collectTenant} 가 세운다.
   */
  public boolean collectAccount(long tenantId, long accountId) {
    Optional<AgentAccountRow> before = tx.execute(s -> accounts.findActive(accountId));
    if (before.isEmpty() || !isProbed(before.get().provider())) return false;
    return collectAccount(tenantId, before.get());
  }

  /**
   * 이미 읽은 계정 행으로 조회한다({@link #collectTenant} 가 목록에서 읽은 행을 그대로 넘겨 계정마다 다시 읽지 않는다). 조회 대상 여부는 호출자가
   * 걸렀다고 본다. 저장 때의 잠금 재조회(save)는 그대로라 조회 중 폐기·원문 교체 경합은 여전히 막는다.
   */
  boolean collectAccount(long tenantId, AgentAccountRow account) {
    long accountId = account.id();
    if (!usage.tryClaim(tenantId, accountId, props.interval(), props.lease())) return false;

    Outcome outcome;
    try {
      // 네트워크 호출 — 트랜잭션 밖.
      outcome = probe(account);
    } catch (RuntimeException e) {
      // 예상 못 한 오류 — 결과 없이 임대만 풀어 다음 회차가 임대 만료를 기다리지 않게 하고, 호출자(테넌트 순회)가 로그를 남긴다.
      usage.releaseLease(accountId);
      throw e;
    }
    return Boolean.TRUE.equals(tx.execute(s -> save(account, outcome)));
  }

  /** 원문을 복호화해 조회기를 부른다. 복호화 실패는 네트워크 호출 없이 BAD_SECRET 실패. */
  private Outcome probe(AgentAccountRow account) {
    String secret;
    try {
      secret = encryption.decrypt(account.encryptedSecret());
    } catch (RuntimeException e) {
      // 암호문·키 문제 — 원인 메시지는 싣지 않는다.
      return Outcome.failure("BAD_SECRET", "저장된 키를 읽을 수 없음");
    }
    try {
      return Outcome.success(probes.get(account.provider()).read(secret));
    } catch (UsageProbeException e) {
      return Outcome.failure(e.code(), e.userMessage());
    }
  }

  /**
   * 결과를 저장하고 계정 상태를 옮긴다(트랜잭션 안). 계정 행을 잠가 다시 읽어 폐기·원문 교체 경합을 막는다 — 폐기·교체와 이 저장이 차례로 선다.
   *
   * @return 저장했으면 true, 결과를 버렸으면 false
   */
  private boolean save(AgentAccountRow probed, Outcome outcome) {
    Optional<AgentAccountRow> current = accounts.findActiveForUpdate(probed.id());
    if (current.isEmpty() || current.get().secretVersion() != probed.secretVersion()) {
      // 조회 중 폐기됐거나 원문이 바뀌었다 — 옛 결과는 버리고 다음 회차가 새 원문으로 다시 조회하게 임대만 푼다.
      usage.releaseLease(probed.id());
      return false;
    }
    String status = current.get().status();
    if (outcome.succeeded()) {
      usage.saveSuccess(probed.id(), outcome.reading().windows(), outcome.reading().limitReached());
      // 조회 성공은 저장된 키가 지금 통한다는 증거다 — 「확인 필요」뿐 아니라 「다시 로그인 필요」(일시 장애 중 401 로 넘어갔을 수 있다)도 「정상」으로
      // 되돌린다. 안 그러면 상태 계산에서 RELOGIN_REQUIRED 가 이겨 이후 조회가 계속 성공해도 빨간 표시가 남는다.
      if (STATUS_NEEDS_CHECK.equals(status) || STATUS_RELOGIN_REQUIRED.equals(status)) {
        accounts.updateStatus(probed.id(), STATUS_ACTIVE);
      }
    } else {
      usage.saveFailure(probed.id(), outcome.errorCode(), outcome.errorMessage());
      if (STATUS_NEEDS_CHECK.equals(status) && UNAUTHORIZED_CODES.contains(outcome.errorCode())) {
        accounts.updateStatus(probed.id(), STATUS_RELOGIN_REQUIRED);
      }
    }
    return true;
  }

  /** 사용량을 조회하는 provider 인가 — 조회기가 등록된 종류만(genia·opencode 는 한도가 없어 조회기가 없다). */
  private boolean isProbed(String provider) {
    return probes.containsKey(provider);
  }
}
