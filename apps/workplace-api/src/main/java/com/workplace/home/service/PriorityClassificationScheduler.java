package com.workplace.home.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.home.dto.PriorityItemRow;
import com.workplace.home.outbound.AiAgentPriorityClient;
import com.workplace.home.outbound.dto.PriorityClassifyRequest;
import com.workplace.home.outbound.dto.PriorityClassifyResult;
import com.workplace.home.repository.PriorityItemRepository;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.service.IssueSearchService;
import com.workplace.mail.service.MailMessageService;
import com.workplace.messaging.service.MessagingSummaryService;
import com.workplace.notify.service.NotificationService;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 홈 대시보드 AI 우선순위 배치 — 15분마다 사용자별 후보(이슈 마감·멘션·메일 회신필요·메시징 확인필요)를 수집해 ai-agent 에 중요도·긴급도 분류를 요청하고 결과를
 * 저장한다.
 *
 * <p>MailSummaryScheduler 와 동일한 2단계 패턴: ① {@link TenantScopedRunner} 로 테넌트별 짧은 트랜잭션(GUC 주입)에서 대상
 * 사용자만 수집, ② 트랜잭션 밖에서 사용자별로 후보 수집(짧은 tx) → ai-agent HTTP(tx 밖) → 저장(짧은 tx). 사용자 단위 실패는 격리(로그만, 다음
 * 사용자 계속) — 이전 배치 결과는 실패 시 그대로 유지된다(저장을 아예 시도하지 않으므로).
 */
@Slf4j
@Component
public class PriorityClassificationScheduler {

  /** 소스당 후보 상한 — ai-agent 요청 폭주 방지(배치 입력 상한, SynthesisLayer 표시 상한과는 별개). */
  private static final int SOURCE_LIMIT = 20;

  private record TenantUser(long tenantId, long userId) {}

  private final TenantScopedRunner tenantRunner;
  private final UserRepository userRepo;
  private final IssueSearchService issueSearchService;
  private final NotificationService notificationService;
  private final MailMessageService mailMessageService;
  private final MessagingSummaryService messagingSummaryService;
  private final AiAgentPriorityClient aiClient;
  private final AssistantResolver assistantResolver;
  private final PriorityItemRepository repo;
  private final TransactionTemplate txTemplate;

