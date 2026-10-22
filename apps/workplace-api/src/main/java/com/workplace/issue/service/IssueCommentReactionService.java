package com.workplace.issue.service;

import com.workplace.global.util.ReactionEmojis;
import com.workplace.issue.dto.CommentReactorPage;
import com.workplace.issue.dto.CommentReactorResponse;
import com.workplace.issue.dto.IssueCommentResponse;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.exception.IssueCommentNotFoundException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCommentReactionsChangedEvent;
import com.workplace.issue.repository.IssueCommentReactionRepository;
import com.workplace.issue.repository.IssueCommentReactionRepository.Cursor;
import com.workplace.issue.repository.IssueCommentReactionRepository.ReactorRow;
import com.workplace.issue.repository.IssueCommentRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 코멘트 이모지 반응(WP-504). 채팅 ReactionService 와 같은 규칙(이모지 하나·멱등·1인 20개·종류 50종)을 이슈 권한에 맞춘다 — 추가·취소는
 * 코멘트 작성 권한(assertContentWritable), 반응자 조회는 이슈 읽기 권한. 반응은 알림을 만들지 않고 watcher 로 등록하지도 않으며, 실제로 바뀌었을
 * 때만 실시간 재조회 이벤트를 낸다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueCommentReactionService {

  /** 한 사람이 코멘트 하나에 달 수 있는 반응 수 — 채팅(ReactionService)과 같다. */
  static final int MAX_REACTIONS_PER_USER = 20;

  /** 코멘트 하나에 달릴 수 있는 서로 다른 이모지 수 — 채팅과 같은 50종. */
  static final int MAX_DISTINCT_EMOJIS = 50;

  /** 반응자 목록 한 번에 내려주는 최대 수. */
  private static final int MAX_REACTOR_LIMIT = 50;

  private final IssueCommentReactionRepository reactionRepository;
  private final IssueCommentRepository commentRepository;
  private final IssueRepository issueRepository;
  private final ProjectRepository projectRepository;
  private final ProjectAccessGuard accessGuard;
  private final ApplicationEventPublisher publisher;

  /**
   * 반응 추가(멱등 — 이미 단 반응이면 아무것도 하지 않는다). 순서는 채팅과 같다: 볼 수 있는 이슈의 살아 있는 코멘트인지(아니면 404) → 쓸 수 있는지(403) →
   * 이모지 하나인지(400) → 이미 있으면 끝 → 상한(400). 권한을 먼저 보는 것은 볼 수 없는 코멘트에 400 을 먼저 주면 존재가 드러나기 때문이다.
   */
  public void add(long callerId, long issueId, long commentId, String emoji) {
    var target = requireWritableComment(callerId, issueId, commentId);
    if (!ReactionEmojis.isSingleEmoji(emoji)) {
      throw new IllegalArgumentException("반응에는 이모지 하나만 쓸 수 있습니다");
    }
    // 이미 단 반응을 다시 누르는 요청은 상한과 무관하게 통과(아무것도 늘지 않는다).
    if (reactionRepository.exists(commentId, callerId, emoji)) return;
    if (reactionRepository.countByUser(commentId, callerId) >= MAX_REACTIONS_PER_USER) {
      throw new IllegalArgumentException("한 코멘트에 반응은 " + MAX_REACTIONS_PER_USER + "개까지 달 수 있습니다");
    }
    if (!reactionRepository.hasEmoji(commentId, emoji)
        && reactionRepository.countDistinctEmojis(commentId) >= MAX_DISTINCT_EMOJIS) {
      throw new IllegalArgumentException(
          "한 코멘트에는 이모지를 " + MAX_DISTINCT_EMOJIS + "종까지 달 수 있습니다 — 이미 달린 이모지를 눌러 주세요");
    }
    // 동시 요청으로 그 사이 같은 반응이 들어갔으면 add 가 false — 바뀐 것이 없으니 이벤트도 내지 않는다.
    if (reactionRepository.add(commentId, callerId, emoji))
      publishChanged(target, commentId, callerId);
  }

  /** 반응 취소(멱등 — 없으면 이벤트 없음). 이모지 검사는 하지 않는다 — 이 규칙 전에 붙은 값도 본인이 뗄 수 있게(채팅과 같다). */
  public void remove(long callerId, long issueId, long commentId, String emoji) {
    var target = requireWritableComment(callerId, issueId, commentId);
    if (reactionRepository.remove(commentId, callerId, emoji))
      publishChanged(target, commentId, callerId);
  }

  /**
   * 코멘트의 이모지별 반응자 페이지. 코멘트 목록과 같은 읽기 권한(OPEN 은 읽기만 가능한 사람도 본다). 목록에는 개수만 싣고 반응자는 호버·전체 보기 때 이 API 로
   * 필요한 만큼만 받는다(채팅 WP-106 과 같은 지연 로딩). limit 은 1~50 으로 맞춘다.
   */
  @Transactional(readOnly = true)
  public CommentReactorPage listReactors(
      long callerId, long issueId, long commentId, String emoji, String cursor, int limit) {
    requireReadableComment(callerId, issueId, commentId);
    int size = Math.clamp(limit, 1, MAX_REACTOR_LIMIT);
    Cursor after = cursor == null || cursor.isBlank() ? null : Cursor.decode(cursor);
    List<ReactorRow> rows = reactionRepository.findReactors(commentId, emoji, after, size);
    boolean hasMore = rows.size() > size;
    List<ReactorRow> pageRows = hasMore ? rows.subList(0, size) : rows;
    // 다음 페이지가 있을 때만(=이 페이지가 비어 있지 않을 때만) 꼬리로 커서를 만든다.
    String next = null;
    if (hasMore) {
      ReactorRow last = pageRows.getLast();
      next = new Cursor(last.reactedAt(), last.userId()).encode();
    }
    return new CommentReactorPage(
        pageRows.stream()
            .map(r -> new CommentReactorResponse(r.userId(), r.name(), r.kind()))
            .toList(),
        next,
        hasMore);
  }

  /**
   * 코멘트 목록에 반응 집계를 채운다 — 집계 쿼리 한 번(N+1 없음). reacted 는 callerId 기준이라 보는 사람마다 다르다. 권한은 목록을 만든 호출부(이슈
   * 상세·코멘트 목록)가 이미 확인했다.
   */
  @Transactional(readOnly = true)
  public List<IssueCommentResponse> enrich(List<IssueCommentResponse> comments, long callerId) {
    if (comments.isEmpty()) return comments;
    var byComment =
        reactionRepository.summariesFor(
            comments.stream().map(IssueCommentResponse::id).toList(), callerId);
    return comments.stream()
        .map(c -> c.withReactions(byComment.getOrDefault(c.id(), List.of())))
        .toList();
  }

  /** 반응이 바뀌었음을 알린다 — IssueSseDispatcher 가 커밋 뒤 watcher 에게 보낸다. */
  private void publishChanged(Target target, long commentId, long actorId) {
    String projectKey = target.project().key();
    int number = target.issue().number();
    publisher.publishEvent(
        new IssueCommentReactionsChangedEvent(
            target.issue().id(),
            projectKey + "-" + number,
            projectKey,
            number,
            commentId,
            actorId));
  }

  /** 볼 수 있는 이슈의 살아 있는 코멘트 + 이 이슈에 글을 쓸 수 있는 사람(멤버/ADMIN 또는 OPEN reporter 본인)인지. 아니면 403. */
  private Target requireWritableComment(long callerId, long issueId, long commentId) {
    var target = requireReadableComment(callerId, issueId, commentId);
    accessGuard.assertContentWritable(target.project(), target.issue().reporterId(), callerId);
    return target;
  }

  /**
   * 이슈 → 프로젝트 → 읽기 권한 → 코멘트 소속 순으로 확인한다. IssueCommentService 의 assertIssueReadable 과 같은 규칙: 볼 수 없는
   * 프로젝트·지워진 프로젝트의 이슈는 없는 이슈와 같은 404(WP-588), 다른 이슈의 코멘트·지워진 코멘트는 없는 코멘트와 같은 404(#856 — 경로의 issueId
   * 로 권한을 본 뒤 남의 코멘트 id 를 붙이는 우회를 막는다).
   */
  private Target requireReadableComment(long callerId, long issueId, long commentId) {
    var issue = issueRepository.findById(issueId).orElseThrow(IssueNotFoundException::new);
    var project =
        projectRepository.findById(issue.projectId()).orElseThrow(IssueNotFoundException::new);
    if (!accessGuard.canRead(project.id(), callerId)) throw new IssueNotFoundException();
    commentRepository
        .findById(commentId)
        .filter(c -> c.issueId().equals(issueId))
        .orElseThrow(() -> new IssueCommentNotFoundException(commentId));
    return new Target(issue, project);
  }

  /** 반응 대상 코멘트가 속한 이슈·프로젝트 — 권한 판정과 이벤트 페이로드에 함께 쓴다. */
  private record Target(IssueRow issue, ProjectRow project) {}
}
