package com.workplace.issue.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.Texts;
import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.IssueRecurrenceAgentOption;
import com.workplace.issue.dto.IssueRecurrenceRequest;
import com.workplace.issue.dto.IssueRecurrenceResponse;
import com.workplace.issue.dto.IssueRecurrenceRow;
import com.workplace.issue.dto.IssueRecurrenceRunReport;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.dto.RecurringPausedAction;
import com.workplace.issue.exception.InvalidIssueRecurrenceException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.exception.IssueRecurrenceConflictException;
import com.workplace.issue.outbound.IssueChatPoster;
import com.workplace.issue.outbound.IssueDomainEvents.IssueRecurringRunEvent;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRecurrenceRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.project.service.ProjectService;
import com.workplace.user.dto.AssigneeInfo;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 이슈의 반복 AI 작업(WP-989, 「실행 일정」). 이슈에 반복 규칙을 붙이면 정한 시각(KST)마다 담당 AI 에게 회차 실행 이벤트를 보내고, AI 의 결과 보고를 그
 * AI 이름의 이슈 챗 글로 남긴다.
 *
 * <p>WP-1314: 개인 작업뿐 아니라 팀 프로젝트 이슈에도 건다. 담당 AI 는 서버가 실행하는(INTERNAL·AI 키가 있는) AI 중에서 고르고, 팀 이슈는 그
 * 프로젝트 구성원인 AI 만 고른다. 회차의 도구 신원은 AI 종류로 정한다({@link IssueRecurrenceRunIdentity#runAsOf}) — 개인 비서는 주인
 * 대행, 개인 작업의 공용 비서는 소유자 대행(지금처럼), 그 밖의 AI 는 자기 이름·권한. 담당 AI 가 누군가의 개인 비서인 일정은 그 주인만 저장·고치기·끄기 할 수
 * 있다(WP-638 「남의 개인 비서는 주인 전용」) — 다른 구성원이 일정을 고쳐 주인 권한으로 남의 일정이 돌지 않게. 주인이 프로젝트를 볼 수 없게 되면 그 일정은
 * 거둔다. 남는 위험(설계 WP-1310 §6, 이번 범위 밖): 팀 이슈의 설명(=지시)은 팀원이 고칠 수 있어, 개인 비서 일정의 지시가 바뀔 수 있다.
 *
 * <p>AI 작업 기록(agent_work)은 회차 사이 「다음 회차 대기」(SCHEDULED + next_run_at), 실행 중 「작업 중」(WORKING)이다. 3회 연속
 * 실패하면 반복을 끄고 「막힘」(BLOCKED)으로 둔다. 이슈가 끝났거나(완료·취소·삭제) 담당에서 그 AI 가 빠지면 작업 기록을 닫는 그 자리에서 반복도
 * 거둔다({@link AgentWorkService} — WP-1114). 스케줄러의 회차 확인은 그 밖의 경로로 어긋난 경우를 위한 안전망으로 남긴다.
 *
 * <p>회차는 이슈 본문이 시킨 쓰기를 확인 카드 없이 하고, 본문이 확인을 받으라고 하면 결과 글을 질문으로 남긴다(WP-1311). 그 질문은 반복 행에 「답을 기다리는
 * 질문」으로 남고, 소유자가 이슈 챗에 답하면(멘션 없어도) 같은 AI 가 같은 신원·권한으로 이어 처리한다(WP-1312 — {@link
 * IssueRecurrenceFollowUpService}). 이어 처리는 정기 회차와 따로 결과를 받고(자기 실행 id), 연속 실패 수·다음 회차를 바꾸지 않는다.
 *
 * <p>「지금 실행」(테스트 실행, WP-1313)은 일정과 관계없이 한 번 실행한다 — 자기 실행 id 로 결과를 따로 받아 다음 회차·연속 실패 수·회차 수·AI 작업
 * 기록을 바꾸지 않고, 결과 글에는 테스트 표시를 붙인다. 되돌릴 수 없는 쓰기는 ai-agent 가 멈추고 질문으로 남기며(issue.recurring_test_run),
 * 누른 사람이 답하면 이어 처리가 그 멈춘 쓰기만 실행한다. 한 반복에 결과를 기다리는 실행(정기 회차·이어 처리·테스트 실행)이나 정기 회차가 남긴 답을 기다리는 질문이
 * 있으면 누를 수 없고(409), 테스트 실행이 도는 동안 정기 회차가 되면 결과를 기다리는 회차처럼 미룬다(WP-989 규칙 재사용).
 */
@Slf4j
@Service
@Transactional
@RequiredArgsConstructor
public class IssueRecurrenceService {

  /** 반복이 남기는 AI 작업 기록의 도구 이름 — 서버가 대신 기록하는 작업이다. */
  static final String TOOL = "workplace";

  static final String NOTE_SCHEDULED = "반복 · 다음 회차 대기";
  static final String NOTE_RUNNING = "반복 회차 실행 중";
  static final String NOTE_STOPPED = "3회 연속 실패로 반복을 멈췄습니다";

  /** 이 횟수만큼 연속 실패하면 반복을 끈다. */
  static final int MAX_CONSECUTIVE_FAILURES = 3;

  static final String NO_ASSISTANT = "쓸 수 있는 AI 비서가 없습니다 — 개인 비서를 연결하거나 관리자에게 공통 비서 지정을 요청하세요";
  static final String NOT_SERVER_AGENT = "서버가 실행하는 AI 만 맡길 수 있습니다";
  static final String NO_AGENT_KEY = "AI 키가 연결되지 않은 AI 에게는 맡길 수 없습니다";
  static final String NOT_PROJECT_MEMBER = "이 프로젝트 구성원인 AI 에게만 맡길 수 있습니다";
  static final String OTHERS_ASSISTANT = "다른 사람의 개인 비서 일정은 그 주인만 바꿀 수 있습니다";
  static final String ISSUE_CLOSED = "완료·취소된 작업에는 반복을 둘 수 없습니다";

  /** 실패 회차 글의 머리. */
  static final String FAILED_PREFIX = "이번 회차를 실행하지 못했습니다: ";

  /** 반복을 멈췄을 때 이슈 챗에 남기는 안내. */
  static final String STOPPED_NOTICE = "반복 작업이 3회 연속 실패해 반복을 멈췄습니다. 이슈의 반복 설정에서 다시 저장하면 다시 켜집니다.";

  /** 결과를 받지 못한 회차(다음 회차가 됐는데도 대기 중이거나 오래 대기한 회차)를 실패로 셀 때 남기는 글. */
  static final String LOST_RUN = "이전 회차 결과를 받지 못했습니다";

  /** 다음 회차를 더는 계산할 수 없어 반복을 껐을 때 남기는 안내. */
  static final String NO_NEXT_NOTICE = "다음 회차 시각을 정할 수 없어 반복을 멈췄습니다. 이슈의 반복 설정을 다시 저장해 주세요.";

  static final String NOTE_NO_NEXT = "다음 회차를 정할 수 없어 반복을 멈췄습니다";

  /** 「한 번만」 예약(WP-1315)의 회차가 끝났을 때 작업 기록에 남기는 메모 — 성공. */
  static final String NOTE_ONCE_DONE = "한 번만 실행을 마쳤습니다";

  /** 「한 번만」 예약(WP-1315)의 회차가 실패로 끝났을 때 작업 기록에 남기는 메모. */
  static final String NOTE_ONCE_FAILED = "한 번만 실행이 실패로 끝났습니다";

  /**
   * 「한 번만」 예약(WP-1315)의 회차가 질문으로 끝나 답을 기다리는 동안의 작업 메모. 정기 회차 질문처럼 작업은 「다음 회차 대기」(SCHEDULED)로 두되 다음
   * 회차 시각은 없다 — 답의 이어 처리 결과가 작업을 끝낸다.
   */
  static final String NOTE_ONCE_QUESTION = "질문의 답을 기다립니다";

  /** 「한 번만」 예약(WP-1315)이 남긴 질문의 답을 기한(7일) 안에 받지 못해 작업 기록을 끝낼 때 남기는 메모. */
  static final String NOTE_ONCE_UNANSWERED = "질문의 답을 받지 못한 채 한 번만 실행을 마쳤습니다";

  /**
   * 보낸 회차의 결과를 이만큼 기다린다 — 넘으면 결과를 못 받은 회차로 보고 실패로 센 뒤 「다음 회차 대기」로 되돌린다(월 반복이 한 달 내내 작업 중으로 남지 않게).
   */
  static final Duration PENDING_TIMEOUT = Duration.ofMinutes(30);

  /** 이어 처리(WP-1312)가 도는 동안의 작업 메모. */
  static final String NOTE_FOLLOW_UP = "답을 받아 이어 처리 중";

  /** 실패한 이어 처리 글의 머리 — 정기 회차 실패와 달리 연속 실패로 세지 않는다. */
  static final String FOLLOW_UP_FAILED_PREFIX = "이어서 처리하지 못했습니다: ";

  /** 결과를 {@link #PENDING_TIMEOUT} 안에 받지 못한 이어 처리를 비울 때 남기는 글. */
  static final String FOLLOW_UP_LOST = "이어 처리 결과를 받지 못했습니다";

  /** 이어 처리 결과 글이 비었을 때 대신 남기는 글. */
  static final String EMPTY_FOLLOW_UP = "(이어 처리 결과가 비어 있습니다)";

  /** 결과 글이 비었을 때 대신 남기는 글. */
  static final String EMPTY_RESULT = "(이번 회차 결과가 비어 있습니다)";

  // ─── 「지금 실행」(테스트 실행, WP-1313) ───

  /** 테스트 실행·그 이어 처리 결과 글의 머리 — 정기 회차 결과와 구별되게 이슈 챗에 표시한다. */
  static final String TEST_LABEL = "**[테스트 실행]** ";

  /** 실패한 테스트 실행 글의 머리 — 연속 실패로 세지 않는다. */
  static final String TEST_FAILED_PREFIX = "테스트 실행을 하지 못했습니다: ";

  /** 결과를 {@link #PENDING_TIMEOUT} 안에 받지 못한 테스트 실행을 비울 때 남기는 글. */
  static final String TEST_LOST = "테스트 실행 결과를 받지 못했습니다";

  /** 테스트 실행 결과 글이 비었을 때 대신 남기는 글. */
  static final String EMPTY_TEST_RESULT = "(테스트 실행 결과가 비어 있습니다)";

  static final String NO_RECURRENCE = "실행 일정이 없습니다 — 먼저 실행 일정을 저장하세요";
  static final String RUN_IN_FLIGHT = "이미 실행 중입니다 — 결과가 채팅에 남은 뒤 다시 실행하세요";

  /** 정기 회차가 남긴 질문이 답을 기다리는 동안 「지금 실행」을 거절하는 문구 — 테스트 질문이 그 질문을 덮지 않게(WP-1313). */
  static final String QUESTION_PENDING = "답을 기다리는 질문이 있습니다 — 그 질문에 답한 뒤 다시 실행하세요";

  static final String AGENT_NOT_ASSIGNED = "담당 AI 가 이 작업의 담당자가 아니라 실행할 수 없습니다";
  static final String OWNER_LEFT = "AI 가 대신할 사람이 이 프로젝트를 볼 수 없어 실행할 수 없습니다";

  /** 멈춘 쓰기 목록을 보관할 때의 JSON 길이 상한 — 넘으면 인자를 빼고 도구 이름만 남긴다(허락 판정은 이름으로 한다). */
  static final int PAUSED_ACTIONS_MAX_CHARS = 16_000;

  /** 한 질문에 남기는 멈춘 쓰기 수 상한 — 모델이 같은 쓰기를 끝없이 시도해도 행이 커지지 않게. */
  static final int PAUSED_ACTIONS_MAX = 20;

  /** 이슈 챗 글 한도 — 보고 글(ReportAgentWorkRequest.message)과 같다. 넘으면 자른다. */
  static final int CHAT_BODY_MAX = 4000;

  private static final String TRUNCATED_MARK = "\n\n…(길어서 줄였습니다)";

  private final IssueRecurrenceRepository repository;
  private final IssueRecurrenceRules rules;
  private final IssueRepository issueRepository;
  private final IssueAssigneeRepository assigneeRepository;
  private final ProjectRepository projectRepository;
  private final ProjectAccessGuard accessGuard;
  // 비서를 멤버·담당으로 넣는 경로 — 사람이 할 때와 같은 서비스로(검증·이력·워처·실시간 갱신).
  private final ProjectService projectService;
  private final ProjectMemberRepository memberRepository;
  private final IssueAssigneeService assigneeService;
  private final AssistantResolver assistantResolver;
  // 담당 AI 종류 판정(WP-1314) — 누구의 개인 비서인지·공용 비서인지·AI 키가 있는지.
  private final PersonalAssistantRepository personalAssistantRepository;
  // 회차의 도구 신원(WP-1314) — 이어 처리(WP-1312)와 같은 규칙을 쓰도록 별도 빈에 모았다.
  private final IssueRecurrenceRunIdentity runIdentity;
  private final AiAgentCredentialRepository credentialRepository;
  private final AgentWorkService agentWorkService;
  private final IssueChatPoster chatPoster;
  private final UserRepository userRepository;
  private final ApplicationEventPublisher publisher;
  // 스케줄러 회차를 행마다 세이브포인트로 감싸는 데 쓴다(한 행의 실패가 테넌트 전체를 되돌리지 않게).
  private final PlatformTransactionManager txManager;
  // 테스트 실행이 멈춘 쓰기 목록(WP-1313)을 반복 행에 JSON 으로 보관·복원한다.
  private final ObjectMapper objectMapper;

  // ───────────────────────────── REST(사람) ─────────────────────────────

  /** 이슈의 반복. 없으면 빈 값(컨트롤러가 204). 이슈를 읽을 수 있으면 볼 수 있다. */
  @Transactional(readOnly = true)
  public Optional<IssueRecurrenceResponse> get(long callerId, String projectKey, int number) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    var issue = issue(project, projectKey, number);
    // 묘비(실행 중에 지운 반복)는 없는 반복이다.
    return repository.find(issue.id()).filter(r -> !r.deleted()).map(r -> toResponse(r, callerId));
  }

  /** 이 이슈의 실행 일정에 담당으로 고를 수 있는 AI(WP-1314) — {@link #candidates}. */
  @Transactional(readOnly = true)
  public List<IssueRecurrenceAgentOption> agentOptions(
      long callerId, String projectKey, int number) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    issue(project, projectKey, number);
    return candidates(project, callerId);
  }

  /**
   * 이 프로젝트에서 새 작업의 실행 일정에 담당으로 고를 수 있는 AI(WP-1315) — 작업을 만들기 전(만들기 창의 「AI 에게 맡기기」)에 쓴다. 후보는 이슈와
   * 무관하게 프로젝트로 정해지므로 {@link #agentOptions} 와 같은 {@link #candidates} 다.
   */
  @Transactional(readOnly = true)
  public List<IssueRecurrenceAgentOption> projectAgentOptions(long callerId, String projectKey) {
    return candidates(accessGuard.assertReadable(projectKey, callerId), callerId);
  }

  /**
   * 반복을 저장한다(없으면 만들고 있으면 바꾼다 — 꺼진 반복도 다시 켜진다). 담당 AI 는 요청의 {@code agentUserId}, 없으면 개인 작업은 소유자의 AI
   * 비서(개인 비서, 없으면 공용 비서), 팀 이슈는 지금 일정의 AI(없으면 후보의 첫째 — 구성원인 내 개인 비서가 맨 앞)다 — 없으면 409. 고른 AI 는 서버가
   * 실행하는 AI 여야 하고(409), 팀 이슈면 프로젝트 구성원이어야 한다(409). 지금 일정이나 고른 AI 가 남의 개인 비서면 403(주인만). 개인 작업은 AI 가
   * 아직 멤버·담당이 아니면 넣고, 팀 이슈는 담당에만 넣는다. 저장하면 그 AI 의 작업 기록을 「다음 회차 대기」로 시작하거나 바꾼다.
   */
  public IssueRecurrenceResponse save(
      long callerId, String projectKey, int number, IssueRecurrenceRequest req) {
    // 이슈 수정과 같은 가드 — 멤버만(개인 프로젝트는 소유자만 멤버다).
    var project = accessGuard.assertMember(projectKey, callerId);
    // 이슈 행을 잠가 읽는다 — 담당 교체·이슈 닫기와 같은 잠금 순서(이슈 → 반복)이고, 아래에서 읽은 담당 목록이 교체 때까지 그대로다.
    var issue =
        issueRepository
            .findByProjectAndNumberForUpdate(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    LocalTime time = rules.parseTime(req == null ? null : req.time());
    // 날짜 채우기와 다음 회차 계산은 같은 기준 시각을 쓴다 — 두 번 읽으면 그 사이 정한 시각이 지나 「한 번만」이 다음 회차 없음(400)이 될 수 있다.
    Instant now = Instant.now();
    // 「한 번만」(WP-1315)은 날짜를 여기서 정한다 — 날짜가 없으면 그 시각의 다음 때, 지난 날짜·시각이면 400.
    String rrule =
        rules.resolveOnce(rules.normalizeRrule(req == null ? null : req.rrule()), time, now);
    if (IssueStatuses.CLOSED.contains(issue.status())) throw conflict(ISSUE_CLOSED);

    IssueRecurrenceRow old = repository.findForUpdate(issue.id()).orElse(null);
    // 남의 개인 비서가 돌리는 일정은 담당 AI 를 바꾸는 것도 주인만 한다 — 바꿔 버리면 주인의 일정을 지운 것과 같다.
    IssueRecurrenceRow live = old != null && !old.deleted() ? old : null;
    if (live != null) requireOwnerOf(live.agentUserId(), callerId);
    long agentId = chooseAgent(callerId, project, req, live);
    requireOwnerOf(agentId, callerId);
    requireServerAgent(agentId);
    // 팀 이슈는 직접 구성원인 AI 만 — 후보 목록과 같은 기준이고, 아래 enrollAssistant 가 팀 프로젝트에 AI 를 멤버로 넣지 않게 한다.
    if (!isPersonal(project) && !memberRepository.isDirectMember(project.id(), agentId)) {
      throw conflict(NOT_PROJECT_MEMBER);
    }

    // 켜진 반복은 늘 다음 회차가 있어야 한다 — 계산할 수 없는 규칙은 저장하지 않는다.
    Instant next = rules.nextRunAfter(rrule, time, now);
    if (next == null) throw new InvalidIssueRecurrenceException("다음 회차를 정할 수 없는 반복 규칙입니다");

    boolean agentChanged = old != null && old.agentUserId() != agentId;
    List<Long> assigneeIds = assigneeRepository.findUserIdsByIssue(issue.id());
    // WP-1119: 이 반복이 넣은 담당인지(이번에 넣거나 같은 AI 의 앞 기록) — 비서가 바뀌면 이 반복이 넣은 예전 비서만 뺀다.
    boolean enrolled =
        !assigneeIds.contains(agentId) || (old != null && !agentChanged && old.assistantEnrolled());
    Long drop = agentChanged && old.assistantEnrolled() ? old.agentUserId() : null;
    // 비서가 바뀌었으면(개인 비서를 새로 정함 등) 예전 AI 의 반복 작업 기록은 끝낸다 — 두 AI 가 같은 반복을 기다리는 것처럼 보이지 않게.
    if (agentChanged) cancelWork(issue.id(), old.agentUserId());
    // 행의 실행 AI 를 담당 교체보다 먼저 새 비서로 바꾼다 — 예전 비서를 담당에서 빼면 담당 해제가 「그 AI 가 돌리던 반복」을 거두는데(WP-1114),
    // 그때 행이 아직 예전 비서면 이 반복이 지워져 회차 수·지난 실행 시각을 잃는다.
    repository.upsert(issue.id(), rrule, time, agentId, callerId, next, enrolled);
    // 예전 AI 가 돌리던 회차·이어 처리의 결과는 받지 않는다(늦게 와도 조용히 무시된다). 예전 AI 가 남긴 질문의 답으로 새 AI 를 깨우지도 않는다
    // (WP-1312).
    if (agentChanged) repository.clearPending(issue.id());
    enrollAssistant(callerId, project, projectKey, issue, agentId, assigneeIds, drop);

    // 같은 AI 의 회차가 아직 도는 중이면 「작업 중」을 그대로 둔다 — 결과 보고가 「다음 회차 대기」로 바꾼다.
    boolean running =
        old != null && !agentChanged && (old.pendingRunId() != null || old.followUpRunId() != null);
    agentWorkService.startOrUpdateTracked(
        issue.id(), agentId, TOOL, running ? runningPatch() : scheduledPatch(next));
    return toResponse(repository.find(issue.id()).orElseThrow(), callerId);
  }

  /**
   * 반복을 지운다(없어도 성공 — 멱등). 그 AI 의 진행 중 작업 기록은 취소로 끝낸다.
   *
   * <p>회차가 도는 중이면 묘비로 남긴다({@link #cancel}). 묘비는 조회·목록·스케줄러에서 빠지고, 다시 저장하면 되살아난다. 이미 묘비인 반복은 다시 거두지
   * 않는다 — 다시 지우기(재시도 포함)가 그 AI 의 작업 기록을 또 취소하지 않게.
   */
  public void delete(long callerId, String projectKey, int number) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var issue = issue(project, projectKey, number);
    var row = repository.findForUpdate(issue.id()).filter(r -> !r.deleted());
    // 남의 개인 비서 일정은 주인만 끈다(WP-1314).
    row.ifPresent(
        r -> {
          requireOwnerOf(r.agentUserId(), callerId);
          cancel(r);
        });
  }

  /**
   * 「지금 실행」(테스트 실행, WP-1313) — 일정과 관계없이 담당 AI 에게 한 번 실행을 보낸다. 다음 회차·연속 실패 수·회차 수·AI 작업 기록은 바꾸지 않는다.
   * 꺼진(3회 연속 실패로 멈춘) 일정도 실행해 볼 수 있다 — 다시 켜기 전에 고쳐졌는지 확인하는 길이다.
   *
   * <ul>
   *   <li>권한: 일정 저장과 같다 — 프로젝트 멤버(개인 작업은 소유자)이고, 담당 AI 가 남의 개인 비서면 그 주인만(403, WP-638·WP-1314).
   *   <li>409: 일정이 없음, 작업이 끝남, 담당 AI 가 담당에서 빠짐, 서버가 실행할 수 없는 AI, 대행 주인이 프로젝트를 볼 수 없음, 결과를 기다리는
   *       실행(정기 회차·이어 처리·테스트 실행)이 있음 — 한 반복에 실행은 하나씩이다(버튼을 연달아 눌러도 하나만 나간다). 정기 회차가 남긴 질문이 답을 기다리는
   *       중 — 테스트 질문이 그 질문을 덮지 않게 먼저 답하게 한다.
   * </ul>
   *
   * 결과는 ai-agent 가 같은 내부 보고로 돌려주고({@link #reportRun}), 테스트 표시를 붙인 그 AI 이름의 이슈 챗 글로 남는다.
   */
  public void runNow(long callerId, String projectKey, int number) {
    Instant now = Instant.now();
    var project = accessGuard.assertMember(projectKey, callerId);
    // 저장과 같은 잠금 순서(이슈 → 반복) — 동시에 누른 두 요청 중 하나만 실행 id 를 남긴다.
    var issue =
        issueRepository
            .findByProjectAndNumberForUpdate(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    IssueRecurrenceRow row =
        repository
            .findForUpdate(issue.id())
            .filter(r -> !r.deleted())
            .orElseThrow(() -> conflict(NO_RECURRENCE));
    requireOwnerOf(row.agentUserId(), callerId);
    if (IssueStatuses.CLOSED.contains(issue.status())) throw conflict(ISSUE_CLOSED);
    if (!live(issue, row.agentUserId())) throw conflict(AGENT_NOT_ASSIGNED);
    if (row.anyRunInFlight()) throw conflict(RUN_IN_FLIGHT);
    // 정기 회차(또는 그 이어 처리)가 남긴 질문이 아직 답을 기다리면 누를 수 없다 — 테스트 실행이 물으면 그 질문 자리를 테스트 질문이 차지해 정기
    // 회차의 질문에 더는 답할 수 없게 된다. 기한(7일)이 지난 질문은 답으로 받지 않으니 막지 않는다. 앞선 테스트 질문은 새 테스트가 바꿔도 된다.
    if (scheduledQuestionPending(row, now)) throw conflict(QUESTION_PENDING);
    requireServerAgent(row.agentUserId());
    // 도구 신원은 정기 회차와 같은 규칙(WP-1314) — 대행 주인이 프로젝트를 볼 수 없으면 실행하지 않는다(일정을 거두는 일은 정기 회차가 한다).
    OptionalLong runAs = runIdentity.resolve(row.agentUserId(), project);
    if (runAs.isEmpty()) throw conflict(OWNER_LEFT);

    // 테스트 실행 id 는 보낸 시각(ms)으로 — 정기 회차("<id>-<epoch 초>")·이어 처리("<id>-f<글 id>")와 모양이 달라 결과 보고가 어느 쪽인지
    // 가른다.
    String runId = issue.id() + "-t" + now.toEpochMilli();
    repository.markTestDispatched(issue.id(), runId, now, callerId);
    log.info("[recurrence] 지금 실행(테스트) 보냄 issueId={} runId={}", issue.id(), runId);
    publisher.publishEvent(
        runEvent(
            userRepository,
            row,
            issue,
            project,
            runAs.getAsLong(),
            assigneeRepository.findByIssue(issue.id()),
            runId,
            now,
            null,
            now,
            null,
            callerId,
            true));
  }

  /**
   * 정기 회차(또는 그 이어 처리)가 남긴 질문이 아직 답을 받을 수 있는지(WP-1313) — 테스트 질문이 아니고, 답 기한({@link
   * IssueRecurrenceFollowUpService#QUESTION_TTL}) 안이다.
   */
  private static boolean scheduledQuestionPending(IssueRecurrenceRow row, Instant now) {
    return row.pendingQuestionMessageId() != null
        && !row.testQuestion()
        && IssueRecurrenceFollowUpService.questionWithinTtl(row, now);
  }

  // ───────────────────────────── 스케줄러 ─────────────────────────────

  /**
   * 현재 테넌트(호출자가 연 테넌트 트랜잭션)에서 스케줄러 한 번의 일을 한다.
   *
   * <ol>
   *   <li>대기 시간 초과 정리 — 보낸 지 {@link #PENDING_TIMEOUT} 이 지나도록 결과가 오지 않은 회차를 실패로 세고(「이전 회차 결과를 받지
   *       못했습니다」) 작업을 「다음 회차 대기」로 되돌린다. 묘비는 지운다.
   *   <li>회차 실행 — 회차 시각이 된 반복마다 이슈 상태·담당을 확인한 뒤 회차 이벤트를 발행하고(커밋 뒤 ai-agent 로 나간다), 다음 회차를 「지금 이후의 첫
   *       회차」로 옮기고, AI 작업을 「작업 중」으로 바꾼다. 이슈가 끝났거나(삭제 포함) 담당에서 AI 가 빠졌으면 회차를 건너뛰고 반복을 거둔다({@link
   *       #cancel} — 도는 회차가 있으면 묘비).
   * </ol>
   *
   * 보낸 회차 수를 돌려준다.
   */
  public int runDue(Instant now) {
    // 행마다 세이브포인트(NESTED) — 한 행이 실패해도 그 행의 쓰기만 되돌리고 나머지 행과 테넌트 트랜잭션은 그대로 커밋한다. 회차 이벤트 발행은
    // runOne 의 마지막 문장이라, 실패한 행은 이벤트를 내지 않는다.
    TransactionTemplate perRow = new TransactionTemplate(txManager);
    perRow.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
    for (IssueRecurrenceRow row : repository.lockStalePending(now.minus(PENDING_TIMEOUT))) {
      try {
        perRow.executeWithoutResult(status -> sweepOne(row));
      } catch (RuntimeException e) {
        log.warn("[recurrence] 결과 대기 초과 정리 실패 — 이 행만 건너뛴다. issueId={}", row.issueId(), e);
      }
    }
    // WP-1312: 결과를 오래 못 받은 이어 처리 — 실패로 세지 않고 비운 뒤 짧게 알린다.
    for (IssueRecurrenceRow row : repository.lockStaleFollowUps(now.minus(PENDING_TIMEOUT))) {
      try {
        perRow.executeWithoutResult(status -> sweepFollowUp(row));
      } catch (RuntimeException e) {
        log.warn("[recurrence] 이어 처리 결과 대기 초과 정리 실패 — 이 행만 건너뛴다. issueId={}", row.issueId(), e);
      }
    }
    // WP-1313: 결과를 오래 못 받은 테스트 실행 — 실패로 세지 않고 비운 뒤 짧게 알린다.
    for (IssueRecurrenceRow row : repository.lockStaleTestRuns(now.minus(PENDING_TIMEOUT))) {
      try {
        perRow.executeWithoutResult(status -> sweepTestRun(row));
      } catch (RuntimeException e) {
        log.warn("[recurrence] 테스트 실행 결과 대기 초과 정리 실패 — 이 행만 건너뛴다. issueId={}", row.issueId(), e);
      }
    }
    // WP-1315: 끝난 「한 번만」 예약의 질문이 답 기한(7일)을 넘겼다 — 질문을 비우고 답을 기다리던 작업 기록을 끝낸다. 정기 반복의 질문은 다음 회차가
    // 작업을 이어 가므로 답할 때 판정하면 되지만, 한 번만은 다음 회차가 없어 쓸어 내지 않으면 작업이 「대기」로 영영 남는다.
    for (IssueRecurrenceRow row :
        repository.lockExpiredOnceQuestions(
            now.minus(IssueRecurrenceFollowUpService.QUESTION_TTL))) {
      try {
        perRow.executeWithoutResult(status -> expireOnceQuestion(row));
      } catch (RuntimeException e) {
        log.warn("[recurrence] 한 번만 질문 기한 정리 실패 — 이 행만 건너뛴다. issueId={}", row.issueId(), e);
      }
    }
    // 정리가 끝난 뒤에 읽는다 — 방금 실패로 센 회차를 결과 대기로 다시 보지 않게.
    int sent = 0;
    for (IssueRecurrenceRow row : repository.lockDue(now)) {
      try {
        if (Boolean.TRUE.equals(perRow.execute(status -> runOne(row, now)))) sent++;
      } catch (RuntimeException e) {
        log.warn("[recurrence] 반복 회차 처리 실패 — 이 행만 건너뛴다. issueId={}", row.issueId(), e);
      }
    }
    return sent;
  }

  /** 답 기한이 지난 끝난 「한 번만」 예약의 질문 하나(WP-1315) — 질문을 비우고 답을 기다리던 작업 기록을 끝낸다. 글은 남기지 않는다. */
  private void expireOnceQuestion(IssueRecurrenceRow row) {
    log.info("[recurrence] 한 번만 질문 답 기한 지남 issueId={}", row.issueId());
    repository.clearPendingQuestion(row.issueId());
    issueRepository
        .findById(row.issueId())
        .ifPresent(
            issue ->
                agentWorkService.endIfLive(
                    issue,
                    row.agentUserId(),
                    AgentWorkState.COMPLETED,
                    endPatch(NOTE_ONCE_UNANSWERED)));
  }

  /** 결과를 오래 못 받은 회차 하나 — 묘비면 지우고, 아니면 실패로 센다. */
  private void sweepOne(IssueRecurrenceRow row) {
    log.info("[recurrence] 회차 결과 대기 시간 초과 issueId={} runId={}", row.issueId(), row.pendingRunId());
    if (row.deleted()) {
      finishTombstone(row, RunKind.REGULAR, null);
      return;
    }
    applyResult(row, false, LOST_RUN, false);
  }

  /**
   * 결과를 오래 못 받은 테스트 실행 하나(WP-1313) — 대기를 비우고 「테스트 실행 결과를 받지 못했습니다」를 남긴다. 연속 실패 수·다음 회차·AI 작업 기록은
   * 그대로다. 묘비면 글 없이 비우기만 한다(기다리는 다른 실행이 없으면 행을 지운다).
   */
  private void sweepTestRun(IssueRecurrenceRow row) {
    log.info("[recurrence] 테스트 실행 결과 대기 시간 초과 issueId={} runId={}", row.issueId(), row.testRunId());
    if (row.deleted()) {
      finishTombstone(row, RunKind.TEST, null);
      return;
    }
    repository.clearTestRun(row.issueId());
    IssueRow issue = issueRepository.findById(row.issueId()).orElse(null);
    ProjectRow project =
        issue == null ? null : projectRepository.findById(issue.projectId()).orElse(null);
    if (issue == null || project == null) return;
    post(row.agentUserId(), project, issue, TEST_LABEL + TEST_LOST);
  }

  /**
   * 결과를 오래 못 받은 이어 처리 하나(WP-1312) — 대기를 비우고 「이어 처리 결과를 받지 못했습니다」를 남기고 작업을 「다음 회차 대기」로 되돌린다. 연속 실패로
   * 세지 않는다(정기 회차가 아니다). 묘비면 글 없이 비우기만 하고, 기다리는 정기 회차도 없으면 행을 지운다.
   */
  private void sweepFollowUp(IssueRecurrenceRow row) {
    log.info(
        "[recurrence] 이어 처리 결과 대기 시간 초과 issueId={} runId={}", row.issueId(), row.followUpRunId());
    if (row.deleted()) {
      finishTombstone(row, RunKind.FOLLOW_UP, null);
      return;
    }
    repository.clearFollowUp(row.issueId());
    IssueRow issue = issueRepository.findById(row.issueId()).orElse(null);
    ProjectRow project =
        issue == null ? null : projectRepository.findById(issue.projectId()).orElse(null);
    if (issue == null || project == null) return;
    // 테스트 질문의 이어 처리(WP-1313)는 테스트 표시를 붙이고 AI 작업 기록을 건드리지 않는다(시작할 때도 바꾸지 않았다).
    boolean test = row.followUpTestBy() != null;
    post(row.agentUserId(), project, issue, (test ? TEST_LABEL : "") + FOLLOW_UP_LOST);
    if (test) return;
    // 끝난 「한 번만」 예약(WP-1315)의 이어 처리는 돌아갈 「다음 회차 대기」가 없다 — 결과를 못 받은 이어 처리로 작업을 실패로 끝낸다.
    if (finishedOnce(row)) settleOnce(issue, row.agentUserId(), false, false, false);
    else restoreAfterFollowUp(row, issue);
  }

  /** 반복 하나의 이번 회차 — 보냈으면 true, 건너뛰었으면(지움·멈춤) false. */
  private boolean runOne(IssueRecurrenceRow row, Instant now) {
    IssueRow issue = issueRepository.findById(row.issueId()).orElse(null);
    ProjectRow project =
        issue == null ? null : projectRepository.findById(issue.projectId()).orElse(null);
    if (issue == null || project == null || !live(issue, row.agentUserId())) {
      // 정상 경로는 닫기·담당 해제 때 이미 거뒀다(WP-1114). 여기는 다른 경로로 어긋난 행의 안전망이다 — 회차가 도는 중이면 사람이 지울 때처럼
      // 묘비로 남겨 그 회차 결과는 글로 받는다(WP-1116).
      log.info("[recurrence] 반복 해제 — 이슈 종료·삭제 또는 담당 해제. issueId={}", row.issueId());
      cancel(row);
      return false;
    }

    // 다음 회차가 됐는데 지난 회차 결과를 아직 기다리는 중이다 — 보낸 지 PENDING_TIMEOUT 이 안 된 살아 있는 회차라(지난 것은 위
    // 정리가 이미 실패로 셌다) 실패로 세지 않고 이번 회차를 미룬다. 회차 시각은 그대로 두어, 결과가 오거나 대기가 끝난 뒤의 확인에서 보낸다.
    // 예: 09:00 회차를 보낸 뒤 09:03 에 시각을 09:05 로 당겨 저장한 경우(리뷰 PR #971).
    if (row.pendingRunId() != null) {
      log.info("[recurrence] 지난 회차 결과 대기 중 — 이번 회차를 미룬다. issueId={}", row.issueId());
      return false;
    }
    // WP-1313: 「지금 실행」(테스트 실행)이 도는 중에 회차 시각이 됐다 — 같은 규칙으로 미룬다(같은 AI 가 같은 일을 겹쳐 돌리지 않게). 회차 시각은
    // 그대로라 테스트 결과가 오거나 대기 시간이 지난 뒤의 확인(1분 간격)에서 보낸다 — 다음 회차 시각·회차 수는 바뀌지 않는다.
    if (row.testRunId() != null) {
      log.info("[recurrence] 테스트 실행 결과 대기 중 — 이번 회차를 미룬다. issueId={}", row.issueId());
      return false;
    }

    // 켜진 반복은 늘 다음 회차가 있어야 한다 — 계산할 수 없으면(규칙이 더는 회차를 내지 않음) 반복을 끄고 알린다. null 을 저장하지 않는다.
    // 「한 번만」(WP-1315)은 이번이 하나뿐인 회차라 다음 회차가 없는 것이 정상이다 — 다음 회차를 비운 채 보내고, 결과 보고가 일정을 끈다.
    boolean once = IssueRecurrenceRules.isOnce(row.rrule());
    Instant next = once ? null : rules.nextRunAfter(row.rrule(), row.runTime(), now);
    if (next == null && !once) {
      log.warn(
          "[recurrence] 다음 회차 계산 불가 — 반복을 끈다. issueId={} rrule={}", row.issueId(), row.rrule());
      repository.disable(row.issueId());
      post(row.agentUserId(), project, issue, NO_NEXT_NOTICE);
      block(issue, row.agentUserId(), NOTE_NO_NEXT);
      return false;
    }

    // 도구 신원은 AI 종류로 정한다(WP-1314) — 저장한 사람(created_by)이 아니라서, 남이 저장해도 대행 주인이 바뀌지 않는다. 대행할 주인이
    // 이 프로젝트를 더는 볼 수 없으면(프로젝트에서 빠짐) 그 사람 권한으로 결과를 남기지 않게 일정을 거둔다.
    // 이어 처리(WP-1312)도 같은 규칙({@link IssueRecurrenceRunIdentity#resolve})을 쓴다.
    OptionalLong resolved = runIdentity.resolve(row.agentUserId(), project);
    if (resolved.isEmpty()) {
      log.info("[recurrence] 반복 해제 — 대행 주인이 프로젝트를 볼 수 없음. issueId={}", row.issueId());
      cancel(row);
      return false;
    }
    long runAs = resolved.getAsLong();

    Instant runAt = row.nextRunAt();
    String runId = row.issueId() + "-" + runAt.getEpochSecond();
    repository.markDispatched(row.issueId(), runId, now, next);
    agentWorkService.startOrUpdateTracked(issue.id(), row.agentUserId(), TOOL, runningPatch());
    publisher.publishEvent(
        runEvent(
            userRepository,
            row,
            issue,
            project,
            runAs,
            assigneeRepository.findByIssue(issue.id()),
            runId,
            runAt,
            row.runCount() + 1,
            now,
            null,
            row.createdBy(),
            false));
    return true;
  }

  /**
   * 회차 실행 이벤트를 만든다 — 정기 회차({@link #runOne})와 질문의 답을 받은 이어 처리({@link
   * IssueRecurrenceFollowUpService}, WP-1312)가 같은 모양·같은 실행 경로(같은 AI·같은 도구 신원·recurring 프로필)를 쓰도록 한
   * 곳에 둔다. actor 는 반복을 저장한 사람(created_by)의 요약이다 — 도구 신원(runAs)과는 따로다(WP-1314). 이어 처리 서비스가 이 서비스 빈에
   * 의존하면 빈 순환이 생겨(이 서비스 → 챗 포스터 → ChatMessageService → 답 포트) 상태 없는 정적 도우미로 둔다.
   *
   * @param runAs 도구를 돌릴 신원(WP-1314) — 호출자가 {@link IssueRecurrenceRunIdentity#resolve} 로 정해 넘긴다(대행
   *     주인이 프로젝트를 볼 수 없으면 호출자가 실행하지 않는다)
   * @param assignees 이슈 담당자 — 호출자가 읽어 넘긴다(이어 처리는 담당 확인에 쓴 목록을 그대로 쓴다)
   * @param round 정기 회차 번호(1부터). 이어 처리는 null — 이어 처리 지시문은 회차 번호를 쓰지 않는다
   * @param followUp 이어 처리의 질문·답. 정기 회차는 null
   * @param actorId 이벤트 actor — 정기 회차·정기 질문의 이어 처리는 반복을 저장한 사람, 테스트 실행은 누른 사람, 테스트 질문의 이어 처리는 답한
   *     사람(WP-1313). 지시문의 「요청자」·「답한 사람」이 된다
   * @param test 테스트 실행이거나 테스트 질문의 이어 처리인지(WP-1313) — issue.recurring_test_run 으로 나간다
   */
  static IssueRecurringRunEvent runEvent(
      UserRepository users,
      IssueRecurrenceRow row,
      IssueRow issue,
      ProjectRow project,
      long runAs,
      List<UserSummary> assignees,
      String runId,
      Instant runAt,
      Integer round,
      Instant now,
      IssueRecurringRunEvent.FollowUp followUp,
      long actorId,
      boolean test) {
    UserSummary owner = users.findById(actorId).map(UserResponse::toSummary).orElse(null);
    return new IssueRecurringRunEvent(
        issue.id(),
        project.key(),
        project.key() + "-" + issue.number(),
        issue.title(),
        owner,
        assignees,
        row.agentUserId(),
        runAs,
        runId,
        runAt,
        round,
        row.rrule(),
        IssueRecurrenceRules.formatTime(row.runTime()),
        issue.body() == null || issue.body().isBlank() ? null : issue.body(),
        now,
        followUp,
        test);
  }

  // ───────────────────────────── 결과 보고(ai-agent) ─────────────────────────────

  /**
   * ai-agent 의 회차 결과 보고. 보고자는 AI 여야 한다(사람·없는 사용자는 403). 결과 대기 중인 회차(runId)와 같을 때만 반영하고, 다르면(같은
   * runId 두 번째·지난 회차·시간 초과로 실패 처리된 회차·실행 AI 가 바뀐 뒤 예전 AI 의 보고·지운 반복) 조용히 무시한다. runId 는 맞는데 보고자가 그
   * 반복의 AI 가 아니면 403.
   *
   * <ul>
   *   <li>성공: 결과를 그 AI 이름으로 이슈 챗에 남기고 연속 실패 수를 0 으로, 작업은 「다음 회차 대기」로.
   *   <li>실패: 연속 실패 수 +1, 「이번 회차를 실행하지 못했습니다: 사유」 글. 3회째면 반복을 끄고 작업을 「막힘」으로 두고 안내 글을 남긴다. 아니면 「다음
   *       회차 대기」로 되돌린다.
   *   <li>묘비(실행 중에 지운 반복): 결과 글만 남기고 행을 지운다.
   * </ul>
   *
   * 이슈가 그 사이 끝났으면 글만 남기고(작업 기록은 이슈 종료가 이미 닫았다) 작업 상태는 바꾸지 않는다. 이슈가 지워졌으면 글도 남기지 않는다.
   */
  public void reportRun(long callerId, long issueId, IssueRecurrenceRunReport report) {
    if (report == null || report.runId() == null || report.runId().isBlank()) {
      throw new InvalidIssueRecurrenceException("runId 가 필요합니다");
    }
    // 내부 토큰을 가진 호출이어도 대신하는 사용자가 AI 가 아니면 받지 않는다.
    boolean callerIsAgent =
        userRepository.findById(callerId).map(u -> UserKind.isAgent(u.kind())).orElse(false);
    if (!callerIsAgent) throw new AccessDeniedException("AI 만 반복 회차 결과를 보고할 수 있습니다");

    IssueRecurrenceRow row = repository.findForUpdate(issueId).orElse(null);
    // 정기 회차 id 와 이어 처리 id(WP-1312) 중 하나와 같아야 받는다 — 둘은 모양이 달라("<id>-<epoch>" / "<id>-f<글 id>") 겹치지
    // 않는다.
    boolean regular = row != null && report.runId().equals(row.pendingRunId());
    boolean followUp = row != null && report.runId().equals(row.followUpRunId());
    // WP-1313: 테스트 실행 id("<id>-t<ms>")도 모양이 달라 겹치지 않는다.
    boolean test = row != null && report.runId().equals(row.testRunId());
    if (!regular && !followUp && !test) {
      log.debug("[recurrence] 대기 중이 아닌 회차 보고 무시 issueId={} runId={}", issueId, report.runId());
      return;
    }
    if (row.agentUserId() != callerId) {
      throw new AccessDeniedException("이 반복을 실행하는 AI 만 결과를 보고할 수 있습니다");
    }
    if (test) {
      String text =
          report.ok()
              ? orDefault(report.message(), EMPTY_TEST_RESULT)
              : TEST_FAILED_PREFIX + orDefault(report.message(), "알 수 없는 오류");
      applyTestResult(row, TEST_LABEL + text, report.asQuestion(), report.pausedActions());
      return;
    }
    if (followUp) {
      String text =
          report.ok()
              ? orDefault(report.message(), EMPTY_FOLLOW_UP)
              : FOLLOW_UP_FAILED_PREFIX + orDefault(report.message(), "알 수 없는 오류");
      // 테스트 질문의 이어 처리(WP-1313)는 테스트 표시를 붙이고, 또 물으면 같은 사람이 답하는 테스트 질문으로 남긴다.
      if (row.followUpTestBy() != null) text = TEST_LABEL + text;
      applyFollowUpResult(row, report.ok(), text, report.asQuestion(), report.pausedActions());
      return;
    }
    String body =
        report.ok()
            ? orDefault(report.message(), EMPTY_RESULT)
            : FAILED_PREFIX + orDefault(report.message(), "알 수 없는 오류");
    applyResult(row, report.ok(), body, report.asQuestion());
  }

  /**
   * 회차 하나의 결과(보고된 성공·실패, 또는 결과를 못 받은 실패)를 반영한다 — 결과 대기를 비우고 연속 실패 수를 바꾸고, 그 AI 이름으로 이슈 챗에 글을 남기고,
   * 작업 기록을 「다음 회차 대기」나(3회 연속 실패) 「막힘」으로 둔다. 묘비면 글만 남기고 끝낸다({@link #finishTombstone}). 바뀐 연속 실패 수를
   * 돌려준다(묘비는 0) — {@link #MAX_CONSECUTIVE_FAILURES} 이상이면 이번 결과로 반복이 멈춘 것이다. question 이면(WP-1311) 결과
   * 글을 답변이 필요한 질문으로 남기고 반복 행의 「답을 기다리는 질문」으로 둔다(WP-1312 — 소유자가 답하면 {@link
   * IssueRecurrenceFollowUpService} 가 이어 처리한다). 작업은 그대로 「다음 회차 대기」라 다음 회차도 돈다. 이어 처리가 도는 중이면 「작업
   * 중」을 유지한다 — 이어 처리 결과가 「다음 회차 대기」로 되돌린다.
   */
  private int applyResult(IssueRecurrenceRow row, boolean ok, String body, boolean question) {
    if (row.deleted()) {
      // 지운 반복의 마지막 회차 결과 — 사용자가 시킨 회차라 글은 남기고, 작업 기록(지울 때 취소됨)은 건드리지 않는다.
      finishTombstone(row, RunKind.REGULAR, body);
      return 0;
    }
    long issueId = row.issueId();
    long agentId = row.agentUserId();
    IssueRow issue = issueRepository.findById(issueId).orElse(null);
    ProjectRow project =
        issue == null ? null : projectRepository.findById(issue.projectId()).orElse(null);

    int failures = ok ? 0 : row.consecutiveFailures() + 1;
    // 「한 번만」(WP-1315)의 그 회차 결과면(성공·실패 모두) 일정을 끄고 다음 회차를 비운다. 결과를 기다리는 사이 다시 저장해 새 시각이 잡혔으면
    // (다음 회차가 있음) 새 예약을 살려 둔다 — 지난 예약의 결과가 새 예약을 지우지 않게.
    boolean onceDone = IssueRecurrenceRules.isOnce(row.rrule()) && row.nextRunAt() == null;
    // 다음 회차는 보낼 때(markDispatched) 이미 비웠으니 끄기만 하면 된다. 멈춤(3회 연속 실패)은 아래에서 onceDone 다음에 보므로 한 번만에는 쓰이지
    // 않는다.
    boolean stop = !ok && failures >= MAX_CONSECUTIVE_FAILURES;
    boolean enabled = row.enabled() && !stop && !onceDone;
    repository.recordResult(issueId, failures, enabled);
    if (issue == null || project == null) return failures;

    postResult(issueId, agentId, project, issue, body, question, null, null);
    if (!question
        && (ok || onceDone)
        && row.pendingQuestionMessageId() != null
        && !row.testQuestion()) {
      // 질문 없이 끝난 뒤 회차가 앞선 질문을 낡게 만든다 — 소유자의 다음 아무 글이 지난 회차의 질문(예: 「메일 보낼까요?」)에 대한 답으로
      // 잡혀 소유자 권한으로 이미 의미 없는 쓰기를 하지 않게 지운다. 실패한 회차는 앞선 질문을 대신하지 못하므로 그대로 둔다 — 다만 끝난
      // 「한 번만」(WP-1315)은 이어 갈 일정이 없고, 남은 질문은 끝난 작업을 답으로 되살리므로 실패여도 지운다.
      // 「지금 실행」이 남긴 테스트 질문(WP-1313)은 정기 회차와 따로라 남긴다 — 누른 사람이 답을 기다리는 질문이 정기 회차에 사라지지 않게.
      repository.clearPendingQuestion(issueId);
    }
    if (onceDone) {
      // 한 번만 실행이 끝났다 — 질문이나 도는 이어 처리가 없으면 작업 기록을 끝낸다(성공은 완료, 실패는 실패). 이슈는 그대로 두어 사람이 결과를
      // 보고 닫는다.
      if (row.enabled()) settleOnce(issue, agentId, ok, question, row.followUpRunId() != null);
    } else if (stop && row.enabled()) {
      post(agentId, project, issue, STOPPED_NOTICE);
      block(issue, agentId, NOTE_STOPPED);
    } else if (enabled && live(issue, agentId)) {
      // 이어 처리(WP-1312)가 아직 돌면 「작업 중」을 유지한다 — 정기 회차와 이어 처리는 서로의 결과를 기다리지 않는다.
      agentWorkService.startOrUpdateTracked(
          issueId,
          agentId,
          TOOL,
          row.followUpRunId() != null ? followUpPatch() : scheduledPatch(row.nextRunAt()));
    }
    return failures;
  }

  /**
   * 이어 처리(WP-1312) 하나의 결과를 반영한다 — 이어 처리 대기를 비우고 그 AI 이름으로 결과 글을 남긴다(question 이면 질문으로 남기고 새 「답을 기다리는
   * 질문」으로 둬 대화를 이어 갈 수 있게). 연속 실패 수·다음 회차·켜짐은 바꾸지 않는다 — 실패도 사유 글만 남긴다. 작업은 「다음 회차 대기」로 되돌린다(정기 회차가
   * 도는 중이면 그대로). 묘비면 글만 남기고, 기다리는 정기 회차가 없으면 행을 지운다.
   */
  private void applyFollowUpResult(
      IssueRecurrenceRow row,
      boolean ok,
      String body,
      boolean question,
      List<RecurringPausedAction> paused) {
    if (row.deleted()) {
      finishTombstone(row, RunKind.FOLLOW_UP, body);
      return;
    }
    long issueId = row.issueId();
    repository.clearFollowUp(issueId);
    IssueRow issue = issueRepository.findById(issueId).orElse(null);
    ProjectRow project =
        issue == null ? null : projectRepository.findById(issue.projectId()).orElse(null);
    if (issue == null || project == null) return;
    // 테스트 질문의 이어 처리(WP-1313)가 또 물으면 — 같은 사람이 답하는 테스트 질문으로, 새로 멈춘 쓰기와 함께 남긴다. AI 작업 기록은 건드리지 않는다.
    Long testBy = row.followUpTestBy();
    postResult(
        issueId,
        row.agentUserId(),
        project,
        issue,
        body,
        question,
        testBy,
        testBy == null ? null : pausedJson(paused));
    if (testBy != null) return;
    // 끝난 「한 번만」 예약(WP-1315)의 질문을 이어 처리한 결과 — 또 물으면 답을 기다리고, 아니면 이 결과로 작업 기록을 끝낸다(일정은 이미 꺼져 있다).
    if (finishedOnce(row)) settleOnce(issue, row.agentUserId(), ok, question, false);
    else restoreAfterFollowUp(row, issue);
  }

  /**
   * 테스트 실행(WP-1313) 하나의 결과를 반영한다 — 테스트 대기를 비우고 그 AI 이름으로 테스트 표시를 붙인 결과 글을 남긴다. 질문이면(되돌릴 수 없는 쓰기를
   * 멈췄거나 본문이 확인을 받으라고 함) 누른 사람이 답하는 테스트 질문으로 두고 멈춘 쓰기 목록을 함께 남긴다 — 답을 받은 이어 처리가 그 쓰기만 실행한다. 다음
   * 회차·연속 실패 수·켜짐·AI 작업 기록은 바꾸지 않는다(실패도 글만). 묘비면 글만 남긴다.
   */
  private void applyTestResult(
      IssueRecurrenceRow row, String body, boolean question, List<RecurringPausedAction> paused) {
    if (row.deleted()) {
      finishTombstone(row, RunKind.TEST, body);
      return;
    }
    long issueId = row.issueId();
    repository.clearTestRun(issueId);
    IssueRow issue = issueRepository.findById(issueId).orElse(null);
    ProjectRow project =
        issue == null ? null : projectRepository.findById(issue.projectId()).orElse(null);
    if (issue == null || project == null) return;
    // 누른 사람이 없으면(구 행 등 — 정상 경로에서는 늘 있다) 반복을 저장한 사람이 답한다.
    long answerer = row.testRunRequestedBy() != null ? row.testRunRequestedBy() : row.createdBy();
    postResult(
        issueId, row.agentUserId(), project, issue, body, question, answerer, pausedJson(paused));
  }

  /**
   * 이어 처리가 끝난 뒤 작업을 되돌린다 — 켜져 있고 이슈·담당이 살아 있을 때만. 정기 회차가 결과를 기다리는 중이면 「작업 중」 메모를 회차 실행 중으로 돌려 놓고
   * (이어 처리 메모가 남지 않게), 아니면 「다음 회차 대기」로 둔다.
   */
  private void restoreAfterFollowUp(IssueRecurrenceRow row, IssueRow issue) {
    if (!row.enabled() || !live(issue, row.agentUserId())) return;
    agentWorkService.startOrUpdateTracked(
        row.issueId(),
        row.agentUserId(),
        TOOL,
        row.pendingRunId() != null ? runningPatch() : scheduledPatch(row.nextRunAt()));
  }

  /**
   * 끝난 「한 번만」 예약인지(WP-1315) — 한 번만 규칙이고, 그 회차의 결과로 꺼져 다음 회차가 없다(묘비 제외). 이때 남은 질문·도는 이어 처리가 작업 기록을
   * 끝내는 몫을 이어받는다. 결과를 기다리는 사이 다시 저장한 예약은 켜져 있어 해당하지 않는다.
   */
  static boolean finishedOnce(IssueRecurrenceRow row) {
    return !row.deleted()
        && !row.enabled()
        && row.nextRunAt() == null
        && IssueRecurrenceRules.isOnce(row.rrule());
  }

  /**
   * 「한 번만」 예약(WP-1315)의 실행 하나(회차·이어 처리)가 끝난 뒤 작업 기록을 정한다 — 질문으로 끝났으면 정기 회차 질문과 같은 「다음 회차 대기」로 답을
   * 기다리고, 이어 처리가 아직 돌면 「작업 중」을 유지하고(그 결과가 정한다), 아니면 이 결과로 끝낸다. 이슈·담당이 살아 있을 때만.
   *
   * @param followUpInFlight 다른 이어 처리가 결과를 기다리는 중인지
   */
  private void settleOnce(
      IssueRow issue, long agentId, boolean ok, boolean question, boolean followUpInFlight) {
    if (!live(issue, agentId)) return;
    if (question) {
      agentWorkService.startOrUpdateTracked(
          issue.id(), agentId, TOOL, scheduledPatch(null, NOTE_ONCE_QUESTION));
    } else if (followUpInFlight) {
      agentWorkService.startOrUpdateTracked(issue.id(), agentId, TOOL, followUpPatch());
    } else {
      agentWorkService.end(
          issue.id(),
          agentId,
          ok ? AgentWorkState.COMPLETED : AgentWorkState.FAILED,
          endPatch(ok ? NOTE_ONCE_DONE : NOTE_ONCE_FAILED));
    }
  }

  /** 작업 기록을 끝낼 때의 패치 — 반복 도구로 메모만 남긴다(WP-1315 한 번만). 질문 기한 정리(이어 처리 서비스)도 쓴다. */
  static AgentWorkPatch endPatch(String note) {
    return new AgentWorkPatch(TOOL, null, note, false, null, null, null);
  }

  /**
   * 묘비(실행 중에 지운 반복)의 정기 회차나 이어 처리(WP-1312) 결과 하나가 끝났다(받았거나 오래 못 받음) — 다른 쪽 결과도 기다리지 않으면 행을 지우고,
   * 기다리면 끝난 쪽 대기만 비운다. body 가 있으면(받은 결과) 사용자가 시킨 일이라 그 AI 이름으로 글을 남긴다 — 질문 표시 없이 일반 글로(지운 반복은 답으로
   * 이어 가지 않으니 답할 수 없는 질문 알림을 내지 않게). 프로젝트에서 빠져 더는 볼 수 없는 AI 이름으로는 글을 남길 수 없어(챗이 거절해 보고 전체가 되돌려지고
   * 묘비가 남는다) 그때는 비우기만 한다. 작업 기록(지울 때 취소됨)은 건드리지 않는다.
   *
   * @param kind 끝난 것이 정기 회차·이어 처리·테스트 실행(WP-1313) 중 무엇인지
   * @param body 남길 결과 글. 결과를 못 받아 비우기만 할 때는 null
   */
  private void finishTombstone(IssueRecurrenceRow row, RunKind kind, String body) {
    long issueId = row.issueId();
    boolean otherPending =
        (kind != RunKind.REGULAR && row.pendingRunId() != null)
            || (kind != RunKind.FOLLOW_UP && row.followUpRunId() != null)
            || (kind != RunKind.TEST && row.testRunId() != null);
    if (!otherPending) repository.delete(issueId);
    else {
      switch (kind) {
        case REGULAR -> repository.clearPendingRun(issueId);
        case FOLLOW_UP -> repository.clearFollowUp(issueId);
        case TEST -> repository.clearTestRun(issueId);
      }
    }
    if (body == null) return;
    IssueRow issue = issueRepository.findById(issueId).orElse(null);
    ProjectRow project =
        issue == null ? null : projectRepository.findById(issue.projectId()).orElse(null);
    if (issue != null && project != null && accessGuard.canRead(project, row.agentUserId())) {
      post(row.agentUserId(), project, issue, body, false);
    }
  }

  /** 반복이 멈춘 작업을 「막힘」으로 두고 소유자에게 알린다. 이슈가 끝났거나 AI 가 담당에서 빠졌으면 작업 기록을 되살리지 않는다(종료·담당 해제가 이미 닫았다). */
  private void block(IssueRow issue, long agentId, String note) {
    if (!live(issue, agentId)) return;
    agentWorkService.startOrUpdateTracked(
        issue.id(),
        agentId,
        TOOL,
        new AgentWorkPatch(TOOL, AgentWorkState.BLOCKED, note, false, null, null, null));
    // 막힘으로 들어선 순간 — 명시 보고와 같은 AI 작업 알림 경로(AgentWorkNoticeEvent)로 소유자에게 「답변 필요」 알림을 낸다. 수신자는
    // notify 가 이슈 챗 질문과 같은 규칙으로 고른다(개인 작업이라 소유자).
    agentWorkService.publishEnteredNotice(issue, agentId, AgentWorkState.BLOCKED);
  }

  /**
   * 비서를 이 개인 작업의 담당으로 넣는다 — 개인 프로젝트는 멤버만 담당이 될 수 있는데(AssigneePolicy) 개인 작업 화면에는 AI 를 멤버로 넣는 길이 없어,
   * 반복 저장이 대신 멤버(MEMBER)로 넣고 담당에 더한다. 멤버 추가·담당 교체는 사람이 할 때와 같은 서비스 경로를 타서 검증·이력·워처·실시간 갱신이 같다. 다만
   * 담당 지정이 AI 를 깨워 이슈 작업을 시작하게(issue.assigned 실행) 하지는 않는다 — 이 AI 는 반복 회차 이벤트로만 일한다.
   *
   * <p>{@code dropAgentId}(이 반복이 넣었던 예전 비서)는 같은 교체에서 담당에서 뺀다(WP-1119). 프로젝트 멤버에서는 빼지 않는다 — 같은 개인
   * 프로젝트의 다른 반복이 그 AI 를 쓰고 있을 수 있다.
   *
   * @param assigneeIds 이슈 행을 잠근 뒤 읽은 지금 담당 목록
   */
  private void enrollAssistant(
      long callerId,
      ProjectRow project,
      String projectKey,
      IssueRow issue,
      long agentId,
      List<Long> assigneeIds,
      Long dropAgentId) {
    if (!memberRepository.isDirectMember(project.id(), agentId)) {
      projectService.addMember(callerId, projectKey, new AddMemberRequest(agentId, "MEMBER"));
    }
    boolean add = !assigneeIds.contains(agentId);
    boolean drop = dropAgentId != null && assigneeIds.contains(dropAgentId);
    if (!add && !drop) return;
    List<Long> target = new ArrayList<>(assigneeIds);
    if (drop) target.remove(dropAgentId);
    if (add) target.add(agentId);
    assigneeService.replace(callerId, projectKey, issue.number(), target, false);
  }

  /**
   * 잠근 반복 행을 거두고 그 AI 의 작업 기록을 취소로 끝낸다 — 지울지 묘비로 남길지는 {@link
   * IssueRecurrenceRepository#retireLocked} 한 규칙이다. 사람이 지울 때({@link #delete})와 스케줄러가 끝난 이슈·담당 해제를
   * 발견했을 때 같은 규칙을 쓴다(WP-1116 — 스케줄러 쪽은 행을 바로 지워 그 회차 결과가 버려졌다).
   */
  private void cancel(IssueRecurrenceRow row) {
    repository.retireLocked(row.issueId(), row.anyRunInFlight());
    cancelWork(row.issueId(), row.agentUserId());
  }

  /** 그 AI 의 반복 작업 기록을 취소로 끝낸다. */
  private void cancelWork(long issueId, long agentId) {
    agentWorkService.end(issueId, agentId, AgentWorkState.CANCELED, AgentWorkPatch.empty());
  }

  /** 이슈가 아직 열려 있고 AI 가 담당에 있는지 — 작업 기록을 바꿔도 되는지. */
  private boolean live(IssueRow issue, long agentId) {
    return agentWorkService.isLiveFor(issue, agentId);
  }

  // ───────────────────────────── 내부 도우미 ─────────────────────────────

  /** 그 AI 이름으로 이슈 챗에 글을 남긴다 — 챗 글 한도를 넘으면 자른다. */
  private void post(long agentId, ProjectRow project, IssueRow issue, String body) {
    post(agentId, project, issue, body, false);
  }

  /**
   * 회차·이어 처리의 결과 글을 남긴다 — question 이면 질문 글로 남기고 반복 행의 「답을 기다리는 질문」으로 둔다(WP-1312 — 소유자가 답하면 {@link
   * IssueRecurrenceFollowUpService} 가 이어 처리한다). 묘비의 결과는 답으로 이어 가지 않아 이 길을 쓰지 않는다({@link
   * #finishTombstone}).
   */
  private void postResult(
      long issueId,
      long agentId,
      ProjectRow project,
      IssueRow issue,
      String body,
      boolean question,
      Long answerer,
      String pausedActions) {
    long messageId = post(agentId, project, issue, body, question);
    // answerer 가 있으면 테스트 질문(WP-1313) — 그 사람만 답하고, 멈춘 쓰기만 이어 처리가 실행한다. 정기 회차 질문은 둘 다 비운다.
    if (question) {
      repository.setPendingQuestion(
          issueId, messageId, chatText(body), Instant.now(), answerer, pausedActions);
    }
  }

  /**
   * 테스트 실행이 멈춘 쓰기 목록을 반복 행에 보관할 JSON 으로(WP-1313). 없으면 null. 너무 길면 인자를 빼고 도구 이름만 남긴다 — 허락 판정은 이름으로
   * 하고, 인자는 이어 처리 지시문의 참고일 뿐이다. 이름이 빈 항목은 버린다.
   */
  private String pausedJson(List<RecurringPausedAction> paused) {
    if (paused == null || paused.isEmpty()) return null;
    List<RecurringPausedAction> kept =
        paused.stream()
            .filter(a -> a != null && a.tool() != null && !a.tool().isBlank())
            .limit(PAUSED_ACTIONS_MAX)
            .toList();
    if (kept.isEmpty()) return null;
    try {
      String json = objectMapper.writeValueAsString(kept);
      if (json.length() <= PAUSED_ACTIONS_MAX_CHARS) return json;
      return objectMapper.writeValueAsString(
          kept.stream().map(a -> new RecurringPausedAction(a.tool(), null)).toList());
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("멈춘 쓰기 목록을 저장하지 못했습니다", e);
    }
  }

  /** 보관한 멈춘 쓰기 JSON 을 목록으로(WP-1313) — 이어 처리 이벤트에 「허락된 쓰기」로 싣는다. 없거나 읽을 수 없으면 빈 목록. */
  static List<RecurringPausedAction> readPaused(ObjectMapper om, String json) {
    if (json == null || json.isBlank()) return List.of();
    try {
      return om.readValue(json, new TypeReference<List<RecurringPausedAction>>() {});
    } catch (JsonProcessingException e) {
      log.warn("[recurrence] 멈춘 쓰기 목록을 읽지 못했습니다 — 허락 없이 이어 처리한다", e);
      return List.of();
    }
  }

  /** 그 AI 이름으로 이슈 챗에 글을 남기고 글 id 를 돌려준다 — question 이면 답변이 필요한 질문 글로(WP-1311). */
  private long post(
      long agentId, ProjectRow project, IssueRow issue, String body, boolean question) {
    return chatPoster.post(
        agentId, project.key(), issue.number(), chatText(body), question, List.of());
  }

  /** 이슈 챗에 실제로 남는 본문 — 챗 글 한도를 넘으면 자른다. 질문 본문으로도 이 값을 남긴다(이어 처리 지시문이 화면과 같은 글을 본다). */
  private static String chatText(String body) {
    return body.length() <= CHAT_BODY_MAX
        ? body
        : Texts.headUtf16(body, CHAT_BODY_MAX - TRUNCATED_MARK.length()) + TRUNCATED_MARK;
  }

  /** 「작업 중」 작업 패치 — 회차를 보낸 뒤 결과를 기다리는 동안. */
  private static AgentWorkPatch runningPatch() {
    return new AgentWorkPatch(TOOL, AgentWorkState.WORKING, NOTE_RUNNING, false, null, null, null);
  }

  /** 「작업 중」 작업 패치 — 질문의 답을 받아 이어 처리하는 동안(WP-1312). */
  static AgentWorkPatch followUpPatch() {
    return new AgentWorkPatch(
        TOOL, AgentWorkState.WORKING, NOTE_FOLLOW_UP, false, null, null, null);
  }

  /** 「다음 회차 대기」 작업 패치 — SCHEDULED + 다음 회차 시각. */
  private static AgentWorkPatch scheduledPatch(Instant next) {
    return scheduledPatch(next, NOTE_SCHEDULED);
  }

  /** 「다음 회차 대기」 작업 패치 — 메모를 고른다(한 번만이 답을 기다릴 때는 다음 회차 시각 없이, WP-1315). */
  private static AgentWorkPatch scheduledPatch(Instant next, String note) {
    return new AgentWorkPatch(TOOL, AgentWorkState.SCHEDULED, note, false, null, null, null, next);
  }

  private IssueRow issue(ProjectRow project, String projectKey, int number) {
    return issueRepository
        .findByProjectAndNumber(project.id(), number)
        .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
  }

  private IssueRecurrenceResponse toResponse(IssueRecurrenceRow r, long callerId) {
    String agentName =
        userRepository
            .findById(r.agentUserId())
            .map(u -> u.name() != null && !u.name().isBlank() ? u.name() : u.username())
            .orElse(null);
    return new IssueRecurrenceResponse(
        r.rrule(),
        IssueRecurrenceRules.formatTime(r.runTime()),
        r.enabled(),
        r.nextRunAt(),
        r.consecutiveFailures(),
        r.lastRunAt(),
        r.agentUserId(),
        agentName,
        !othersAssistant(r.agentUserId(), callerId),
        r.testRunId() != null);
  }

  // ───────────────────────────── 담당 AI(WP-1314) ─────────────────────────────

  /**
   * 저장할 담당 AI — 요청이 고른 AI, 없으면 개인 작업은 소유자의 AI 비서(지금처럼 매번 다시 정한다 — 개인 비서를 새로 정했으면 그 비서로 바뀐다), 팀 이슈는
   * 지금 일정의 AI, 없으면 후보의 첫째(구성원인 내 개인 비서가 맨 앞).
   */
  private long chooseAgent(
      long callerId, ProjectRow project, IssueRecurrenceRequest req, IssueRecurrenceRow live) {
    if (req != null && req.agentUserId() != null) return req.agentUserId();
    if (isPersonal(project)) {
      return assistantResolver
          .resolveOrEmpty(project.ownerId())
          .map(AssistantSpec::agentUserId)
          .orElseThrow(() -> conflict(NO_ASSISTANT));
    }
    if (live != null) return live.agentUserId();
    return candidates(project, callerId).stream()
        .findFirst()
        .map(IssueRecurrenceAgentOption::id)
        .orElseThrow(() -> conflict(NO_ASSISTANT));
  }

  /**
   * 담당 AI 후보 — 서버가 실행하는(INTERNAL·워크스페이스 활성·AI 키 있음) AI 중, 팀 이슈는 프로젝트 직접 구성원인 AI, 개인 작업은 구성원 AI 와
   * 소유자의 AI 비서(저장하면 구성원으로 넣는다). 남의 개인 비서는 빼고, 내 개인 비서를 맨 앞에(나머지는 이름순) 둔다. 키·주인은 한 번에 읽는다.
   */
  private List<IssueRecurrenceAgentOption> candidates(ProjectRow project, long callerId) {
    Set<Long> ids = new LinkedHashSet<>();
    if (isPersonal(project)) {
      assistantResolver
          .resolveOrEmpty(project.ownerId())
          .ifPresent(spec -> ids.add(spec.agentUserId()));
    }
    memberRepository.findAllByProject(project.id()).stream()
        .filter(m -> UserKind.isAgent(m.kind()))
        .forEach(m -> ids.add(m.userId()));
    if (ids.isEmpty()) return List.of();
    Map<Long, Long> owners = personalAssistantRepository.findOwnerIds(ids);
    List<IssueRecurrenceAgentOption> out = new ArrayList<>();
    for (AssigneeInfo info : runnable(ids)) {
      Long owner = owners.get(info.id());
      if (owner != null && owner != callerId) continue;
      out.add(
          new IssueRecurrenceAgentOption(info.id(), info.username(), info.name(), owner != null));
    }
    out.sort(
        Comparator.comparing((IssueRecurrenceAgentOption o) -> !o.personalAssistant())
            .thenComparing(o -> o.name() == null ? o.username() : o.name()));
    return out;
  }

  /**
   * 서버가 실행할 수 있는 AI 인지 — INTERNAL·워크스페이스 활성(409), AI 키 연결(409). 후보 목록과 같은 {@link #runnable} 기준이다.
   */
  private void requireServerAgent(long agentId) {
    boolean internal =
        userRepository.findAssigneeInfos(List.of(agentId), TenantContext.get()).stream()
            .anyMatch(IssueRecurrenceService::internalActive);
    if (!internal) throw conflict(NOT_SERVER_AGENT);
    if (runnable(List.of(agentId)).isEmpty()) throw conflict(NO_AGENT_KEY);
  }

  /** 이 id 들 중 서버가 실행할 수 있는 AI — INTERNAL·워크스페이스 활성·AI 키 있음. 키는 한 번에 읽는다. */
  private List<AssigneeInfo> runnable(Collection<Long> ids) {
    Set<Long> keyed = credentialRepository.findActiveIdsByUsers(ids).keySet();
    return userRepository.findAssigneeInfos(ids, TenantContext.get()).stream()
        .filter(i -> internalActive(i) && keyed.contains(i.id()))
        .toList();
  }

  private static boolean internalActive(AssigneeInfo info) {
    return info.isInternalAgent() && info.isActive();
  }

  /** 남의 개인 비서면 403 — 그 일정은 주인만 저장·고치기·끄기 한다(WP-638). */
  private void requireOwnerOf(long agentId, long callerId) {
    if (othersAssistant(agentId, callerId)) throw new AccessDeniedException(OTHERS_ASSISTANT);
  }

  /** 이 AI 가 callerId 가 아닌 다른 사람의 개인 비서인지. */
  private boolean othersAssistant(long agentId, long callerId) {
    return personalAssistantRepository
        .findOwnerId(agentId)
        .filter(owner -> owner != callerId)
        .isPresent();
  }

  private static boolean isPersonal(ProjectRow project) {
    return "PERSONAL".equals(project.type());
  }

  private static String orDefault(String s, String fallback) {
    return s == null || s.isBlank() ? fallback : s.strip();
  }

  private static IssueRecurrenceConflictException conflict(String message) {
    return new IssueRecurrenceConflictException(message);
  }

  /** 결과를 기다리는 실행의 종류 — 묘비 정리가 어느 대기를 비울지 가른다(WP-1313). */
  private enum RunKind {
    REGULAR,
    FOLLOW_UP,
    TEST
  }
}
