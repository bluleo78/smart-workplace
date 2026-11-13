package com.workplace.drive.service;

import com.workplace.drive.dto.SharedWithMeItemResponse;
import com.workplace.drive.repository.DriveShareLinkVisitRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 「공유받은 항목」(WP-1539) — 내가 연 사내 공유 링크 목록과 「목록에서 빼기」. 기록은 공유 정보 조회({@link
 * DriveShareLinkService#info})가 남긴다. 목록 행은 권한을 주지 않는다 — 여는 것은 늘 링크 토큰으로 공개 공유 경로의 링크 가드를 거친다.
 */
@Service
@RequiredArgsConstructor
public class DriveSharedWithMeService {
  private final DriveShareLinkVisitRepository visits;
  private final ShareLinkTokenCodec tokenCodec;

  /**
   * 내 목록(마지막으로 연 순). 지금 그 공간 구성원이면 빠진다(저장소가 읽을 때 판정). 토큰은 열 수 있는 행만 되살린다 — 이 사람이 연 순간의 암호문을 먼저, 없으면
   * 링크의 암호문(WP-1528)을 쓴다. 열 수 없는 링크의 토큰은 풀지 않는다(불필요한 평문 노출을 줄인다).
   */
  @Transactional(readOnly = true)
  public List<SharedWithMeItemResponse> list(long userId) {
    return visits.listForUser(userId).stream().map(this::toResponse).toList();
  }

  /** 「목록에서 빼기」 — 내 행만 숨긴다. 링크 권한은 그대로이고, 같은 링크를 다시 열면 목록에 돌아온다. 내 행이 없어도 조용히 끝난다(멱등). */
  @Transactional
  public void hide(long userId, long shareLinkId) {
    visits.hide(userId, shareLinkId);
  }

  /** 저장소 한 줄 → 응답. */
  private SharedWithMeItemResponse toResponse(DriveShareLinkVisitRepository.VisitRow r) {
    String token = r.openable() ? restoreToken(r) : null;
    return new SharedWithMeItemResponse(
        r.shareLinkId(),
        "FILE",
        r.fileName(),
        r.mimeType(),
        r.sizeBytes(),
        spaceName(r),
        r.sharedByName(),
        r.lastOpenedAt(),
        r.openable(),
        r.hasPassword(),
        token);
  }

  /** 연 순간의 토큰 암호문 → 링크 암호문 순으로 되살린다. 둘 다 안 되면 null(열기·복사를 막는다). */
  private String restoreToken(DriveShareLinkVisitRepository.VisitRow r) {
    String token = tokenCodec.restore(r.visitTokenEncrypted(), r.tokenHash(), r.shareLinkId());
    return token != null
        ? token
        : tokenCodec.restore(r.linkTokenEncrypted(), r.tokenHash(), r.shareLinkId());
  }

  /**
   * 공간 이름 — 개인 공간은 저장된 이름이 누구에게나 「내 드라이브」라 남이 보면 헷갈린다. 「{주인}의 드라이브」로 바꾸고, 주인을 찾을 수 없으면 「개인 드라이브」.
   */
  private static String spaceName(DriveShareLinkVisitRepository.VisitRow r) {
    if (!"PERSONAL".equals(r.spaceType())) {
      return r.spaceName();
    }
    return r.spaceOwnerName() != null ? r.spaceOwnerName() + "의 드라이브" : "개인 드라이브";
  }
}
