package com.workplace.airun.capacity;

import com.workplace.agentaccount.dto.AgentAccountRow;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.agentaccount.usage.AgentAccountUsageRepository;
import com.workplace.agentaccount.usage.UsageSnapshot;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.fileai.repository.FileExtractionRepository;
import com.workplace.global.ai.AgentSlotCounter;
import com.workplace.global.ai.AgentSlotCounter.AgentSlots;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.repository.IssueRepository.QueueStats;
import com.workplace.mail.repository.EmailMessageRepository;
import com.workplace.user.repository.UserRepository;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * AI 처리 용량 1분 표본 수집기(WP-1830) — 「AI 현황」 화면의 시계열을 위해 테넌트마다 1분에 한 번 슬롯 사용·대기열·AI 계정 사용률·적체를 한 행으로
 * 남긴다. 값은 모두 이미 있는 읽기 경로에서 가져온다(새 집계 없이 지금 값을 복사). 여러 Pod 가 같은 분에 돌아도 ShedLock 과 (tenant_id,
 * sampled_at) 유일 제약이 한 행만 남긴다.
 */
@Component
@RequiredArgsConstructor
public class AiCapacitySampler {

  private final TenantScopedRunner tenantRunner;
  private final AiCapacitySampleRepository sampleRepo;
  private final AiStatusProperties props;
  private final ObjectMapper objectMapper;
  private final UserRepository userRepository;
  private final AgentSlotCounter slotCounter;
  private final IssueRepository issueRepository;
  private final AgentAccountRepository accountRepository;
  private final AgentAccountUsageRepository usageRepository;
  private final EmailMessageRepository emailMessageRepository;
  private final FileExtractionRepository fileExtractionRepository;
  private final AssistantResolver assistantResolver;

  /**
   * 1분마다 활성 테넌트 전부의 표본을 남긴다. 표본 시각은 시작 때 한 번 분 단위로 잘라 모든 테넌트가 같은 값을 쓴다(테넌트 순회 중 분이 넘어가도 한 번의 실행은 한
   * 시각). 한 테넌트의 실패는 러너가 삼키고 다음 테넌트로 넘어간다.
   */
  @Scheduled(fixedRate = 60_000)
  @SchedulerLock(
      name = "AiCapacitySampler.sample",
      lockAtMostFor = "PT50S",
      lockAtLeastFor = "PT50S")
  public void sample() {
    OffsetDateTime sampledAt = OffsetDateTime.now().truncatedTo(ChronoUnit.MINUTES);
    tenantRunner.forEachActiveTenant(tenantId -> sampleTenant(tenantId, sampledAt));
  }

  /**
   * 한 테넌트의 표본을 만들어 넣는다 — 테넌트 범위 트랜잭션(RLS) 안에서 불러야 한다(세는 저장소들이 GUC 로 테넌트를 가른다).
   *
   * @param tenantId 대상 테넌트(활성 AI 목록 조회에 쓴다)
   * @param sampledAt 표본 시각(분 단위)
   */
  void sampleTenant(long tenantId, OffsetDateTime sampledAt) {
    // 슬롯: 활성 AI 마다 화면(AI별 보기)과 같은 규칙의 자리 수를 합한다.
    int used = 0;
    int limit = 0;
    for (var agent : userRepository.findActiveAgents(tenantId)) {
      AgentSlots slots = slotCounter.count(agent.id());
      used += slots.used();
      limit += slots.limit();
    }

    // 대기열: AI 가 아직 집지 않은 이슈 수와 가장 오래 기다린 시간(음수는 시계 어긋남이므로 0).
    // 기다린 시간은 분 단위로 자른 sampledAt 이 아니라 지금 시각으로 잰다 — 자른 만큼(최대 59초) 짧게 재지 않게.
    QueueStats queue = issueRepository.countAgentQueue(props.queueLabels());
    Integer oldestWaitSec = null;
    if (queue.oldestLabeledAt() != null) {
      long sec = Duration.between(queue.oldestLabeledAt(), OffsetDateTime.now()).getSeconds();
      oldestWaitSec = (int) Math.max(0, sec);
    }

    Map<String, Integer> backlog = new LinkedHashMap<>();
    // 메일 분류는 워크스페이스 비서가 없으면 AI 를 켠 계정만 돌므로, 비서 유무를 넘겨 일꾼이 안 집는 계정의 메일을 빼고 센다.
    boolean workspaceAssistant = assistantResolver.hasWorkspaceAssistant();
    backlog.put("MAIL_CLASSIFY", emailMessageRepository.countUncategorized(workspaceAssistant));
    // 파일 요약은 워크스페이스 비서가 없으면 요약기가 집지 않고 건너뛰므로(FileExtractionPipeline.summarizePending) 0 으로 센다.
    backlog.put(
        "FILE_SUMMARY", workspaceAssistant ? fileExtractionRepository.countSummaryPending() : 0);

    sampleRepo.insert(
        new AiCapacitySample(
            sampledAt,
            used,
            limit,
            queue.waiting(),
            oldestWaitSec,
            toJson(accountUsage()),
            toJson(backlog)));
  }

  /** 폐기되지 않은 AI 계정의 창(5h·7d)별 최신 사용률 — 계정마다 창 수만큼 원소를 만든다. */
  private List<Map<String, Object>> accountUsage() {
    List<AgentAccountRow> accounts = accountRepository.findAllActive();
    if (accounts.isEmpty()) return List.of();
    Map<Long, List<UsageSnapshot>> snapshots =
        usageRepository.findSnapshots(accounts.stream().map(AgentAccountRow::id).toList());
    List<Map<String, Object>> out = new ArrayList<>();
    for (AgentAccountRow a : accounts) {
      for (UsageSnapshot s : snapshots.getOrDefault(a.id(), List.of())) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("accountId", a.id());
        item.put("label", a.label());
        item.put("window", s.window().key());
        item.put("usedPercent", s.usedPercent());
        // 사용률은 이 표본과 따로(10분 주기) 조회되므로, 값이 얼마나 묵었는지 보이게 관측 시각(ISO-8601)을 싣는다.
        item.put("observedAt", s.observedAt() == null ? null : s.observedAt().toString());
        out.add(item);
      }
    }
    return out;
  }

  /** Map·List 를 JSON 문자열로 — Jackson 3 의 직렬화 예외는 비검사라 그대로 둔다(이 값들은 실패할 수 없다). */
  private String toJson(Object value) {
    return objectMapper.writeValueAsString(value);
  }
}
