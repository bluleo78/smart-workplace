package com.workplace.chat.service;

import com.workplace.chat.exception.ChatThreadNotMemberException;
import com.workplace.issue.dto.IssueAttachmentResponse;
import com.workplace.issue.service.IssueAttachmentService;
import com.workplace.issue.service.IssueAttachmentStorage;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 챗 스레드 경유 이슈 첨부 조회(WP-244).
 *
 * <p>이슈 챗에 멘션된 AGENT 는 대개 역할도 프로젝트 멤버십도 없어 이슈 첨부 API({@code project:read} + 프로젝트 열람 가드)가 403 이다. 기존
 * 이슈 엔드포인트를 느슨하게 하지 않고, 스레드 열람 권한({@link ChatThreadAccess#ensureCanRead} — 스레드 멤버·프로젝트 멤버·OPEN
 * 프로젝트)이 있으면 그 스레드가 딸린 이슈의 첨부만 보이게 한다. 대화에 참여한 사람은 대화가 다루는 이슈의 첨부도 볼 수 있다는 규칙.
 *
 * <p>첨부 조회·추출 상태·저장소 읽기는 issue 모듈 {@link IssueAttachmentService} 의 issueId 기준(권한 판정 없는) 메서드를 그대로 쓴다
 * — 권한 판정은 이 서비스가 먼저 한다.
 */
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class ChatIssueAttachmentService {

  private final ChatThreadAccess threadAccess;
  private final ChatThreadContextResolver contextResolver;
  private final IssueAttachmentService issueAttachments;

  /** 스레드가 딸린 이슈의 첨부 목록(추출 상태 포함). 스레드 열람 권한 없으면 403. */
  public List<IssueAttachmentResponse> list(long callerId, long threadId) {
    threadAccess.ensureCanRead(threadId, callerId);
    return issueAttachments.listByIssueId(issueIdOf(threadId, callerId));
  }

  /** 스레드가 딸린 이슈의 첨부 다운로드. 스레드 열람 권한 없으면 403, 그 이슈의 첨부가 아니면 404. */
  public IssueAttachmentStorage.StoredFile download(long callerId, long threadId, long fileId) {
    threadAccess.ensureCanRead(threadId, callerId);
    return issueAttachments.downloadByIssueId(issueIdOf(threadId, callerId), fileId);
  }

  /**
   * fileId 가 이 스레드가 딸린 이슈의 첨부인지. <b>권한 판정 없음</b> — 호출자({@link
   * ChatMessageAttachmentService#readText})가 스레드 열람 권한을 먼저 확인한다. 스레드 텍스트 읽기 경로가 챗 첨부와 이슈 첨부를 한 경로로
   * 받게 하는 용도.
   */
  boolean isIssueAttachment(long threadId, long fileId) {
    var ctx = contextResolver.resolve(threadId);
    return ctx != null && issueAttachments.isAttachedToIssue(ctx.issueId(), fileId);
  }

  /** 스레드 → 이슈 id. 스레드(또는 이슈)가 없으면 ensureCanRead 와 같은 403 으로 통일한다. */
  private long issueIdOf(long threadId, long callerId) {
    var ctx = contextResolver.resolve(threadId);
    if (ctx == null) {
      throw new ChatThreadNotMemberException(threadId, callerId);
    }
    return ctx.issueId();
  }
}
