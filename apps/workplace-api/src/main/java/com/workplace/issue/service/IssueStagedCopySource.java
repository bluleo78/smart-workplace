package com.workplace.issue.service;

import com.workplace.file.api.StagedCopySource;
import com.workplace.file.api.StagedCopySourceResolver;
import com.workplace.issue.domain.IssueKeys;
import org.springframework.stereotype.Component;

/**
 * 스테이징 복사의 {@code issue} 출처(WP-1705) — 이슈 첨부와 본문·댓글 이미지를 호출자 소유 임시 파일로 복사할 수 있게 원본 FILE id 를 판정한다.
 *
 * <p>읽기 가드는 새로 만들지 않고 {@link IssueAttachmentService#resolveViewFileId} 를 그대로 쓴다 — 첨부 {@code
 * /text}·{@code /view} 와 같은 가드(프로젝트 읽기 + 그 이슈의 첨부 또는 그 프로젝트 이슈에 연결된 본문·댓글 이미지)라 권한 규칙이 어긋나지 않는다.
 * 복사본은 호출자 소유의 새 FILE 이므로 다른 프로젝트 댓글에 넣어도 그 프로젝트 권한만으로 보인다.
 */
@Component
public class IssueStagedCopySource implements StagedCopySourceResolver {

  /** 출처 키 — 요청의 {@code source} 값. */
  static final String SOURCE = "issue";

  private final IssueAttachmentService attachmentService;

  public IssueStagedCopySource(IssueAttachmentService attachmentService) {
    this.attachmentService = attachmentService;
  }

  @Override
  public String source() {
    return SOURCE;
  }

  /** issueKey·attachmentId 를 확인하고 이슈 읽기 가드를 거쳐 원본 FILE id 를 돌려준다. */
  @Override
  public long resolveReadableFileId(long callerId, StagedCopySource src) {
    if (src.issueKey() == null || src.attachmentId() == null) {
      throw new IllegalArgumentException("source 'issue' 는 issueKey·attachmentId 가 필요합니다");
    }
    var key = IssueKeys.parseOrThrow(src.issueKey());
    return attachmentService.resolveViewFileId(
        callerId, key.projectKey(), key.number(), src.attachmentId());
  }
}
