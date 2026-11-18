package com.workplace.chat.service;

import com.workplace.chat.exception.ChatAttachmentNotFoundException;
import com.workplace.chat.repository.ChatThreadRepository;
import com.workplace.chat.repository.IssueStakeholderLookup;
import com.workplace.file.api.StagedCopySource;
import com.workplace.file.api.StagedCopySourceResolver;
import com.workplace.issue.domain.IssueKeys;
import com.workplace.issue.exception.IssueNotFoundException;
import org.springframework.stereotype.Component;

/**
 * 스테이징 복사의 {@code issue_chat} 출처(WP-1705) — 이슈 챗 메시지 첨부를 호출자 소유 임시 파일로 복사할 수 있게 원본 FILE id 를 판정한다.
 *
 * <p>읽기 가드는 다운로드(/content)와 같은 {@link ChatMessageAttachmentService#resolveContentFileId} 를 쓴다 — 스레드
 * 읽기 + 메시지가 이 스레드 소속(아니면 400) + 그 메시지에 붙은 첨부·삭제 안 된 메시지(아니면 404)라, 메시지에서 뺀 첨부나 삭제된 메시지의 첨부가 복사로 새지
 * 않는다(WP-1680). 스레드로 이슈 첨부까지 읽는 /text 가드({@code resolveViewFileId})는 쓰지 않는다 — 이슈 첨부는 source {@code
 * issue} 로 복사한다.
 *
 * <p>존재 은닉: 스레드를 볼 수 없는 사람(프로젝트를 읽을 수 없고 멘션된 AGENT 도 아님)에게는 이슈 없음·스레드 없음·스레드 있음이 모두 같은 「이슈 없음」 404
 * 다 — 이슈를 찾자마자 스레드 조회·첨부 가드보다 먼저 판정해, 볼 수 없는 프로젝트의 이슈 존재나 챗 스레드 유무가 응답 차이로 드러나지 않게 한다.
 */
@Component
public class IssueChatStagedCopySource implements StagedCopySourceResolver {

  /** 출처 키 — 요청의 {@code source} 값. */
  static final String SOURCE = "issue_chat";

  private final IssueStakeholderLookup issueLookup;
  private final ChatThreadRepository threadRepo;
  private final ChatMessageAttachmentService attachmentService;
  private final ChatThreadAccess threadAccess;

  /**
   * 그 메시지에 붙은 첨부가 아닐 때의 404 문구 — read_file 의 issue_chat 은 스레드로 이슈 첨부까지 읽어 주므로, 거기서 본 id 를 그대로 넣은
   * 모델이 다음에 할 일(이슈 첨부는 source issue)을 알 수 있게 한다.
   */
  static final String NOT_MESSAGE_ATTACHMENT =
      "이 메시지에 붙은 첨부가 아닙니다 — issue_chat 은 그 메시지의 첨부만 복사합니다. 이슈 첨부는 source 'issue' 로 복사하세요";

  public IssueChatStagedCopySource(
      IssueStakeholderLookup issueLookup,
      ChatThreadRepository threadRepo,
      ChatMessageAttachmentService attachmentService,
      ChatThreadAccess threadAccess) {
    this.issueLookup = issueLookup;
    this.threadRepo = threadRepo;
    this.attachmentService = attachmentService;
    this.threadAccess = threadAccess;
  }

  @Override
  public String source() {
    return SOURCE;
  }

  /** issueKey·messageId·attachmentId 를 확인하고 챗 첨부 읽기 가드를 거쳐 원본 FILE id 를 돌려준다. */
  @Override
  public long resolveReadableFileId(long callerId, StagedCopySource src) {
    if (src.issueKey() == null || src.messageId() == null || src.attachmentId() == null) {
      throw new IllegalArgumentException(
          "source 'issue_chat' 는 issueKey·messageId·attachmentId 가 필요합니다");
    }
    var key = IssueKeys.parseOrThrow(src.issueKey());
    var issue =
        issueLookup
            .findIssue(key.projectKey(), key.number())
            .orElseThrow(() -> new IssueNotFoundException(key.projectKey(), key.number()));
    // 챗 스레드가 없으면 첨부도 없다 — 복사를 위해 스레드를 새로 만들지 않는다(읽기 전용 경로).
    var threadId = threadRepo.findIdByIssueId(issue.id());
    // 볼 수 없는 사람에겐 이슈 없음과 같은 404 — 스레드 유무·이슈 존재가 드러나지 않게 스레드 없음(404)·가드(403)보다 먼저 본다. 스레드가 있으면
    // 다운로드와 같은 읽기 규칙(프로젝트 읽기 또는 멘션된 AGENT 스레드 멤버), 없으면 프로젝트 읽기 규칙.
    boolean visible =
        threadId.isPresent()
            ? threadAccess.canReadThread(threadId.get(), callerId)
            : threadAccess.canRead(issue.projectId(), callerId);
    if (!visible) {
      throw new IssueNotFoundException(key.projectKey(), key.number());
    }
    if (threadId.isEmpty()) {
      throw new ChatAttachmentNotFoundException(NOT_MESSAGE_ATTACHMENT);
    }
    try {
      return attachmentService.resolveContentFileId(
          callerId, threadId.get(), src.messageId(), src.attachmentId());
    } catch (ChatAttachmentNotFoundException e) {
      // 가드는 그대로(그 메시지에 붙은 첨부만) — 문구만 다음 할 일을 알려 주는 것으로 바꾼다.
      throw new ChatAttachmentNotFoundException(NOT_MESSAGE_ATTACHMENT);
    }
  }
}
