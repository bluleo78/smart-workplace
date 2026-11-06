package com.workplace.wiki.service;

import com.workplace.drive.api.DriveFileUsage;
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
 *
 * <p>드라이브가 쓰는 file(드라이브로 가져간 노트 첨부, WP-1392)은 판정하지 않는다 — 드라이브 보존
 * 정책(DriveReferencedFileRetentionPolicy)이 남기고 만료를 해제한다. 여기서도 같은 id 에 만료를 다시 걸면 스윕의 정책 순서에 따라 최종
 * 상태(해제/재무장)가 갈리므로 드라이브 몫은 드라이브 정책에만 맡긴다.
 */
@Component
@RequiredArgsConstructor
public class WikiAttachmentRetentionPolicy implements ExpiredFileRetentionPolicy {

  private final WikiAttachmentRepository attachments;

  /** 드라이브가 쓰는 file 판정 — 그 file 은 드라이브 정책 몫이라 여기서는 건너뛴다(WP-1392). */
  private final DriveFileUsage driveFileUsage;

  /** 보존 판정 시 만료를 얼마나 미룰지 — 강등 유예와 같은 값을 쓴다. */
  @Value("${workplace.storage.wiki.demote-grace-hours:168}")
  private int demoteGraceHours;

  @Override
  public Set<Long> retain(Collection<Long> expiringFileIds) {
    // 드라이브가 쓰는 file 은 빼고 판정한다 — 드라이브 정책이 만료를 해제하는 것과 엇갈리지 않게(정책 순서 무관).
    Set<Long> alive =
        attachments.fileIdsStillReferencedAnywhere(
            driveFileUsage.withoutReferenced(expiringFileIds));
    // 승격이 아니라 "만료를 다시 미루기" 다 — 승격시키면 원본을 다시 저장하지 않는 한 재무장 트리거가 없어
    // 어떤 본문도 참조하지 않는 영구 고아가 만들어진다(무제한 증가 경로 부활).
    attachments.rearm(alive, OffsetDateTime.now(ZoneOffset.UTC).plusHours(demoteGraceHours));
    return alive;
  }
}
