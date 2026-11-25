package com.workplace.auth.service;

import com.workplace.auth.dto.AiAgentCredentialRow;
import com.workplace.auth.outbound.AiLimitWaitNoticeEvent;
import com.workplace.auth.repository.AssistantLimitWaitRepository;
import com.workplace.auth.repository.AssistantLimitWaitRepository.MarkResult;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.repository.WorkspaceAssistantRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.user.repository.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Optional;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 비서 자격별 사용 한도 대기(WP-2108). 한도에 걸리면 풀리는 시각까지 비서 호출을 건너뛰게 대기를 적고, 대기가 새로 시작될 때만 수신자에게 알린다. 문구는 모두
 * 여기서 서버 시각(KST)으로 만든다 — 화면·알림이 같은 표현을 쓰게.
 */
@Service
public class AssistantLimitWaitService {

  /** 알림 범위 — 개인 비서. */
  public static final String SCOPE_PERSONAL = "PERSONAL_ASSISTANT";

  /** 알림 범위 — 공통(워크스페이스) 비서. */
  public static final String SCOPE_WORKSPACE = "WORKSPACE_ASSISTANT";

  /** 알림 범위 — 작업 AI 계정(Task 7). */
  public static final String SCOPE_ACCOUNT = "AGENT_ACCOUNT";

  private static final ZoneId KST = ZoneId.of("Asia/Seoul");
  private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm");
  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("M월 d일 HH:mm");

  /** 풀리는 시각을 못 읽거나 이상할 때의 기본 대기. */
  private static final Duration DEFAULT_WAIT = Duration.ofHours(1);

  /** 이보다 먼 미래의 풀리는 시각은 믿지 않는다. */
  private static final Duration MAX_WAIT = Duration.ofDays(8);

  /**
   * 풀리는 시각을 모르는 한도가 만료 직후 또 걸린 경우(같은 한도의 연장)의 대기 — 크레딧 소진·월 한도처럼 시각 없이 계속 걸리는 한도를 1시간마다 다시 알리지 않으려
   * 더 오래 쉰다(WP-2108).
   */
  private static final Duration CONTINUATION_WAIT = Duration.ofHours(4);

  private final AssistantLimitWaitRepository repo;
  private final PersonalAssistantRepository personalRepo;
  private final WorkspaceAssistantRepository workspaceRepo;
  private final UserRepository userRepository;
  private final AiAgentCredentialService credentialService;
  private final ApplicationEventPublisher publisher;
  private final TransactionTemplate newTx;
  private final TransactionTemplate readTx;

  public AssistantLimitWaitService(
      AssistantLimitWaitRepository repo,
      PersonalAssistantRepository personalRepo,
      WorkspaceAssistantRepository workspaceRepo,
      UserRepository userRepository,
      AiAgentCredentialService credentialService,
      ApplicationEventPublisher publisher,
      PlatformTransactionManager txManager) {
    this.repo = repo;
    this.personalRepo = personalRepo;
    this.workspaceRepo = workspaceRepo;
    this.userRepository = userRepository;
    this.credentialService = credentialService;
    this.publisher = publisher;
    // 호출자 트랜잭션과 떨어진 새 트랜잭션 — onFailure 는 대개 롤백될 catch 안에서 불려서, 대기 행과 알림 이벤트가 함께 사라지면 안 된다.
    // 테넌트 GUC 는 TenantAwareTransactionManager 가 시작 시 TenantContext 로 넣는다.
    this.newTx = new TransactionTemplate(txManager);
    this.newTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    this.readTx = new TransactionTemplate(txManager);
    this.readTx.setReadOnly(true);
  }

  /**
   * 자격이 사용 한도에 걸렸음을 적는다. {@code resetsAt} 이 없거나 이미 지났거나 8일보다 멀면 지금 + 1시간. 새 대기가 시작되면 같은 트랜잭션에서 수신자를
   * 정해 알림 이벤트를 발행한다(그 트랜잭션 커밋 뒤 전달). 반환: 저장된 대기 끝 시각.
   */
  public Instant mark(long credentialId, long agentUserId, Instant resetsAt) {
    long tenantId = TenantContext.require();
    Instant now = Instant.now();
    Instant until = resetsAt;
    // 풀리는 시각을 몰라 기본값을 쓰면 연장 판정(만료 직후 재발 → 알림 없이 더 오래 쉼)이 걸릴 수 있다.
    boolean defaulted = until == null || !until.isAfter(now) || until.isAfter(now.plus(MAX_WAIT));
    if (defaulted) until = now.plus(DEFAULT_WAIT);
    Instant wanted = until;
    return newTx.execute(
        status -> {
          MarkResult r =
              repo.upsert(
                  credentialId,
                  agentUserId,
                  wanted,
                  defaulted ? now.plus(CONTINUATION_WAIT) : null);
          if (r.started()) publishNotice(tenantId, agentUserId, r.untilAt(), now);
          return r.untilAt();
        });
  }

