package com.workplace.wiki.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.service.DriveSpaceService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.exception.WikiForbiddenException;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 워크스페이스가 정해지지 않은(tenant-less) 세션의 노트·드라이브 공간 목록·팀 공간 만들기(WP-804).
 *
 * <p>정지된 구성원의 로그인처럼 멤버십이 없는 토큰은 active 테넌트가 없다. 공간 목록은 개인 공간을 자동으로 만들려다 tenant_id 없이 insert 해 500
 * 「An unexpected error occurred」가 났다. 테넌트가 없으면 만들지 않고 빈 목록으로 답해야 한다 — 같은 토큰의 메시징·알림 목록이 빈 목록인 것과
 * 같게. 팀 공간 만들기도 같은 이유로 500 이 났다 — 만들 워크스페이스가 없으니 한국어 403 으로 거절한다.
 */
@Transactional
class TenantlessSpaceTest extends IntegrationTestBase {

  @Autowired WikiSpaceService wikiSpaceService;
  @Autowired DriveSpaceService driveSpaceService;

  /** 테넌트 없는 세션을 재현하려고 기본 테넌트(1) 주입을 끈다. */
  @Override
  protected Long defaultTenantId() {
    return null;
  }

  /** user 는 RLS 없는 전역 표라 테넌트 없이 시드한다. */
  private long user() {
    String t = UUID.randomUUID().toString().substring(0, 8);
    return baseDsl
        .insertInto(USER)
        .set(USER.USERNAME, "tl_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "TL " + t)
        .set(USER.EMAIL, t + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void 테넌트가_없으면_노트_공간_목록은_만들지_않고_빈_목록() {
    long u = user();
    assertThat(TenantContext.get()).isNull();
    assertThat(wikiSpaceService.listMySpaces(u)).isEmpty();
  }

  @Test
  void 테넌트가_없으면_드라이브_공간_목록은_만들지_않고_빈_목록() {
    long u = user();
    assertThat(TenantContext.get()).isNull();
    assertThat(driveSpaceService.listMySpaces(u)).isEmpty();
  }

  @Test
  void 테넌트가_없으면_노트_팀_공간은_만들지_않고_403() {
    long u = user();
    assertThatThrownBy(() -> wikiSpaceService.createTeamSpace(u, "팀"))
        .isInstanceOf(WikiForbiddenException.class)
        .hasMessage("워크스페이스를 고른 뒤에 노트 공간을 만들 수 있습니다");
  }

  @Test
  void 테넌트가_없으면_드라이브_팀_공간은_만들지_않고_403() {
    long u = user();
    assertThatThrownBy(() -> driveSpaceService.createTeamSpace(u, "팀"))
        .isInstanceOf(DriveForbiddenException.class)
        .hasMessage("워크스페이스를 고른 뒤에 드라이브 공간을 만들 수 있습니다");
  }
}
