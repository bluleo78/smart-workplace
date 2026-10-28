package com.workplace.drive.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_UPDATED;

import com.workplace.drive.dto.DriveMemberGroupResponse;
import com.workplace.drive.exception.DriveSpaceMemberNotFoundException;
import com.workplace.drive.outbound.DriveChangeNotifier;
import com.workplace.drive.repository.DriveSpaceMemberGroupRepository;
import com.workplace.drive.repository.DriveSpaceMemberRepository;
import com.workplace.user.outbound.DepartmentMembersReduced;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 드라이브 공간 멤버로 둔 조직도 부서(WP-1056) — 부서 자체를 역할과 함께 팀 공간 멤버로 둔다. 그 부서와 하위 부서의 활성 사람 구성원이 그 역할을 받고, 소속은
 * 판정할 때마다 다시 본다({@code DriveSpaceMembership}). 사람의 실효 역할은 직접 멤버 역할과 부서 역할 중 가장 높은 것이다. 노트 스페이스의 같은
 * 기능({@code WikiSpaceMemberGroupService}, WP-1052)을 드라이브에 옮긴 것이다.
 *
 * <p>규칙: 팀 공간에만(개인 공간은 주인 한 명, 채널 공간은 채널 멤버십을 따른다), 조직도 부서(SHARED)만, 역할은 EDITOR·VIEWER 만(멤버 관리 권한
 * OWNER 를 부서 전체에 주지 않는다 — 마지막 소유자 보호도 직접 멤버 행만 본다). 권한은 사람 멤버 API 와 같다(조회는 멤버, 변경은 OWNER).
 *
 * <p>부서로 들어오는 사람이 바뀌면(부서 행 추가·역할 변경·제거, 부서 구성원 감소) 공간 변경 알림을 낸다 — 바뀌기 <b>전</b> 실효 멤버 전원을 추가 수신자로
 * 넘겨, 빠져서 커밋 뒤 명단에 없는 사람의 화면에서도 공간이 사라지게. 드라이브는 동기화 서버 연결이 없어 알림만으로 충분하다.
 */
@Service
@RequiredArgsConstructor
public class DriveSpaceMemberGroupService {
  /** 부서 행이 가질 수 있는 역할 — OWNER 는 받지 않는다. */
  private static final Set<String> GROUP_ROLES = Set.of("EDITOR", "VIEWER");

  private final DriveSpaceMemberRepository members;
  private final DriveSpaceMemberGroupRepository groups;
  private final DrivePermissions perms;
  private final DriveChangeNotifier notifier;

  /** 공간 멤버 부서 목록(이름순, 부서마다 들어오는 사람 수) — 사람 멤버 목록과 같이 멤버면 볼 수 있다. */
  @Transactional(readOnly = true)
  public List<DriveMemberGroupResponse> list(long callerId, long spaceId) {
    perms.requireRole(spaceId, callerId, "VIEWER");
    return groups.list(spaceId);
  }

  /**
   * 조직도 부서를 멤버로 더한다(OWNER). 이미 멤버인 부서면 역할을 덮어쓴다 — 사람 멤버 추가와 같은 업서트 관례.
   *
   * @throws IllegalArgumentException 조직도 부서가 아닌 그룹(개인 그룹·없는 그룹·다른 워크스페이스), OWNER 역할(400)
   * @throws com.workplace.drive.exception.DriveSpaceTypeNotEditableException 팀 공간이 아님(409)
   */
  @Transactional
  public DriveMemberGroupResponse add(long callerId, long spaceId, long groupId, String role) {
    perms.requireRole(spaceId, callerId, "OWNER");
    perms.requireTeamSpace(spaceId);
    validateGroupRole(role);
    // 노트 스페이스 멤버 부서와 같은 검증·문구 — 개인 그룹은 조건으로, 다른 워크스페이스 그룹은 RLS 로 빠진다.
    if (groups.findDepartmentName(groupId).isEmpty()) {
      throw new IllegalArgumentException("조직도 부서만 지정할 수 있습니다");
    }
    // 업서트라 역할을 내릴 수도 있다 — 바뀌기 전 명단을 함께 넘긴다(사람 멤버 변경 알림과 같은 수신 범위).
    List<Long> before = members.audienceUserIds(spaceId);
    groups.upsert(spaceId, groupId, role, callerId);
    notifier.spaceChanged(OP_UPDATED, spaceId, callerId, before);
    return groups.find(spaceId, groupId).orElseThrow(DriveSpaceMemberNotFoundException::new);
  }

