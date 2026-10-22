package com.workplace.issue.service;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.dto.CreateCommentRequest;
import com.workplace.issue.dto.IssueCommentResponse;
import com.workplace.issue.dto.UpdateCommentRequest;
import com.workplace.issue.exception.IssueCommentNotFoundException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.AgentToolWriteEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentDeletedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentUpdatedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentedEvent;
import com.workplace.issue.outbound.IssueHumanReplyPosted;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueCommentRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.dto.UserKind;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 이슈 코멘트 서비스. 코멘트 작업 전 이슈 → 프로젝트 멤버십을 검증한다. */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueCommentService {

  private final IssueRepository issueRepository;
  private final IssueCommentRepository commentRepository;
  private final ProjectAccessGuard accessGuard;
  private final ProjectRepository projectRepository;
  private final com.workplace.watcher.service.WatcherAutoEnroller watcherAutoEnroller;
  private final IssueAssigneeRepository assigneeRepository;
  private final UserRepository userRepository;
  private final ApplicationEventPublisher publisher;
  // 코멘트에 넣은 이미지(WP-362)를 본문 이미지와 같은 이슈 단위로 연결·강등한다.
  private final IssueBodyImageService bodyImageService;

  /**
   * 이슈 → 프로젝트 → 조회 가드(readable). OPEN 은 테넌트 전원 조회 허용(RLS 가 테넌트 경계 보장). 프로젝트 row 반환.
   *
   * <p>읽기 진입점(list) 및 author/OWNER 판정 전 base 접근(update/delete)에 사용한다. 작성(create)은 별도로
   * assertContentWritable 로 더 강하게 게이트한다.
   */
  private ProjectRow assertIssueReadable(Long issueId, Long callerId) {
    return assertIssueReadableWithIssue(issueId, callerId).project();
  }

  /**
   * 볼 수 없는 프로젝트의 이슈는 없는 이슈와 같은 404 로 돌려준다(WP-588) — 이슈 id 로 들어오는 경로라 403 이면 볼 수 없는 프로젝트의 이슈가 있다는 것이
   * 드러난다. 볼 수 있는 프로젝트에서 작성 자격만 없는 경우(OPEN 의 임의 reader)는 호출부가 403 으로 거른다.
   */
  private void requireVisible(ProjectRow project, Long callerId) {
    if (!accessGuard.canRead(project.id(), callerId)) {
      throw new IssueNotFoundException();
    }
  }

  /** issue/project 를 함께 반환하는 버전 — update/delete 에서 이벤트 payload(issueNumber/title) 구성에 재사용. */
  private IssueAndProject assertIssueReadableWithIssue(Long issueId, Long callerId) {
    var issue = issueRepository.findById(issueId).orElseThrow(IssueNotFoundException::new);
    var project =
        projectRepository
            .findById(issue.projectId())
            // 삭제된 프로젝트의 이슈도 없는 이슈와 같게 본다(WP-564·588).
            .orElseThrow(IssueNotFoundException::new);
    requireVisible(project, callerId);
    return new IssueAndProject(issue, project);
  }

  private record IssueAndProject(com.workplace.issue.dto.IssueRow issue, ProjectRow project) {}

  /** 수정·삭제 대상 코멘트까지 함께 — 이전 글을 이미지 동기화에 넘긴다(WP-362). */
  private record MutableComment(IssueAndProject target, IssueCommentResponse comment) {}

  private static final String DELETE_DENIED = "코멘트 삭제 권한이 없습니다";

  /**
   * 코멘트 수정·삭제 술어 — 이슈 조회 가능 + 코멘트가 <b>그 이슈 소속</b> + 작성자(삭제는 프로젝트 OWNER 도) + 이슈 쓰기 권한(WP-492).
   *
   * <p>WP-620: 수정은 작성자만 — 화면은 코멘트를 원래 작성자 이름으로 보이므로 OWNER 가 고치면 남의 말을 지어낼 수 있다. OWNER 의 관리는 삭제로 한다.
   *
   * <p>#856: 소속 대조가 없으면 A 프로젝트 OWNER 가 자기 이슈 id 에 B 프로젝트 코멘트 id 를 붙여 남의 코멘트를 지울 수 있었다(OWNER 판정이 경로의
   * issueId 기준이므로). 다른 이슈의 코멘트는 없는 코멘트와 같은 404 로 응답한다.
   */
  private MutableComment checkCommentMutable(
      Long callerId, Long issueId, Long commentId, boolean ownerAllowed, String deniedMessage) {
    var issueAndProject = assertIssueReadableWithIssue(issueId, callerId);
    var existing =
        commentRepository
            .findById(commentId)
            .filter(c -> c.issueId().equals(issueId))
            .orElseThrow(() -> new IssueCommentNotFoundException(commentId));
    boolean isAuthor = existing.authorId().equals(callerId);
    boolean isOwner = false;
    if (ownerAllowed && !isAuthor) {
      try {
        accessGuard.assertWithRole(issueAndProject.project().key(), callerId, "OWNER");
        isOwner = true;
      } catch (ProjectAccessDeniedException ignored) {
        // OWNER 아님 — isAuthor 만으로 판단
      }
    }
    if (!isAuthor && !isOwner) {
      throw new ProjectAccessDeniedException(deniedMessage);
    }
    // WP-492: 작성자라도 지금 이 이슈에 글을 쓸 수 없으면(OPEN 프로젝트에서 빠진 멤버 등) 수정·삭제도 막는다 — 작성(create)과 같은 규칙·문구.
    accessGuard.assertContentWritable(
        issueAndProject.project(), issueAndProject.issue().reporterId(), callerId);
    return new MutableComment(issueAndProject, existing);
  }

  /** 코멘트 삭제 사전검증(#856) — 확인 카드 dry-run 이 {@link #delete} 와 같은 {@link #checkCommentMutable} 를 쓴다. */
  @Transactional(readOnly = true)
  public void validateDeletable(Long callerId, Long issueId, Long commentId) {
    checkCommentMutable(callerId, issueId, commentId, true, DELETE_DENIED);
  }

  /** 이슈 코멘트 목록 조회. OPEN 은 테넌트 전원 조회 가능(readable). */
  @Transactional(readOnly = true)
  public List<IssueCommentResponse> list(Long callerId, Long issueId) {
    assertIssueReadable(issueId, callerId);
    return commentRepository.findByIssue(issueId);
  }

  /**
   * 코멘트 생성. 작성 = 멤버/ADMIN 또는 (OPEN && 이슈 reporter 본인)만(assertContentWritable). 임의 테넌트 유저는 목록 조회만
   * 가능하고 작성은 403. 작성자를 자동으로 issue watcher 로 등록한다.
   */
  public IssueCommentResponse create(Long callerId, Long issueId, CreateCommentRequest req) {
    var issue = issueRepository.findById(issueId).orElseThrow(IssueNotFoundException::new);
    var project =
        projectRepository
            .findById(issue.projectId())
            // 삭제된 프로젝트의 이슈도 없는 이슈와 같게 본다(WP-564·588).
            .orElseThrow(IssueNotFoundException::new);
    requireVisible(project, callerId);
    // 댓글 작성 자격: 멤버/ADMIN 또는 OPEN 이슈 reporter 본인. 그 외(볼 수는 있는 임의 테넌트 reader)는 403.
    accessGuard.assertContentWritable(project, issue.reporterId(), callerId);
    var resp = commentRepository.insert(issueId, callerId, req.body());
    // 코멘트 이미지 연결(WP-362) — 이미지 참조가 없는 코멘트(대부분)는 syncIssueImages 가 쿼리 없이 돌아간다.
    bodyImageService.syncIssueImages(project, issueId, callerId, null, req.body());
    watcherAutoEnroller.enroll(project, issueId, callerId, callerId);

    // 도메인 이벤트 발행 (AFTER_COMMIT 에서 ai-agent 발사 후보) — issue 는 위에서 이미 로드해 재사용.
    var assignees = assigneeRepository.findByIssue(issueId);
    var actor =
        userRepository
            .findById(callerId)
            .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
            .orElse(null);
    String issueKey = project.key() + "-" + issue.number();
    publisher.publishEvent(
        new IssueCommentedEvent(
            issueId,
            project.key(),
            issueKey,
            issue.number(),
            issue.title(),
            actor,
            assignees,
            resp.id(),
            req.body(),
            Instant.now()));
    // MCP(수행 도구 헤더) 경유 코멘트면 AI 작업 자동 시작·터치(WP-377). 코멘트 작성은 이슈 updated 알림을 거치지 않아 여기서 직접 낸다.
    AgentToolWriteEvent.publishIfAgentTool(publisher, issueId, callerId, false, false, false);
    // 사람이 댓글로 답하면 답변 필요로 멈춘 AI 구성원 작업을 작업 중으로 되돌린다(챗 글과 같은 신호, WP-377 §4.3).
    if (actor != null && UserKind.HUMAN.equals(actor.kind())) {
      publisher.publishEvent(new IssueHumanReplyPosted(issueId));
    }

    return resp;
  }

  /** 코멘트 수정 (본인만, WP-620) — 프로젝트 OWNER 도 남의 코멘트는 고칠 수 없다(삭제는 가능). */
  public IssueCommentResponse update(
      Long callerId, Long issueId, Long commentId, UpdateCommentRequest req) {
    var mutable = checkCommentMutable(callerId, issueId, commentId, false, "본인 코멘트만 수정할 수 있습니다");
    var issue = mutable.target().issue();
    var project = mutable.target().project();
    commentRepository.update(commentId, req.body());
    // 새 글·이전 글 모두 이미지 참조가 없으면 syncIssueImages 가 추가 쿼리 없이 돌아간다(WP-362).
    bodyImageService.syncIssueImages(
        project, issueId, callerId, mutable.comment().body(), req.body());
    var updated = commentRepository.findById(commentId).orElseThrow();

    // 도메인 이벤트 발행 — create() 와 동일 패턴(#717, SSE 실시간 반영 갭 해소).
    var assignees = assigneeRepository.findByIssue(issueId);
    var actor =
        userRepository
            .findById(callerId)
            .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
            .orElse(null);
    String issueKey = project.key() + "-" + issue.number();
    publisher.publishEvent(
        new IssueCommentUpdatedEvent(
            issueId,
            project.key(),
            issueKey,
            issue.number(),
            issue.title(),
            actor,
            assignees,
            commentId,
            req.body(),
            Instant.now()));

    return updated;
  }

  /** 코멘트 soft-delete (본인 또는 프로젝트 OWNER). */
  public void delete(Long callerId, Long issueId, Long commentId) {
    var mutable = checkCommentMutable(callerId, issueId, commentId, true, DELETE_DENIED);
    var issue = mutable.target().issue();
    var project = mutable.target().project();
    commentRepository.softDelete(commentId);
    // 지운 코멘트에만 있던 이미지는 강등(유예 후 수거) — 본문·다른 코멘트에 남아 있으면 그대로 둔다(WP-362).
    bodyImageService.syncIssueImages(project, issueId, callerId, mutable.comment().body(), null);

    // 도메인 이벤트 발행 — create() 와 동일 패턴(#717, SSE 실시간 반영 갭 해소).
    var assignees = assigneeRepository.findByIssue(issueId);
    var actor =
        userRepository
            .findById(callerId)
            .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
            .orElse(null);
    String issueKey = project.key() + "-" + issue.number();
    publisher.publishEvent(
        new IssueCommentDeletedEvent(
            issueId,
            project.key(),
            issueKey,
            issue.number(),
            issue.title(),
            actor,
            assignees,
            commentId,
            Instant.now()));
  }
}
