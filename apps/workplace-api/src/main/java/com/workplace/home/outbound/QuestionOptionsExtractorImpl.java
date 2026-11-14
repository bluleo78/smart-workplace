package com.workplace.home.outbound;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.chat.outbound.QuestionOptionsExtractor;
import com.workplace.global.util.QuestionOptions;
import com.workplace.home.outbound.ChatMessages.SuggestionRequest;
import com.workplace.project.repository.ProjectRepository;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * {@link QuestionOptionsExtractor} 의 home 모듈 구현(WP-1569) — 이슈 챗 AI 질문 글을 ai-agent {@code
 * /home/suggestions} (mode=answer)에 보내 답 선택지 후보를 받는다. 추천 클라이언트({@link AiAgentSuggestionClient})와 비서
 * 해석({@link AssistantResolver})을 이미 쓰는 home 이 맡아 chat 이 이 둘에 직접 기대지 않게 한다.
 *
 * <p>비서 선택은 이슈 AI 요약(IssueAiSummaryService)과 같다: 개인 프로젝트는 소유자의 개인 비서(공용 폴백), 팀 프로젝트는 워크스페이스 공용
 * 비서({@link AssistantResolver#resolveForProject}). 모델은 비서의 추천 모델({@link
 * AssistantSpec#suggestionModel()} — Anthropic 이면 Haiku).
 *
 * <p>사용자별 「AI 추천 사용」 설정(AiPreferenceService.suggestionsEnabled)은 보지 않는다 — 칩은 질문 글에 저장돼 그 챗을 보는 모두가
 * 함께 보는 것이라 어느 한 사람의 설정으로 켜고 끌 수 없다. 워크스페이스·프로젝트 단위의 AI 추천 켜기/끄기 설정은 아직 없어(2026-11 확인 —
 * tenant·project· assistant_config 에 해당 칼럼 없음), 연결된 비서가 있느냐만 본다.
 *
 * <p>트랜잭션: 비서 해석만 짧은 트랜잭션(RLS GUC 주입)으로 하고, ai-agent HTTP(최대 {@link #TIMEOUT_MS})는 트랜잭션 밖에서
 * 부른다(커넥션을 쥔 채 기다리지 않게).
 */
@Component
public class QuestionOptionsExtractorImpl implements QuestionOptionsExtractor {

  /** ai-agent 실행 상한 — 후속 질문(HomeFollowupService)과 같다. 클라이언트 read 25s 이내. */
  static final int TIMEOUT_MS = 20_000;

  private final ProjectRepository projectRepo;
  private final AssistantResolver assistantResolver;
  private final AiAgentSuggestionClient client;
  private final TransactionTemplate txTemplate;

  public QuestionOptionsExtractorImpl(
      ProjectRepository projectRepo,
      AssistantResolver assistantResolver,
      AiAgentSuggestionClient client,
      PlatformTransactionManager txManager) {
    this.projectRepo = projectRepo;
    this.assistantResolver = assistantResolver;
    this.client = client;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  @Override
  public List<String> extract(String projectKey, String question) {
    Optional<AssistantSpec> spec =
        txTemplate.execute(
            s ->
                projectRepo
                    .findByKey(projectKey)
                    .flatMap(
                        p -> assistantResolver.resolveForProject(p.isPersonal(), p.ownerId())));
    if (spec == null || spec.isEmpty()) return List.of();
    return client.suggest(
        new SuggestionRequest(
            "answer",
            spec.get().agentUserId(),
            spec.get().suggestionModel(),
            null,
            null,
            question,
            null,
            QuestionOptions.MAX,
            TIMEOUT_MS));
  }
}
