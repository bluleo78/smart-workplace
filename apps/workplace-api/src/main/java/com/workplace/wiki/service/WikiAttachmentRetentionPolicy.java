package com.workplace.wiki.service;

import com.workplace.file.api.ExpiredFileRetentionPolicy;
import com.workplace.wiki.repository.WikiAttachmentRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * #759 만료 스윕이 노트 첨부를 지우기 직전, 어느 페이지 본문에든 참조가 살아 있으면 살려둔다.
 *
 * <p>왜: 첨부 URL 에는 <b>원본 pageId</b> 가 박혀 있어, 다른 페이지에 붙여넣은 이미지도 원본 페이지의 매핑을 통해 서빙된다. 강등 판정은 원본 페이지의
 * 본문만 보고 내리므로, 복사본이 살아 있어도 원본에서 참조가 빠지면 유예 후 삭제 대상이 된다. 요청 경로가 아니라 스윕에서 한 번 더 확인하면 유예 기간 전체가 안전 창이
 * 된다.
 *
 * <p>살아 있다고 판단하면 만료를 유예만큼 다시 미룬다 — 해제(승격)가 아니다. 자세한 이유는 {@code rearm} Javadoc.
 */
@Component
@RequiredArgsConstructor
public class WikiAttachmentRetentionPolicy implements ExpiredFileRetentionPolicy {

  private final WikiAttachmentRepository attachments;

  /** 보존 판정 시 만료를 얼마나 미룰지 — 강등 유예와 같은 값을 쓴다. */
  @Value("${workplace.storage.wiki.demote-grace-hours:168}")
  private int demoteGraceHours;

  @Override
  public Set<Long> retain(Collection<Long> expiringFileIds) {
    Set<Long> alive = attachments.fileIdsStillReferencedAnywhere(expiringFileIds);
    // 승격이 아니라 "만료를 다시 미루기" 다 — 승격시키면 원본을 다시 저장하지 않는 한 재무장 트리거가 없어
    // 어떤 본문도 참조하지 않는 영구 고아가 만들어진다(무제한 증가 경로 부활).
    attachments.rearm(alive, OffsetDateTime.now(ZoneOffset.UTC).plusHours(demoteGraceHours));
    return alive;
  }
}
