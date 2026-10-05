package com.workplace.chat.service;

import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.chat.repository.ChatThreadMemberRepository;
import com.workplace.chat.repository.IssueStakeholderLookup;
import com.workplace.issue.dto.IssueAttachmentResponse;
import com.workplace.issue.service.IssueAttachmentService;
import com.workplace.issue.service.IssueAttachmentStorage;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 챗 스레드 경유 이슈 첨부 조회(WP-244).
 *
 * <p>이슈 챗에 멘션된 AGENT 는 대개 역할도 프로젝트 멤버십도 없어 이슈 첨부 API({@code project:read} + 프로젝트 열람 가드)가 403 이다. 기존
 * 이슈 엔드포인트를 느슨하게 하지 않고, 스레드 경유로 그 스레드가 딸린 이슈의 첨부만 보이게 한다. 허용 규칙({@link
 * #ensureCanReadIssueAttachments}):
 *
 * <ul>
 *   <li>이슈 첨부 API 와 같은 프로젝트 조회 규칙({@link ProjectAccessGuard#canRead} — 멤버·OPEN·ADMIN), 또는
 *   <li>이 스레드의 멤버인 AGENT(멘션돼 대화에 추가된 에이전트).
 * </ul>
 *
 * <p>사람 스레드 멤버에게 스레드 멤버십만으로 열어 주지 않는다 — 스레드 멤버십은 추가만 되고 프로젝트에서 빠져도 정리되지 않으므로, 프로젝트에서 제외된 사람이 이슈 첨부를
 * 계속 보는 일이 생긴다. 챗 메시지 첨부는 기존 {@link ChatThreadAccess} 규칙 그대로다.
 *
 * <p>첨부 조회·추출 상태·저장소 읽기는 issue 모듈 {@link IssueAttachmentService} 의 issueId 기준(권한 판정 없는) 메서드를 그대로 쓴다
 * — 권한 판정은 이 서비스가 먼저 한다.
 */
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class ChatIssueAttachmentService {

  private final ChatThreadMemberRepository memberRepo;
  private final ChatThreadContextResolver contextResolver;
  private final IssueStakeholderLookup lookup;
  private final ProjectAccessGuard accessGuard;
  private final IssueAttachmentService issueAttachments;

  /** 스레드가 딸린 이슈의 첨부 목록(추출 상태 포함). 권한 없으면 403. */
  public List<IssueAttachmentResponse> list(long callerId, long threadId) {
    return issueAttachments.listByIssueId(ensureCanReadIssueAttachments(threadId, callerId));
  }

  /** 스레드가 딸린 이슈의 첨부 다운로드. 권한 없으면 403, 그 이슈의 첨부가 아니면 404. */
  public IssueAttachmentStorage.StoredFile download(long callerId, long threadId, long fileId) {
    return issueAttachments.downloadByIssueId(
        ensureCanReadIssueAttachments(threadId, callerId), fileId);
  }

  /**
   * 스레드 경유 이슈 첨부 열람 권한 확인 — 프로젝트 조회 가능자 또는 이 스레드 멤버인 AGENT. 없으면 ChatThreadNotMemberException(403).
   *
   * @return 스레드가 딸린 이슈 id
   */
  public long ensureCanReadIssueAttachments(long threadId, long callerId) {
    var ctx = contextResolver.resolve(threadId);
    if (ctx == null) {
      throw new ChatThreadNotMemberException(threadId, callerId);
    }
    boolean allowed =
        accessGuard.canRead(ctx.projectId(), callerId)
            || (memberRepo.isMember(threadId, callerId) && lookup.isAgentUser(callerId));
    if (!allowed) {
      throw new ChatThreadNotMemberException(threadId, callerId);
    }
    return ctx.issueId();
  }

  /**
   * fileId 가 이 스레드가 딸린 이슈의 첨부인지. <b>권한 판정 없음</b> — 호출자({@link
   * ChatMessageAttachmentService#readText})가 참이면 {@link #ensureCanReadIssueAttachments} 로 판정한다. 스레드
   * 텍스트 읽기 경로가 챗 첨부와 이슈 첨부를 한 경로로 받게 하는 용도.
   */
  public boolean isIssueAttachment(long threadId, long fileId) {
    var ctx = contextResolver.resolve(threadId);
    return ctx != null && issueAttachments.isAttachedToIssue(ctx.issueId(), fileId);
  }
}
