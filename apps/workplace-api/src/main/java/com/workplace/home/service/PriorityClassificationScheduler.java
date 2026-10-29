package com.workplace.home.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.outbound.AgentOutageGuard;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.home.dto.PriorityItemRow;
import com.workplace.home.exception.PriorityAiException;
import com.workplace.home.outbound.AiAgentPriorityClient;
import com.workplace.home.outbound.dto.PriorityClassifyRequest;
import com.workplace.home.outbound.dto.PriorityClassifyResult;
import com.workplace.home.repository.PriorityItemRepository;
import com.workplace.issue.dto.IssueDueWindow;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.service.IssueSearchService;
import com.workplace.mail.service.MailMessageService;
import com.workplace.messaging.service.MessagingSummaryService;
import com.workplace.notify.service.NotificationService;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
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
 * 사용자 계속) — 이전 배치 결과는 실패 시 그대로 유지된다(저장을 아예 시도하지 않으므로). 단 ai-agent 불가(연결 실패·503)가 연속되면 {@link
 * AgentOutageGuard} 기준으로 그 회차를 멈춘다(WP-166) — 재기동 중인 agent 에 사용자 수만큼 실패를 쌓지 않는다.
 */
@Slf4j
@Component
public class PriorityClassificationScheduler {

  /** 소스당 후보 상한 — ai-agent 요청 폭주 방지(배치 입력 상한, SynthesisLayer 표시 상한과는 별개). */
  private static final int SOURCE_LIMIT = 20;

  private record TenantUser(long tenantId, long userId) {}

  /**
   * 한 사용자의 후보 — truncatedSources 는 상한(SOURCE_LIMIT)에 닿아 잘렸을 수 있는 소스. 그 소스의 저장 행은 후보에 없어도 사라진 것이 아니라
   * 정리에서 뺀다(WP-1104 리뷰).
   */
  private record Candidates(List<PriorityCandidate> items, Set<String> truncatedSources) {}

  /** 「오늘」을 정하는 시계 — 테스트가 KST 이른 아침을 고정할 수 있게 바꿀 수 있다. */
  private Clock clock = Clock.systemUTC();

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

  /** 테스트 전용 — 「오늘」을 고정한다. */
  void useClock(Clock clock) {
    this.clock = clock;
  }

