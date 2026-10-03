package com.workplace.issue.service;

import com.workplace.file.api.ExpiredFileRetentionPolicy;
import com.workplace.issue.repository.IssueBodyImageRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 만료 스윕이 이슈 본문 이미지를 지우기 직전, 같은 프로젝트의 어느 이슈 본문에든 참조가 남아 있으면 살려 둔다(WP-199).
 *
 * <p>왜: 이미지 URL 에는 원본 이슈 매핑만 있어, 본문을 복사해 다른 이슈에 붙여넣은 이미지는 원본에서 빠지는 순간 강등된다. 스윕에서 한 번 더 확인하면 유예 기간
 * 전체가 안전 창이 된다. 살아 있으면 만료를 유예만큼 미룰 뿐 해제하지 않는다 — 해제하면 다시 만료를 걸 계기가 없어 영구 고아가 된다(위키
 * WikiAttachmentRetentionPolicy 와 같은 이유).
 */
@Component
@RequiredArgsConstructor
public class IssueBodyImageRetentionPolicy implements ExpiredFileRetentionPolicy {

  private final IssueBodyImageRepository repo;

  /** 보존 판정 시 만료를 얼마나 미룰지 — 강등 유예와 같은 값을 쓴다. */
  @Value("${workplace.storage.issue-image.demote-grace-hours:168}")
  private int demoteGraceHours;

  /** 만료 대상 중 비삭제 이슈 본문에 아직 참조가 남은 파일 id 를 돌려주고, 그 파일의 만료를 유예만큼 미룬다. */
  @Override
  public Set<Long> retain(Collection<Long> expiringFileIds) {
    Set<Long> alive = repo.stillReferencedAnywhere(expiringFileIds);
    repo.rearm(alive, OffsetDateTime.now(ZoneOffset.UTC).plusHours(demoteGraceHours));
    return alive;
  }
}
