package com.workplace.drive.service;

import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.exception.DriveInvalidRoleException;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.drive.exception.DriveSpaceTypeNotEditableException;
import com.workplace.drive.repository.DriveSpaceMemberRepository;
import com.workplace.drive.repository.DriveSpaceRepository;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 공간 역할 검증. 실효 역할(직접 멤버 행 drive_space_member 와 멤버로 둔 조직도 부서 행 drive_space_member_group 중 가장 높은 것,
 * WP-1056) + drive_space(archived 확인) 사용.
 */
@Component
@RequiredArgsConstructor
public class DrivePermissions {
  private final DriveSpaceMemberRepository members;

  /** archived 여부 확인용 공간 저장소. */
  private final DriveSpaceRepository spaces;

  private static final Map<String, Integer> RANK = Map.of("VIEWER", 1, "EDITOR", 2, "OWNER", 3);

  /** 유효 역할 검증(요청 DTO 검증용). */
  public void validateRole(String role) {
    if (!RANK.containsKey(role)) {
      throw new DriveInvalidRoleException(role);
    }
  }

  /**
   * 호출자가 공간 멤버이고 최소 역할 이상인지 검증. 멤버가 아니면 NotFound(존재 은닉), 멤버지만 역할 미달이면 Forbidden.
   *
   * @return 호출자의 실제 역할
   */
  public String requireRole(long spaceId, long userId, String minRole) {
    String role = requireRoleEvenIfArchived(spaceId, userId, minRole);
    // 보관된 공간은 읽기전용 — 쓰기 역할(EDITOR 이상=RANK>VIEWER) 요구 시 차단.
    if (RANK.get(minRole) > RANK.get("VIEWER") && spaces.isArchived(spaceId)) {
      throw new DriveForbiddenException(spaceId, userId);
    }
    return role;
  }

  /**
   * 보관 여부와 상관없이 역할만 검증. 공간 내용을 바꾸지 않고 바깥 노출을 줄이는 작업(공유 링크 목록·폐기)용 — 보관 공간이어도 이미 나간 링크는 끊을 수 있어야
   * 한다(WP-526).
   *
   * @return 호출자의 실제 역할
   */
  public String requireRoleEvenIfArchived(long spaceId, long userId, String minRole) {
    String role =
        members
            .findRole(spaceId, userId)
            .orElseThrow(() -> new DriveSpaceNotFoundException(spaceId));
    if (RANK.get(role) < RANK.get(minRole)) {
      throw new DriveForbiddenException(spaceId, userId);
    }
    return role;
  }

  /**
   * TEAM 공간이 아니면 거부(409) — PERSONAL("내 드라이브")/CHANNEL(채널 소유) 보호. rename·delete·사람 멤버 변경·부서 멤버
   * 변경(WP-1056)이 공유하는 단일 타입 가드. 개인 공간 멤버를 바꾸면 남에게 넘기거나 소유자가 빠져 영구히 열리지 않고, 채널 공간 멤버는 채널 멤버십을
   * 따른다(WP-495).
   */
  public void requireTeamSpace(long spaceId) {
    String type =
        spaces.findType(spaceId).orElseThrow(() -> new DriveSpaceNotFoundException(spaceId));
    if (!"TEAM".equals(type)) {
      throw new DriveSpaceTypeNotEditableException(spaceId, type);
    }
  }
}