  /**
   * 15분 주기 — 활성 테넌트의 HUMAN 사용자마다 후보 수집→AI 분류→저장.
   *
   * <p>첫 실행은 기동 2분 뒤(WP-166): 배포 직후 api 가 ai-agent 보다 먼저 떠 곧바로 돌면 ai-agent 재기동 구간에 걸려 사용자 전원이 실패한다.
   */
  @Scheduled(initialDelay = 120_000, fixedRate = 900_000)
  @SchedulerLock(name = "PriorityClassificationScheduler.runOnce")
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
    AgentOutageGuard guard = new AgentOutageGuard();
    boolean outageLogged = false;
    for (TenantUser t : targets) {
      // ai-agent 재기동 중 등 — 남은 사용자에게 같은 실패를 쌓지 않는다. 분류는 다음 주기에 다시 하되, 끝난 항목 정리는 AI 와 무관하니
      // 남은 사용자도 계속한다(WP-1177 — 예전엔 회차를 통째로 멈춰 끝난 행이 남았다).
      boolean classify = !guard.tripped();
      if (!classify && !outageLogged) {
        outageLogged = true;
        log.warn(
            "ai-agent 불가 {}회 연속 — 이번 회차 남은 사용자는 분류 없이 끝난 항목만 정리",
            AgentOutageGuard.MAX_CONSECUTIVE_UNAVAILABLE);
      }
      TenantContext.set(t.tenantId());
      try {
        // 수집·정리 실패는 ai-agent 와 무관하다 — 연속 불가 횟수를 건드리지 않고 다음 사용자로(WP-1177 리뷰).
        Candidates collected;
        try {
          collected = collectAndPrune(t.userId());
        } catch (RuntimeException e) {
          log.warn(
              "우선순위 후보 수집·정리 실패 tenant={} user={} — 이전 결과 유지, 다음 사용자로 계속",
              t.tenantId(),
              t.userId(),
              e);
          continue;
        }
        if (collected == null || !classify) continue;
        if (classifyAndStore(t.userId(), collected)) {
          guard.recordResponse(); // 비서가 없어 agent 를 부르지 않은 사용자는 판단 근거가 아니다
        }
      } catch (RuntimeException e) {
        if (e instanceof PriorityAiException ai && ai.isTransient()) {
          // 읽기 타임아웃도 여기 들어오므로 첫 실패에서 멈추지는 않는다(연속 횟수로 판단). 스택은 남기지 않는다.
          guard.recordUnavailable();
          log.warn(
              "우선순위 분류 실패(ai-agent 불가) tenant={} user={}: {}",
              t.tenantId(),
              t.userId(),
              AgentOutageGuard.describe(e));
        } else {
          guard.recordResponse(); // 그 사용자만의 실패(잘못된 응답·4xx·DB 등) — 다음 사용자로 계속
          log.warn(
              "우선순위 분류 실패 tenant={} user={} — 이전 결과 유지, 다음 사용자로 계속", t.tenantId(), t.userId(), e);
        }
      } finally {
        TenantContext.clear();
      }
    }
  }

  /**
   * 사용자 1명의 후보 수집(짧은 tx) → 끝난 항목 정리(짧은 tx). 분류(ai-agent)와 나눠, ai-agent 가 없거나 실패해도 정리는 늘
   * 돈다(WP-1177).
   *
   * @return 분류할 후보. 후보가 없으면(저장 행을 모두 비웠다) null
   */
  private Candidates collectAndPrune(long userId) {
    Candidates collected = collectCandidates(userId);
    if (collected.items().isEmpty()) {
      // 진짜 "후보 없음" 케이스만 전량 삭제(replaceForUser 빈 리스트) — AI 호출 자체를 안 했으니 모호함이 없다.
      // 짧은 트랜잭션으로 감싸 TenantAwareTransactionManager.doBegin() 이 RLS GUC(app.tenant_id) 를
      // 주입하도록 보장 — 트랜잭션 밖 호출은 GUC 미주입으로 tenant_id NULL → NOT NULL 위반(Critical, 리뷰 지적).
      txTemplate.executeWithoutResult(status -> repo.replaceForUser(userId, List.of()));
      return null;
    }
    // 끝난 항목 정리는 AI 결과와 무관하게 먼저 한다(WP-1177) — 비서가 없거나 ai-agent 호출이 실패·생략돼도 그사이 끝난 이슈·읽은 멘션·회신한
    // 메일·읽은 대화가 이전 점수로 남지 않게. 분류가 성공하면 classifyAndStore 의 replaceForUser 가 다시 맞춘다.
    pruneToCandidates(userId, collected);
    return collected;
  }

  /**
   * 정리를 마친 후보를 ai-agent 로 분류(tx 밖)해 저장(짧은 tx, replaceForUser).
   *
   * @return ai-agent 를 실제로 불러 응답을 받았으면 true(비서가 없어 부르지 않았으면 false) — 호출부가 "연속 불가" 횟수를 agent 응답
   *     기준으로만 리셋하도록
   */
  private boolean classifyAndStore(long userId, Candidates collected) {
    List<PriorityCandidate> candidates = collected.items();
    // 사용자 단위 배치이므로 개인 비서 우선(없으면 공용 비서로 폴백) — resolveWorkspaceOrEmpty() 는 개인 비서를
    // 무시해 개인화가 깨지므로 부적합(브리핑 Step1 확인 결과, resolveOrEmpty(userId) 로 교체).
    AssistantSpec spec = assistantResolver.resolveOrEmpty(userId).orElse(null);
    if (spec == null) {
      log.debug("비서 없음 — 우선순위 분류 생략 user={}", userId);
      return false;
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
          "우선순위 분류 응답이 비어있음(candidates={}) — AI 파싱 실패 가능성, 이전 점수 유지하고 저장 생략 user={}",
          candidates.size(),
          userId);
      return true;
    }

    // sourceId 는 이슈/알림/메일/대화 4개의 독립된 BIGSERIAL 시퀀스에서 온 원시 PK 라 단독 키로 쓰면 충돌한다
    // (예: 마감 지난 이슈#1과 안읽은 멘션#1이 둘 다 sourceId="1"). PriorityItemRepository.replaceForUser 가
    // 이미 쓰는 "sourceType:sourceId" 복합키 규약(프론트 SynthesisLayer.tsx 매처와도 동일)을 그대로 맞춘다.
    Map<String, PriorityCandidate> bySourceKey = new HashMap<>();
    for (PriorityCandidate c : candidates) {
      bySourceKey.put(PriorityItemRow.key(c.sourceType(), c.sourceId()), c);
    }

    List<PriorityItemRow> rows = new ArrayList<>();
    for (PriorityClassifyResult.ScoreLine s : result.results()) {
      PriorityCandidate c = bySourceKey.get(PriorityItemRow.key(s.sourceType(), s.sourceId()));
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
          "우선순위 분류 결과가 후보와 전혀 매칭되지 않음(candidates={}, results={}) — 이전 점수 유지하고 저장 생략 user={}",
          candidates.size(),
          result.results().size(),
          userId);
      return true;
    }
    // 짧은 트랜잭션으로 감싸 RLS GUC 주입 보장 (위 빈-후보 분기와 동일 이유).
    txTemplate.executeWithoutResult(status -> repo.replaceForUser(userId, rows));
    return true;
  }

  /**
   * 분류 전에 이번 후보에 없는 저장 행을 지운다(WP-1104, WP-1177 — 새 점수를 저장하지 못하는 회차·비서 없음·ai-agent 실패에도) — 그사이 끝난
   * 이슈·읽은 멘션·회신한 메일이 이전 점수로 「긴급」에 계속 남지 않게. 후보에 남은 행은 이전 점수를 그대로 둔다(빈 응답이 파싱 실패일 수 있어 점수는 덮지 않는다).
   * 상한에 닿은 소스는 후보 밖에도 유효한 행이 있을 수 있어 지우지 않는다.
   */
  private void pruneToCandidates(long userId, Candidates collected) {
    List<String> keys =
        collected.items().stream()
            .map(c -> PriorityItemRow.key(c.sourceType(), c.sourceId()))
            .toList();
    txTemplate.executeWithoutResult(
        status -> repo.deleteExcept(userId, keys, collected.truncatedSources()));
  }

  /**
   * 4개 소스에서 후보 수집. SynthesisLayer.tsx 의 행 생성 필터와 동일 기준(마감 지남/오늘 이슈, 멘션 알림(notifTarget.ts
   * isMentionLike 미러) 안읽음, aiNeedsReply&&처리안됨 메일, attention 메시징 대화).
   */
  private Candidates collectCandidates(long userId) {
    List<PriorityCandidate> out = new ArrayList<>();
    Set<String> truncated = new HashSet<>();
    LocalDate todayDate = IssueDueWindow.today(clock);
    String today = todayDate.toString();

    // 이슈 마감(지남/오늘) — SynthesisLayer 의 dueFrom(1년 전)~오늘 규칙 미러.
    // 열린 범주(할 일·진행 중)만 받는다 — 프론트 isClosedDue(WP-675)처럼 끝난(완료·취소) 이슈는 마감이 지나도 후보가 아니다(WP-1099).
    // DB 단계에서 거르므로 후보 상한(SOURCE_LIMIT)도 열린 이슈만 차지한다. 사용자 정의 상태도 범주로 걸러진다.
    // 1년 넘게 지난 마감은 SynthesisLayer 에도 보이지 않는다 — 같은 창으로 받는다(WP-1104). 상한에 걸릴 때 마감이 오늘에 가까운 이슈가 남도록
    // 마감 순으로 받는다(WP-1177 — 예전엔 내 이슈 검색의 updated_at 순이라 오래 손대지 않은 임박 이슈가 빠졌다).
    List<IssueResponse> issues =
        issueSearchService.findDueAssigned(userId, todayDate, SOURCE_LIMIT);
    if (issues.size() >= SOURCE_LIMIT) truncated.add(PriorityItemRow.ISSUE_DUE);
    // 마감 창(1년 전~오늘)은 DB 가 이미 걸렀다 — 오늘인지만 가린다.
    for (IssueResponse i : issues) {
      out.add(
          new PriorityCandidate(
              userId,
              PriorityItemRow.ISSUE_DUE,
              String.valueOf(i.id()),
              i.title(),
              i.dueDate().toString().equals(today) ? "오늘 마감" : "마감 지남",
              "/projects/" + i.projectKey() + "/issues/" + i.number()));
    }

    // 멘션(안읽은 코멘트 멘션·이슈 챗 멘션·AI 질문 알림) — 프론트 notifTarget.ts 의 isMentionLike() 와 동일 규칙
    // (코멘트 멘션은 WP-650·이슈 챗 알림은 WP-452 의 전용 유형). COMMENTED 는 멘션 없는 담당자·워처 공통 알림이라 넣지 않는다
    // — 예전 멘션 프록시로 남아 일반 댓글이 멘션 후보가 됐다(WP-1092). notifTarget() 라우팅 규칙도 그대로
    // 포팅(projectKey+issueNumber 딥링크,
    // 이슈 챗 알림은 ?chat=1 로 챗 드로워를 연다).
    var notifications = notificationService.listRecent(userId, SOURCE_LIMIT, 0);
    if (notifications.size() >= SOURCE_LIMIT) truncated.add("MENTION");
    for (var n : notifications) {
      boolean issueChat = "AI_QUESTION".equals(n.type()) || "ISSUE_CHAT_MENTION".equals(n.type());
      boolean commentMention = "ISSUE_COMMENT_MENTION".equals(n.type());
      if (!n.read() && (commentMention || issueChat)) {
        out.add(
            new PriorityCandidate(
                userId,
                "MENTION",
                String.valueOf(n.id()),
                // issueTitle 은 LEFT JOIN 이라 원본 이슈가 삭제된 경우 null 일 수 있다 — MAIL_NEEDS_REPLY
                // 분기와 동일한 폴백으로 user_priority_item.title NOT NULL 위반을 막는다.
                n.issueTitle() != null ? n.issueTitle() : "(제목 없음)",
                "AI_QUESTION".equals(n.type()) ? "AI 질문" : "멘션",
                "/projects/"
                    + n.projectKey()
                    + "/issues/"
                    + n.issueNumber()
                    + (issueChat ? "?chat=1" : "")));
      }
    }

    // 메일 회신필요 — 단일 술어(AI 판정 true + 안 읽음, WP-146). #485 에서 seen 을 술어에서 뺐다가 "읽으면 해제"로 되돌렸다.
    // recent 는 이미 안읽은 메일만이지만, 술어를 명시해 다른 소비처와 같은 기준임을 드러낸다.
    var mail = mailMessageService.summary(userId, SOURCE_LIMIT);
    if (mail.recent().size() >= SOURCE_LIMIT) truncated.add("MAIL_NEEDS_REPLY");
    for (var m : mail.recent()) {
      if (Boolean.TRUE.equals(m.aiNeedsReply()) && !m.seen()) {
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
    if (messaging.recent().size() >= SOURCE_LIMIT) truncated.add("MESSAGE_ATTENTION");
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
    return new Candidates(out, truncated);
  }
}
