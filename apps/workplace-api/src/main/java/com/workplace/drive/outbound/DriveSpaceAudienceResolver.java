package com.workplace.drive.outbound;

import com.workplace.drive.repository.DriveSpaceMemberRepository;
import com.workplace.global.realtime.AudienceResolver;
import java.util.Collection;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * DRIVE_SPACE scope 수신자 = 드라이브 스페이스 실효 멤버 전원 (WP-63) — 직접 멤버와 멤버로 둔 조직도 부서·하위 부서의 활성 사람
 * 구성원(WP-1056). PERSONAL 스페이스는 소유자 1명.
 */
@Component
@RequiredArgsConstructor
public class DriveSpaceAudienceResolver implements AudienceResolver {

  public static final String SCOPE = "DRIVE_SPACE";

  private final DriveSpaceMemberRepository memberRepo;

  @Override
  public String scopeType() {
    return SCOPE;
  }

  @Override
  public Collection<Long> resolve(long spaceId) {
    return memberRepo.audienceUserIds(spaceId);
  }
}
