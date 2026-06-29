package com.workplace.issue.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.issue.dto.IssueAiClassifyResponse;
import com.workplace.issue.exception.IssueAiAssistantUnavailableException;
import com.workplace.issue.outbound.AiAgentIssueClient;
import com.workplace.issue.outbound.dto.IssueClassifyRequest;
import com.workplace.issue.outbound.dto.IssueClassifyResult;
import com.workplace.label.repository.LabelRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import java.util.List;
import java.util.Optional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/**
 * 이슈 AI 분류 서비스.
 *
 * <p><b>3단계 구조:</b>
 *
 * <ol>
 *   <li>TX1(TransactionTemplate readOnly): 프로젝트 조회 + 라벨 목록 + AssistantResolver — RLS/GUC 필요
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

  private final ProjectRepository projectRepository;
  private final LabelRepository labelRepository;
  private final AssistantResolver assistantResolver;
  private final AiAgentIssueClient aiClient;
  private final TransactionTemplate txTemplate;

  public IssueAiClassifyService(
      ProjectRepository projectRepository,
      LabelRepository labelRepository,
      AssistantResolver assistantResolver,
      AiAgentIssueClient aiClient,
      PlatformTransactionManager txManager) {
    this.projectRepository = projectRepository;
    this.labelRepository = labelRepository;
    this.assistantResolver = assistantResolver;
    this.aiClient = aiClient;
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
    // ── TX1: 프로젝트·라벨·어시스턴트 조회 (TransactionTemplate — RLS GUC 필요) ────────
    // @Transactional(readOnly=true) 대신 txTemplate 사용 — HTTP(최대 30s) 구간에서
    // 커넥션을 반납해 HikariCP 고갈 방지(IssueAiSummaryService #232 패턴).
    record Gathered(ProjectRow project, List<String> labels, AssistantSpec spec) {}

    Gathered gathered =
        txTemplate.execute(
            status -> {
              ProjectRow project =
                  projectRepository
                      .findByKey(projectKey)
                      .orElseThrow(
                          () ->
                              new ResponseStatusException(HttpStatus.NOT_FOUND, "프로젝트를 찾을 수 없습니다"));

              // 프로젝트 라벨 이름 목록 — allowlist 로 ai-agent 에 전달.
              List<String> projectLabels =
                  labelRepository.findByProject(project.id()).stream().map(l -> l.name()).toList();

              // 프로젝트 유형별 어시스턴트 해석.
              boolean isPersonal = "PERSONAL".equals(project.type());
              Optional<AssistantSpec> specOpt =
                  isPersonal
                      ? assistantResolver.resolveOrEmpty(project.ownerId())
                      : assistantResolver.resolveWorkspaceOrEmpty();
              AssistantSpec spec = specOpt.orElseThrow(IssueAiAssistantUnavailableException::new);

              return new Gathered(project, projectLabels, spec);
            });

    // ── HTTP (TX 밖): ai-agent classify 호출 — 커넥션 미점유 ────────────────────────
    boolean isPersonal = "PERSONAL".equals(gathered.project().type());
    IssueClassifyRequest req =
        new IssueClassifyRequest(
            title,
            body != null ? body : "",
            gathered.labels(),
            isPersonal,
            gathered.spec().agentUserId(),
            gathered.spec().model(),
            gathered.spec().maxTurns(),
            gathered.spec().timeoutMs());

    IssueClassifyResult result = aiClient.classify(req); // 실패 시 IssueAiException 전파

    // ── 단계 3: 응답 변환 (DB 저장 없음) ──────────────────────────────────────────────
    return new IssueAiClassifyResponse(
        result.type(), result.priority(), result.labels(), result.reason());
  }
}
