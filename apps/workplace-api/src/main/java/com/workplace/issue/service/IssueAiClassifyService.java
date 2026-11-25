package com.workplace.issue.service;

import com.workplace.airun.AiCall;
import com.workplace.airun.AiCallTimeouts;
import com.workplace.airun.context.AiRunContext;
import com.workplace.airun.context.AiRunKinds;
import com.workplace.auth.service.AssistantLimitGuard;
import com.workplace.auth.service.AssistantResolution;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.issue.dto.IssueAiClassifyResponse;
import com.workplace.issue.exception.IssueAiAssistantUnavailableException;
import com.workplace.issue.exception.IssueAiDisabledException;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.issue.outbound.IssueAiInputText;
import com.workplace.issue.outbound.dto.IssueClassifyRequest;
import com.workplace.issue.outbound.dto.IssueClassifyResult;
import com.workplace.label.repository.LabelRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 이슈 AI 분류 서비스.
 *
 * <p><b>3단계 구조:</b>
 *
 * <ol>
 *   <li>TX1(TransactionTemplate readOnly): 프로젝트 접근 확인 + 라벨 목록 + AssistantResolver — RLS/GUC 필요
 *   <li>HTTP(TX 밖): ai-agent classify 호출 — 커넥션 고갈 방지(#232 패턴)
 *   <li>응답 바로 반환 — DB 저장 없음(Migration-0)
 * </ol>
 *
 * <p><b>어시스턴트 선택:</b> PERSONAL 프로젝트 → 소유자 개인 비서(공용 폴백), TEAM → 테넌트 공용 비서. IssueAiSummaryService 동일
 * 패턴.
 *
 * <p><b>RLS/TX:</b> @Transactional(readOnly=true) 대신 TransactionTemplate 명시 사용 — HTTP(최대 30s) 구간에서
 * 커넥션을 반납해 HikariCP 고갈 방지.
 */
@Slf4j
@Service
public class IssueAiClassifyService {

  private final ProjectAccessGuard accessGuard;
  private final LabelRepository labelRepository;
  private final AssistantResolver assistantResolver;
  private final AssistantLimitGuard limitGuard;
  private final AiAgentIssueClient aiClient;
  private final TransactionTemplate txTemplate;
  private final AiAgentProperties aiAgentProperties;

  /** AI 호출 종류별 실행 상한 표(WP-2111). */
  private final AiCallTimeouts timeouts;

  /** AI 연동이 꺼져 있을 때 「AI 분류」에 보이는 문구(WP-1640). */
  static final String DISABLED_MESSAGE = "AI 연동이 꺼져 있어 분류를 제안할 수 없어요.";

  public IssueAiClassifyService(
      ProjectAccessGuard accessGuard,
      LabelRepository labelRepository,
      AssistantResolver assistantResolver,
      AssistantLimitGuard limitGuard,
      AiAgentIssueClient aiClient,
      PlatformTransactionManager txManager,
      AiAgentProperties aiAgentProperties,
      AiCallTimeouts timeouts) {
    this.accessGuard = accessGuard;
    this.labelRepository = labelRepository;
    this.assistantResolver = assistantResolver;
    this.limitGuard = limitGuard;
    this.aiClient = aiClient;
    this.aiAgentProperties = aiAgentProperties;
    this.timeouts = timeouts;
    this.txTemplate = new TransactionTemplate(txManager);
    // readOnly 힌트 — 조회 전용 TX1 에서 불필요한 쓰기 락 방지
    this.txTemplate.setReadOnly(true);
  }

  /**
   * 이슈 제목·본문으로 분류 제안을 반환한다.
   *
   * @param callerId 요청자 사용자 ID
   * @param projectKey 프로젝트 키
   * @param title 이슈 제목
   * @param body 이슈 본문(빈 문자열 허용)
   * @return 유형·우선순위·라벨·이유 제안
   */
  public IssueAiClassifyResponse classify(
      long callerId, String projectKey, String title, String body) {
    // AI 연동이 꺼져 있으면 ai-agent 를 부르지 않고 409 로 알린다(WP-1640).
    if (!aiAgentProperties.enabled()) throw new IssueAiDisabledException(DISABLED_MESSAGE);
    // ── TX1: 프로젝트·라벨·어시스턴트 조회 (TransactionTemplate — RLS GUC 필요) ────────
    // @Transactional(readOnly=true) 대신 txTemplate 사용 — HTTP(최대 30s) 구간에서
    // 커넥션을 반납해 HikariCP 고갈 방지(IssueAiSummaryService #232 패턴).
    record Gathered(ProjectRow project, List<String> labels, AssistantSpec spec) {}

    Gathered gathered =
        txTemplate.execute(
            status -> {
              // 이슈를 만들 수 있는 사람만(OPEN 은 테넌트 전원, TEAM·PERSONAL 은 멤버) — 분류는 새 이슈 화면의 보조 기능이다.
              // 라벨 목록·어시스턴트(개인 프로젝트면 소유자 개인 비서)에 닿기 전에 막는다(WP-478). 없으면 404, 권한 없으면 403.
              ProjectRow project = accessGuard.assertIssueCreatable(projectKey, callerId);

              // 프로젝트 라벨 이름 목록 — allowlist 로 ai-agent 에 전달.
              List<String> projectLabels =
                  labelRepository.findByProject(project.id()).stream().map(l -> l.name()).toList();

              // 프로젝트 유형별 어시스턴트 해석(개인 → 소유자 비서·공용 폴백, 팀 → 공용 비서).
              // 한도 대기 중이면 specOrSkip 이 SKIPPED(limit_wait)를 한 번 남기고, 직접 요청이라 곧바로 한도 안내로
              // 거절한다(WP-2108).
              AssistantResolution resolution =
                  assistantResolver.projectResolution(project.isPersonal(), project.ownerId());
              AssistantSpec spec =
                  limitGuard
                      .specOrSkip(
                          resolution,
                          AiRunKinds.ISSUE_CLASSIFY,
                          new AiRunContext(
                              "PROJECT",
                              String.valueOf(project.id()),
                              null,
                              "USER",
                              callerId,
                              null))
                      .orElseThrow(
                          () -> {
                            resolution.throwIfWaiting();
                            return new IssueAiAssistantUnavailableException();
                          });

              return new Gathered(project, projectLabels, spec);
            });

    // ── HTTP (TX 밖): ai-agent classify 호출 — 커넥션 미점유 ────────────────────────
    boolean isPersonal = "PERSONAL".equals(gathered.project().type());
    IssueClassifyRequest req =
        new IssueClassifyRequest(
            title,
            body != null ? IssueAiInputText.truncate(body, IssueAiInputText.AI_BODY_MAX_CHARS) : "",
            gathered.labels(),
            isPersonal,
            gathered.spec().agentUserId(),
            gathered.spec().model(),
            gathered.spec().maxTurns(),
            timeouts.timeoutMs(AiCall.ISSUE_CLASSIFY));

    // 실패 시 IssueAiException 전파 — 한도로 실패하면 그 자격을 대기로 건다(WP-2108).
    IssueClassifyResult result = limitGuard.call(gathered.spec(), () -> aiClient.classify(req));

    // ── 단계 3: 응답 변환 (DB 저장 없음) ──────────────────────────────────────────────
    // 우선순위는 ai-agent(normalizePriority)가 5단계(WP-886) 안의 값으로 맞춰 보내므로 그대로 넘긴다.
    return new IssueAiClassifyResponse(
        result.type(), result.priority(), result.labels(), result.reason());
  }
}
