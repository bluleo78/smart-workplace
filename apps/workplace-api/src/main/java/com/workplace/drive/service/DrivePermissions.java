package com.workplace.drive.service;

import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.exception.DriveInvalidRoleException;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.drive.repository.DriveSpaceMemberRepository;
import com.workplace.drive.repository.DriveSpaceRepository;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** 공간 역할 검증. drive_space_member + drive_space(archived 확인) 사용. */
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
    String role =
        members
            .findRole(spaceId, userId)
            .orElseThrow(() -> new DriveSpaceNotFoundException(spaceId));
    if (RANK.get(role) < RANK.get(minRole)) {
      throw new DriveForbiddenException(spaceId, userId);
    }
    // 보관된 공간은 읽기전용 — 쓰기 역할(EDITOR 이상=RANK>VIEWER) 요구 시 차단.
    if (RANK.get(minRole) > RANK.get("VIEWER") && spaces.isArchived(spaceId)) {
      throw new DriveForbiddenException(spaceId, userId);
    }
    return role;
  }
}
