package com.workplace.issue.service;

import com.workplace.global.security.AgentToolContext;
import com.workplace.global.service.UserMentionHydrator;
import com.workplace.global.util.MentionParser;
import com.workplace.global.util.Texts;
import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.dto.AgentWorkReportResponse;
import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.dto.ReportAgentWorkRequest;
import com.workplace.issue.exception.AgentToolRequiredException;
import com.workplace.issue.exception.AgentWorkIssueClosedException;
import com.workplace.issue.exception.AgentWorkNotAssigneeException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.AgentWorkAutoStarted;
import com.workplace.issue.outbound.AgentWorkNoticeEvent;
import com.workplace.issue.outbound.IssueChatPoster;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.dto.UserKind;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 작업 명시 보고(WP-377 §4.1). 담당자 본인의 작업을 시작·갱신·종료하고, 선택적으로 이슈 챗에 글을 올린다. AgentWorkService 는
 * IssueChatPoster 에 의존하지 않고 이 서비스만 의존해 빈 순환을 피한다.
 */
@Service
@RequiredArgsConstructor
public class AgentWorkReportService {

  /** message 에서 note 를 만들 때 자르는 길이 — note 컬럼 한도와 같다. */
  static final int NOTE_MAX = 120;

  private final AgentWorkService agentWorkService;
  private final IssueService issueService;
  private final IssueRepository issueRepository;
  private final IssueAssigneeRepository assigneeRepository;
  private final ProjectRepository projectRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueChatPoster chatPoster;
  private final ApplicationEventPublisher publisher;
  private final UserMentionHydrator mentionHydrator;

  /** 명시 보고. 부수 쓰기(상태 변경·챗 글)가 자동 터치로 보고 상태를 되돌리지 않도록 전체를 억제 구간으로 감싼다. */
  @Transactional
  public AgentWorkReportResponse report(
      long callerId, String projectKey, int number, ReportAgentWorkRequest req) {
    String tool = AgentToolContext.current();
    if (tool == null) throw new AgentToolRequiredException();
    return AgentToolContext.suppressTouch(() -> doReport(callerId, projectKey, number, req, tool));
  }