  public PriorityClassificationScheduler(
      TenantScopedRunner tenantRunner,
      UserRepository userRepo,
      IssueSearchService issueSearchService,
      NotificationService notificationService,
      MailMessageService mailMessageService,
      MessagingSummaryService messagingSummaryService,
      AiAgentPriorityClient aiClient,
      AssistantResolver assistantResolver,
      PriorityItemRepository repo,
      PlatformTransactionManager txManager) {
    this.tenantRunner = tenantRunner;
    this.userRepo = userRepo;
    this.issueSearchService = issueSearchService;
    this.notificationService = notificationService;
    this.mailMessageService = mailMessageService;
    this.messagingSummaryService = messagingSummaryService;
    this.aiClient = aiClient;
    this.assistantResolver = assistantResolver;
    this.repo = repo;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  /** 15분 주기 — 활성 테넌트의 HUMAN 사용자마다 후보 수집→AI 분류→저장. */
  @Scheduled(fixedRate = 900_000)
  public void runOnce() {
    // ① 수집: 테넌트별 짧은 트랜잭션(GUC 주입) 안에서 대상 사용자만 모은다.
    List<TenantUser> targets = new ArrayList<>();
    tenantRunner.forEachActiveTenant(
        tenantId -> {
          for (UserResponse u : userRepo.findByKind(tenantId, "HUMAN")) {
            if (u.isActive()) {
              targets.add(new TenantUser(tenantId, u.id()));
            }
          }
        });
    // ② 실행: Runner 트랜잭션 밖. 사용자마다 TenantContext 주입 → 각 단계 내부 트랜잭션이 GUC 주입.
    for (TenantUser t : targets) {
      TenantContext.set(t.tenantId());
      try {
        processUser(t.userId());
      } catch (RuntimeException e) {
        log.warn(
            "우선순위 분류 실패 tenant={} user={} — 이전 결과 유지, 다음 사용자로 계속", t.tenantId(), t.userId(), e);
      } finally {
        TenantContext.clear();
      }
    }
  }

  /** 사용자 1명 처리 — 후보 수집(짧은 tx) → ai-agent 분류(tx 밖) → 저장(짧은 tx, replaceForUser). */
  private void processUser(long userId) {
    List<PriorityCandidate> candidates = collectCandidates(userId);
    if (candidates.isEmpty()) {
      // 진짜 "후보 없음" 케이스만 전량 삭제(replaceForUser 빈 리스트) — AI 호출 자체를 안 했으니 모호함이 없다.
      // 짧은 트랜잭션으로 감싸 TenantAwareTransactionManager.doBegin() 이 RLS GUC(app.tenant_id) 를
      // 주입하도록 보장 — 트랜잭션 밖 호출은 GUC 미주입으로 tenant_id NULL → NOT NULL 위반(Critical, 리뷰 지적).
      txTemplate.executeWithoutResult(status -> repo.replaceForUser(userId, List.of()));
      return;
    }
    // 사용자 단위 배치이므로 개인 비서 우선(없으면 공용 비서로 폴백) — resolveWorkspaceOrEmpty() 는 개인 비서를
    // 무시해 개인화가 깨지므로 부적합(브리핑 Step1 확인 결과, resolveOrEmpty(userId) 로 교체).
    AssistantSpec spec = assistantResolver.resolveOrEmpty(userId).orElse(null);
    if (spec == null) {
      log.debug("비서 없음 — 우선순위 분류 생략 user={}", userId);
      return;
    }
    PriorityClassifyRequest req =
        new PriorityClassifyRequest(
            candidates.stream()
                .map(
                    c ->
                        new PriorityClassifyRequest.CandidateLine(
                            c.sourceType(), c.sourceId(), c.title(), c.context()))
                .toList(),
            spec.agentUserId(),
            spec.model(),
            spec.maxTurns(),
            spec.timeoutMs());
    PriorityClassifyResult result =
        aiClient.classify(req); // 실패 시 RuntimeException — 상위(runOnce)에서 격리

    // ai-agent 는 "후보 0건"과 "LLM 응답 파싱 실패"를 구분하지 않고 둘 다 HTTP 200 + results:[] 로 반환한다
    // (/issue/classify 와 동일한 기존 컨벤션, ai-agent 쪽에서 고치지 않음 — Task 4 리뷰에서 확인된 알려진 모호함).
    // candidates 가 비어있지 않은데 results 가 빈 리스트로 온 경우를 "AI 가 빈 결과를 냈다"로 오인해
    // replaceForUser 를 호출하면 파싱 실패 시 이전 배치의 정상 데이터를 전량 삭제해버리는 사고가 난다.
    // 그래서 이 경우는 저장을 건너뛰고(경고 로그만) 이전 배치 결과를 그대로 둔다 — 의도된 방어이며 누락이 아니다.
    if (result.results().isEmpty()) {
      log.warn(
          "우선순위 분류 응답이 비어있음(candidates={}) — AI 파싱 실패 가능성, 이전 결과 유지하고 저장 생략 user={}",
          candidates.size(),
          userId);
      return;
    }

    // sourceId 는 이슈/알림/메일/대화 4개의 독립된 BIGSERIAL 시퀀스에서 온 원시 PK 라 단독 키로 쓰면 충돌한다
    // (예: 마감 지난 이슈#1과 안읽은 멘션#1이 둘 다 sourceId="1"). PriorityItemRepository.replaceForUser 가
    // 이미 쓰는 "sourceType:sourceId" 복합키 규약(프론트 SynthesisLayer.tsx 매처와도 동일)을 그대로 맞춘다.
    Map<String, PriorityCandidate> bySourceKey = new HashMap<>();
    for (PriorityCandidate c : candidates) {
      bySourceKey.put(c.sourceType() + ":" + c.sourceId(), c);
    }

    List<PriorityItemRow> rows = new ArrayList<>();
    for (PriorityClassifyResult.ScoreLine s : result.results()) {
      PriorityCandidate c = bySourceKey.get(s.sourceType() + ":" + s.sourceId());
      if (c == null) continue; // AI 가 존재하지 않는 (sourceType,sourceId) 를 반환한 방어적 스킵
      rows.add(
          new PriorityItemRow(
              c.sourceType(),
              c.sourceId(),
              c.title(),
              c.deepLink(),
              s.importanceScore(),
              s.urgencyScore(),
              s.reason()));
    }
    // I1: candidates 와 result.results() 가 둘 다 비어있지 않았는데도 복합키가 전부 매칭 실패해 rows 가
    // 비는 방어적 엣지케이스 — 위 "result.results().isEmpty()" 가드와 동일한 이유로 빈 리스트 저장을 막는다.
    // 이 가드가 없으면 replaceForUser 가 빈 리스트로 전체 교체해 이전 정상 배치 결과를 지워버린다.
    if (rows.isEmpty()) {
      log.warn(
          "우선순위 분류 결과가 후보와 전혀 매칭되지 않음(candidates={}, results={}) — 이전 결과 유지하고 저장 생략 user={}",
          candidates.size(),
          result.results().size(),
          userId);
      return;
    }
    // 짧은 트랜잭션으로 감싸 RLS GUC 주입 보장 (위 빈-후보 분기와 동일 이유).
    txTemplate.executeWithoutResult(status -> repo.replaceForUser(userId, rows));
  }

  /**
   * 4개 소스에서 후보 수집. SynthesisLayer.tsx 의 행 생성 필터와 동일 기준(마감 지남/오늘 이슈, COMMENTED 알림(멘션 프록시,
   * notifTarget.ts isMentionLike 미러) 안읽음, aiNeedsReply&&처리안됨 메일, attention 메시징 대화).
   */
  private List<PriorityCandidate> collectCandidates(long userId) {
    List<PriorityCandidate> out = new ArrayList<>();
    String today = LocalDate.now().toString();

    // 이슈 마감(지남/오늘) — SynthesisLayer 의 dueFrom(1년 전)~오늘 규칙 미러.
    var issues =
        issueSearchService.searchMine(
            userId, Map.of("assignee", "me", "dueTo", today, "size", String.valueOf(SOURCE_LIMIT)));
    for (IssueResponse i : issues.items()) {
      if (i.dueDate() != null && i.dueDate().toString().compareTo(today) <= 0) {
        out.add(
            new PriorityCandidate(
                userId,
                "ISSUE_DUE",
                String.valueOf(i.id()),
                i.title(),
                i.dueDate().toString().equals(today) ? "오늘 마감" : "마감 지남",
                "/projects/" + i.projectKey() + "/issues/" + i.number()));
      }
    }

    // 멘션(안읽은 COMMENTED 알림) — 프론트 notifTarget.ts 의 isMentionLike() 와 동일 규칙(전용 MENTION 타입이 없어
    // COMMENTED 를 멘션 프록시로 사용). notifTarget() 라우팅 규칙도 그대로 포팅(projectKey+issueNumber 딥링크).
    for (var n : notificationService.listRecent(userId, SOURCE_LIMIT, 0)) {
      if (!n.read() && "COMMENTED".equals(n.type())) {
        out.add(
            new PriorityCandidate(
                userId,
                "MENTION",
                String.valueOf(n.id()),
                // issueTitle 은 LEFT JOIN 이라 원본 이슈가 삭제된 경우 null 일 수 있다 — MAIL_NEEDS_REPLY
                // 분기와 동일한 폴백으로 user_priority_item.title NOT NULL 위반을 막는다.
                n.issueTitle() != null ? n.issueTitle() : "(제목 없음)",
                "멘션",
                "/projects/" + n.projectKey() + "/issues/" + n.issueNumber()));
      }
    }

    // 메일 회신필요 — "회신필요" 술어는 ai_needs_reply IS TRUE AND done_at IS NULL 로 통일됐다(#485, 5개
    // 소비처 공유 chokepoint). seen(안읽음) 은 더 이상 이 판정에 쓰지 않는다 — 드리프트 방지.
    var mail = mailMessageService.summary(userId, SOURCE_LIMIT);
    for (var m : mail.recent()) {
      if (Boolean.TRUE.equals(m.aiNeedsReply()) && m.needsReplyDoneAt() == null) {
        out.add(
            new PriorityCandidate(
                userId,
                "MAIL_NEEDS_REPLY",
                String.valueOf(m.id()),
                m.subject() != null ? m.subject() : "(제목 없음)",
                "회신 필요",
                "/mail/" + m.accountId() + "?messageId=" + m.id()));
      }
    }

    // 메시징 확인필요(멘션·회신대기·AI발굴·새 답글 중 하나).
    var messaging = messagingSummaryService.summary(userId, SOURCE_LIMIT);
    for (var c : messaging.recent()) {
      boolean attention =
          c.mentioned() || c.needsReply() || c.aiReason() != null || c.newThreadReplyCount() > 0;
      if (attention) {
        out.add(
            new PriorityCandidate(
                userId,
                "MESSAGE_ATTENTION",
                String.valueOf(c.conversationId()),
                c.label(),
                "메시징 확인 필요",
                "DM".equals(c.kind())
                    ? "/chat/dms/" + c.conversationId()
                    : "/chat/channels/" + c.conversationId()));
      }
    }
    return out;
  }
}
