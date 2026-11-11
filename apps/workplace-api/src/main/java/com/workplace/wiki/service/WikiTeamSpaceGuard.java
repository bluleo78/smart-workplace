package com.workplace.wiki.service;

import com.workplace.wiki.exception.WikiProjectSpaceConflictException;
import com.workplace.wiki.exception.WikiSpaceNotFoundException;
import com.workplace.wiki.exception.WikiSpaceTypeNotEditableException;
import com.workplace.wiki.repository.WikiSpaceRepository;
import com.workplace.wiki.repository.WikiSpaceRepository.TypeAndLink;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 사람이 노트 공간의 멤버(사람·부서)를 바꾸거나 공간을 지울 수 있는지 가르는 공용 가드 — 사람 멤버({@link WikiSpaceService})와 부서 멤버({@link
 * WikiSpaceMemberGroupService})가 같은 규칙·문구를 쓰게 한 곳에 둔다.
 *
 * <ul>
 *   <li>TEAM 공간만(WP-495, 삭제 포함 WP-1397) — 개인 공간 멤버를 바꾸면 남에게 넘기거나 소유자가 빠져 공간 목록이 영구히 열리지 않는다. 드라이브
 *       공간의 같은 가드(DriveSpaceService.requireTeamSpace)와 같은 규칙.
 *   <li>프로젝트에 이어지지 않은 공간만(WP-1480) — 프로젝트 노트 공간의 멤버는 프로젝트 멤버로 정해지므로 노트 앱에서 바꾸면 다음 맞추기에 덮이거나 프로젝트 밖
 *       사람이 남는다. 409 로 프로젝트 설정을 안내한다.
 * </ul>
 *
 * <p>내부 경로(AGENT 삭제·프로젝트 맞추기·연결)는 이 가드를 거치지 않는다.
 */
@Component
@RequiredArgsConstructor
class WikiTeamSpaceGuard {
  private final WikiSpaceRepository spaces;

  /**
   * 유형과 연결을 공간 행 FOR SHARE 잠금 아래 한 번에 읽어 판정한다 — 연결(link, 같은 행 FOR UPDATE)과 차례가 서서, 판정과 변경 사이에 공간이
   * 프로젝트에 이어지는 틈이 없다(이어진 뒤 맞추기가 이 변경을 보고 정리한다).
   *
   * @throws WikiSpaceNotFoundException 공간 없음(404)
   * @throws WikiSpaceTypeNotEditableException TEAM 이 아님(409)
   * @throws WikiProjectSpaceConflictException 프로젝트 노트 공간(409)
   */
  void requireEditableTeamSpace(long spaceId) {
    TypeAndLink space =
        spaces
            .findTypeAndLinkForShare(spaceId)
            .orElseThrow(() -> new WikiSpaceNotFoundException(spaceId));
    if (!"TEAM".equals(space.type())) {
      throw new WikiSpaceTypeNotEditableException(spaceId, space.type());
    }
    if (space.linkedProjectId() != null) {
      throw WikiProjectSpaceConflictException.memberLocked();
    }
  }
}