  private AgentWorkReportResponse doReport(
      long callerId, String projectKey, int number, ReportAgentWorkRequest req, String tool) {
    var project = accessGuard.assertReadable(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    // 담당자 확인과 작업자 종류(AI 작업 알림은 AI 일 때만, WP-913)를 한 번의 조회로 함께 얻는다 — 종료 경로에는 작업자 정보가 담긴 뷰가 없다.
    var caller =
        assigneeRepository.findByIssue(issue.id()).stream()
            .filter(a -> a.id().equals(callerId))
            .findFirst()
            .orElseThrow(AgentWorkNotAssigneeException::new);
    boolean agentWorker = UserKind.isAgent(caller.kind());
    if (IssueStatuses.CLOSED.contains(issue.status())) throw new AgentWorkIssueClosedException();

    boolean hasMessage = req.message() != null && !req.message().isBlank();

    // 종료 상태(COMPLETED·FAILED·CANCELED·REJECTED)는 진행 상태 갱신이 아니라 작업 행을 닫는 신호다.
    // startOrUpdate 에 넘기지 않고, TODO 이슈도 IN_PROGRESS 로 올리지 않으며 이슈 상태는 건드리지 않는다.
    if (AgentWorkState.isTerminal(req.state())) {
      // message 는 상태와 무관한 챗 글(스펙 §4.1) — 종료 보고여도 먼저 올린다(질문 표시 없음).
      if (hasMessage) {
        chatPoster.post(callerId, projectKey, number, req.message(), false, req.fileIds());
      }
      // 착수 전(SUBMITTED)에서 곧바로 종료 보고하면 행의 tool 이 비어 있으므로 요청의 도구를 종료와 함께 채우고, 보고에 담긴 마지막
      // note·progress·단계 수도 같은 문장에서 반영한다(note 는 일반 보고와 같은 규칙으로 정한다).
      boolean ended =
          agentWorkService.end(
              issue.id(),
              callerId,
              req.state(),
              new AgentWorkPatch(
                  tool,
                  null,
                  noteFor(req, hasMessage),
                  "".equals(req.note()),
                  req.progress(),
                  req.stepsDone(),
                  req.stepsTotal()));
      // 실패·거절로 실제로 끝낸 순간에만 상태 알림을 싣는다 — 진행 중 작업이 없었으면(이미 끝난 뒤 재보고) end 가 false 라 알림도 없다(WP-913).
      // 사람이 자기 도구로 보고한 작업은 AI 작업 상태 알림 대상이 아니다. 글의 멘션은 함께 실어 사람당 1건으로 알린다(WP-1009).
      boolean noticeEnd = agentWorker && ended && AgentWorkNoticeEvent.ON_END.contains(req.state());
      publishNotice(issue, callerId, noticeEnd ? req.state() : null, mentionsOf(req, hasMessage));
      return new AgentWorkReportResponse(null, true, null);
    }

    // 작업을 시작했으면 TODO 이슈는 진행 중으로 — 상태 변경이 자동 터치로 보고를 덮지 않게 이미 억제 구간 안이다.
    // 단, 다음 회차 대기(SCHEDULED) 보고는 아직 착수 전(「월요일 9시에 시작」)이라 이슈 상태를 바꾸지 않는다(WP-450).
    // AI 가 사람을 멘션한 대기 중 보고는 답변 필요로 저장한다(WP-1217) — 아래 상태 변경·질문 저장·알림이 모두 바뀐 상태를 따른다.
    String state = storedState(req, agentWorker, hasMessage);
    boolean scheduled = AgentWorkState.SCHEDULED.equals(state);
    if (IssueStatuses.TODO.equals(issue.status()) && !scheduled) {
      issueService.updateStatus(callerId, projectKey, number, IssueStatuses.IN_PROGRESS);
    }

    boolean clearNote = "".equals(req.note());

    var transition =
        agentWorkService.startOrUpdateTracked(
            issue.id(),
            callerId,
            tool,
            new AgentWorkPatch(
                tool,
                state,
                noteFor(req, hasMessage),
                clearNote,
                req.progress(),
                req.stepsDone(),
                req.stepsTotal(),
                req.nextRunAt()));
    var view = transition.view();
    // 갱신된 상태가 답변 필요(INPUT_REQUIRED)이고 작업자가 AI 구성원일 때만 질문으로 저장한다(사람 글·인증 필요 글은 일반 글).
    boolean question =
        hasMessage && AgentWorkState.INPUT_REQUIRED.equals(view.state()) && agentWorker;
    // 상태가 이번 보고로 그 값이 된 순간에만 상태 알림을 싣는다(같은 상태 재보고·note 갱신은 제외, WP-913). 글의 멘션도 함께 실어 사람당 1건으로
    // 알린다(WP-1009). 글 있는 AI 질문은 챗 질문 글이 관계자 ∪ 멘션에게 AI_QUESTION 을 만들므로 둘 다 싣지 않는다 — 사람당 1건.
    boolean notice =
        agentWorker
            && !Objects.equals(transition.previousState(), view.state())
            && noticeOnEnter(view.state(), hasMessage);
    publishNotice(
        issue,
        callerId,
        notice ? view.state() : null,
        question ? List.of() : mentionsOf(req, hasMessage));

    // 질문 여부를 생성과 함께 저장하려고 작업 갱신 뒤에 글을 올린다 — 같은 트랜잭션이라 이벤트는 커밋 뒤 함께 나간다.
    if (hasMessage) {
      chatPoster.post(callerId, projectKey, number, req.message(), question, req.fileIds());
    }
    return new AgentWorkReportResponse(
        view, false, Objects.equals(state, req.state()) ? null : req.state());
  }

  /**
   * 저장할 진행 상태(WP-1217). AI 작업자가 대기 중(WAITING)으로 보고하며 글에서 사람(HUMAN)을 멘션했으면 답변 필요(INPUT_REQUIRED)로
   * 바꾼다 — 사람에게 묻거나 사람의 답을 기다리는 일은 사람의 할 일·질문 알림에 떠야 하는데, 대기 중이면 잡히지 않아 이슈가 방치됐다. 거절하지 않고 바꿔 저장해 AI
   * 가 규칙을 놓쳐도 사람에게 질문이 반드시 간다. AI 만 멘션한 대기 중(검토자 AI 리뷰 요청 등)·사람 작업자의 보고·작업 중 보고는 그대로 둔다 — 작업 중 글의
   * 사람 멘션은 질문인지 알림인지 서버가 가릴 수 없다.
   */
  private String storedState(ReportAgentWorkRequest req, boolean agentWorker, boolean hasMessage) {
    if (!agentWorker || !hasMessage || !AgentWorkState.WAITING.equals(req.state())) {
      return req.state();
    }
    boolean mentionsHuman =
        mentionHydrator.asMentionResponses(MentionParser.parse(req.message())).stream()
            .anyMatch(m -> UserKind.HUMAN.equals(m.kind()));
    return mentionsHuman ? AgentWorkState.INPUT_REQUIRED : req.state();
  }

  /**
   * MCP 쓰기로 할 일 이슈의 AI 작업이 자동 시작됐으면(WP-393) 명시 보고와 같은 규칙으로 진행 중으로 올린다(이력·상태 변경 알림 포함). 쓰기와 같은 트랜잭션의
   * 동기 리스너다. 명시 보고와 달리 멤버가 아니면 건너뛴다 — 상태는 멤버만 바꿀 수 있어 403 이 나면 AI 가 한 원래 쓰기까지 함께 롤백되기 때문. 상태 변경 알림이
   * 다시 자동 터치를 일으켜 작업 이벤트를 한 번 더 남기지 않게 터치 억제 구간에서 바꾼다. 그 사이 프로젝트가 사라졌으면 건너뛴다.
   */
  @EventListener
  public void onAgentWorkAutoStarted(AgentWorkAutoStarted e) {
    projectRepository
        .findById(e.projectId())
        .filter(project -> accessGuard.isMemberOrAdmin(project, e.actorId()))
        .ifPresent(
            project ->
                AgentToolContext.suppressTouch(
                    () ->
                        issueService.updateStatus(
                            e.actorId(),
                            project.key(),
                            e.issueNumber(),
                            IssueStatuses.IN_PROGRESS)));
  }

  /**
   * 진행 상태로 들어설 때 알릴 상태인지 — {@link AgentWorkNoticeEvent#ON_ENTER}(검토 대기·권한 필요·막힘·답변 필요). 답변 필요는 글이
   * 없을 때만 — 글이 있으면 챗 질문 글이 AI_QUESTION 을 만든다.
   */
  private static boolean noticeOnEnter(String state, boolean hasMessage) {
    if (!AgentWorkNoticeEvent.ON_ENTER.contains(state)) return false;
    return !(AgentWorkState.INPUT_REQUIRED.equals(state) && hasMessage);
  }

  /**
   * 보고 알림 이벤트를 낸다(WP-913·WP-1009) — 커밋 뒤 notify 가 상태 알림과 멘션 알림을 사람당 1건으로 만든다. state 는 AI 작업자의 알릴 상태
   * 변화가 있을 때만(호출측 판정, 없으면 null). 검토 요청·실패의 수신 후보는 [이 작업자 담당 행을 만든 사람, 보고자] 순서. 후보·멘션이 사람이고 이슈를 볼 수
   * 있는지는 notify 가 판정한다. 알릴 것이 없으면 내지 않는다.
   */
  private void publishNotice(IssueRow issue, long callerId, String state, List<Long> mentionedIds) {
    if (state == null && mentionedIds.isEmpty()) return;
    List<Long> candidates = new ArrayList<>(2);
    if (state != null) {
      assigneeRepository.findAssignedBy(issue.id(), callerId).ifPresent(candidates::add);
      if (issue.reporterId() != null) candidates.add(issue.reporterId());
    }
    publisher.publishEvent(
        new AgentWorkNoticeEvent(issue.id(), callerId, state, candidates, mentionedIds));
  }

  /** 보고 글(message)의 멘션 id(<@id> 토큰) — 글이 없으면 빈 목록. */
  private static List<Long> mentionsOf(ReportAgentWorkRequest req, boolean hasMessage) {
    return hasMessage ? MentionParser.parse(req.message()) : List.of();
  }

  /**
   * 보고의 note: 빈 문자열은 지우기(null + clearNote), 미지정이면 message 첫 줄(최대 120자)로 대체, 둘 다 없으면 null(유지). note
   * 는 화면이 글자 그대로 보이므로 첫 줄의 멘션 토큰(<@id>)은 @이름으로 바꾼다(WP-1009 — MCP 가 글의 @username 을 토큰으로 바꿔 보낸다).
   */
  private String noteFor(ReportAgentWorkRequest req, boolean hasMessage) {
    if (req.note() == null) return hasMessage ? firstLine(req.message()) : null;
    return req.note().isEmpty() ? null : req.note();
  }

  /**
   * message 첫 줄(앞뒤 공백 제거)을 note 한도로 자른다. 첫 줄의 멘션 토큰은 자르기 전에 {@code @이름} 으로 바꾼다 — 토큰이 없으면 조회하지 않고, 첫
   * 줄에 든 멘션만 조회한다.
   */
  private String firstLine(String message) {
    String raw = message.strip().lines().findFirst().orElse("").strip();
    // 토큰이 없으면 asMentionResponses 가 조회 없이 빈 목록을 돌려 그대로 남는다.
    String line =
        MentionParser.replaceWithNames(
            raw, mentionHydrator.asMentionResponses(MentionParser.parse(raw)));
    // 서로게이트 쌍(이모지 등)을 반으로 쪼개지 않게 자른다.
    return Texts.headUtf16(line, NOTE_MAX);
  }
}