  /** 이 자격이 지금 대기 중이면 풀리는 시각. */
  public Optional<Instant> activeUntil(long credentialId) {
    return readTx.execute(s -> repo.findActiveUntil(credentialId));
  }

  /** 서버가 부를 수 있는 이 AGENT 의 활성 자격 id — 한도 대기는 자격 단위라 AGENT 로 시작하는 호출부가 쓴다. */
  public Optional<Long> usableCredentialId(long agentUserId) {
    return credentialService.findServerUsableActive(agentUserId).map(AiAgentCredentialRow::id);
  }

  /** 이 AGENT 의 활성 자격이 지금 대기 중이면 풀리는 시각(자격이 없으면 빈 값). */
  public Optional<Instant> activeUntilForAgent(long agentUserId) {
    return usableCredentialId(agentUserId).flatMap(this::activeUntil);
  }

  /** 이 AGENT 의 활성 자격 대기를 푼다 — 호출자 트랜잭션 안에서 실행된다(모델 변경처럼 설정 저장과 함께 커밋). */
  public void clearForAgent(long agentUserId) {
    usableCredentialId(agentUserId).ifPresent(repo::delete);
  }

  /** 수신자를 정해 이벤트를 낸다 — 개인 비서면 주인, 공통 비서면 활성 관리자들(둘 다면 둘 다), 그 밖이면 알리지 않는다. */
  private void publishNotice(long tenantId, long agentUserId, Instant until, Instant now) {
    Optional<Long> owner = personalRepo.findOwnerId(agentUserId);
    if (owner.isPresent()) {
      publisher.publishEvent(
          new AiLimitWaitNoticeEvent(
              tenantId,
              List.of(owner.get()),
              agentUserId,
              SCOPE_PERSONAL,
              personalNotice(until, now)));
    }
    // 개인 비서이면서 공통 비서로도 지정된 AGENT(예전 설정)는 공통 비서가 멈춘 것도 관리자에게 알린다.
    boolean workspace = workspaceRepo.findAgentId().filter(id -> id == agentUserId).isPresent();
    if (!workspace) return;
    List<Long> admins = userRepository.findWorkspaceActiveAdminIds(tenantId);
    if (admins.isEmpty()) return;
    publisher.publishEvent(
        new AiLimitWaitNoticeEvent(
            tenantId, admins, agentUserId, SCOPE_WORKSPACE, workspaceNotice(until, now)));
  }

  /** KST 시각 — 같은 날이면 {@code HH:mm}, 아니면 {@code M월 d일 HH:mm}. */
  public static String formatUntil(Instant until, Instant now) {
    ZonedDateTime u = until.atZone(KST);
    LocalDate today = now.atZone(KST).toLocalDate();
    return u.toLocalDate().equals(today) ? TIME.format(u) : DATE_TIME.format(u);
  }

  /** 즉답 문구. */
  public static String waitingMessage(Instant until, Instant now) {
    return "사용 한도에 걸렸어요(" + formatUntil(until, now) + " 이후 다시 시도해 주세요)";
  }

  /** 개인 비서 주인에게 보내는 알림. */
  public static String personalNotice(Instant until, Instant now) {
    return "AI 비서가 사용 한도에 걸려 " + formatUntil(until, now) + "까지 쉽니다 — 다른 모델로 바꾸거나 기다려 주세요";
  }

  /** 공통 비서 관리자에게 보내는 알림. */
  public static String workspaceNotice(Instant until, Instant now) {
    return "공통 AI 비서가 사용 한도에 걸려 " + formatUntil(until, now) + "까지 AI 처리를 쉽니다";
  }

  /** 작업 AI 계정 알림 — 시각을 모르면(until null) 시각 없는 문구. 라벨 뒤 조사를 피하려 「」로 감싼다. */
  public static String accountNotice(String label, Instant until, Instant now) {
    if (until == null) return "AI 계정 「" + label + "」 — 사용 한도에 걸렸습니다";
    return "AI 계정 「" + label + "」 — 사용 한도에 걸려 " + formatUntil(until, now) + "까지 쉽니다";
  }
}