  /**
   * 멤버 부서의 역할을 바꾼다(OWNER).
   *
   * @throws DriveSpaceMemberNotFoundException 이 공간의 멤버 부서가 아님(404 — 사람 멤버 역할 변경과 같은 응답)
   */
  @Transactional
  public DriveMemberGroupResponse changeRole(
      long callerId, long spaceId, long groupId, String role) {
    perms.requireRole(spaceId, callerId, "OWNER");
    perms.requireTeamSpace(spaceId);
    validateGroupRole(role);
    // 바뀌기 전 명단을 먼저 모은다 — 행이 없어 404 로 끝나면 트랜잭션째 되돌아간다.
    List<Long> before = members.audienceUserIds(spaceId);
    if (groups.changeRole(spaceId, groupId, role) == 0) {
      throw new DriveSpaceMemberNotFoundException();
    }
    notifier.spaceChanged(OP_UPDATED, spaceId, callerId, before);
    return groups.find(spaceId, groupId).orElseThrow(DriveSpaceMemberNotFoundException::new);
  }

  /**
   * 멤버 부서를 뺀다(OWNER). 빠지기 전 실효 멤버 전원을 변경 알림의 추가 수신자로 넘긴다 — 부서로만 들어와 있던 사람은 커밋 뒤 명단에서 빠지므로 자기 화면에서도
   * 공간이 사라지게.
   *
   * @throws DriveSpaceMemberNotFoundException 이 공간의 멤버 부서가 아님(404)
   */
  @Transactional
  public void remove(long callerId, long spaceId, long groupId) {
    perms.requireRole(spaceId, callerId, "OWNER");
    perms.requireTeamSpace(spaceId);
    List<Long> before = members.audienceUserIds(spaceId);
    if (groups.remove(spaceId, groupId) == 0) {
      throw new DriveSpaceMemberNotFoundException();
    }
    notifier.spaceChanged(OP_UPDATED, spaceId, callerId, before);
  }

  /**
   * 조직도 부서의 구성원이 줄었거나 부서가 사라졌다(WP-1042 이벤트) — 그 부서(이벤트에 상위 부서도 담겨 온다)를 멤버로 둔 공간마다 변경 알림을 낸다. 동기
   * 리스너라 변경 <b>전</b>(같은 트랜잭션)에 돈다: 부서를 지우면 멤버 부서 행이 CASCADE 로 사라지므로 영향받는 공간과 지금 실효 멤버 명단(빠질 사람에게도
   * 알림이 가게)을 여기서 모은다. 알림의 수신자 조회와 전송은 커밋 직전·뒤에 돈다({@code ResourceSseDispatcher}).
   */
  @EventListener
  public void onDepartmentMembersReduced(DepartmentMembersReduced e) {
    // 행위자는 없다 — 부서 변경은 user 모듈에서 왔다.
    for (long spaceId : groups.findSpaceIdsByGroups(e.groupIds())) {
      notifier.spaceChanged(OP_UPDATED, spaceId, null, members.audienceUserIds(spaceId));
    }
  }

  /** 부서 역할 검증 — 모르는 역할은 기존 역할 검증(400), OWNER 는 부서에 주지 않는다(400). */
  private void validateGroupRole(String role) {
    perms.validateRole(role);
    if (!GROUP_ROLES.contains(role)) {
      throw new IllegalArgumentException("부서에는 편집 또는 보기 역할만 줄 수 있습니다");
    }
  }
}
