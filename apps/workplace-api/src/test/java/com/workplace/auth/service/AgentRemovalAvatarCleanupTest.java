package com.workplace.auth.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.file.storage.FileStore;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.file.Files;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * WP-1222 — AI 계정을 영구 삭제하면 커밋 뒤 그 아바타 폴더({@code avatars/{userId}/})도 지운다. 기록이 남아 삭제가 savepoint 에서
 * 되돌려지고 사용 중지로 바뀌면(바깥 트랜잭션은 커밋) 아바타는 그대로 둔다 — 살아 있는 AI 의 공개 주소가 깨지면 안 된다.
 *
 * <p>커밋 뒤 동작을 보므로 테스트 트랜잭션 없이 실제로 커밋하고 직접 정리한다.
 */
class AgentRemovalAvatarCleanupTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AgentRemovalService removal;
  @Autowired FileStore fileStore;

  private long admin;
  private long agent;

  @BeforeEach
  void seed() {
    callInTenant(
        1L,
        () -> {
          admin = TestFixtures.createHuman(dsl);
          TestFixtures.addMember(dsl, admin, 1L);
          agent = TestFixtures.createAgentNoToken(dsl);
          TestFixtures.addMember(dsl, agent, 1L);
          return null;
        });
  }

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.OWNER_ID.eq(agent)).execute();
          dsl.deleteFrom(AUDIT_LOG).where(AUDIT_LOG.USER_ID.in(admin, agent)).execute();
          dsl.deleteFrom(USER).where(USER.ID.in(agent, admin)).execute();
        });
    fileStore.deleteTreeIfExists("avatars/" + agent);
  }

  /** 아바타 파일이 있는 것처럼 폴더를 만든다(이미지 처리는 이 테스트의 관심이 아니다). */
  private String seedAvatarDir() {
    String dir = "avatars/" + agent + "/0123456789abcdef0123";
    fileStore.writeAtomically(dir + "/64.jpg", new byte[] {1, 2, 3});
    return dir;
  }

  @Test
  void 완전히_지운_AI_는_커밋_뒤_아바타_폴더도_지운다() {
    String dir = seedAvatarDir();
    assertThat(Files.exists(fileStore.resolve(dir))).isTrue();

    AgentRemovalService.Result result = callInTenant(1L, () -> removal.remove(admin, agent));

    assertThat(result).isEqualTo(AgentRemovalService.Result.DELETED);
    assertThat(Files.exists(fileStore.resolve("avatars/" + agent))).isFalse();
  }

  @Test
  void 기록이_남아_사용_중지로_바뀐_AI_는_아바타를_남긴다() {
    String dir = seedAvatarDir();
    // 기록 — 이 AI 가 주인인 노트 공간(owner_id 가 user 를 NO ACTION 으로 가리켜 삭제를 막는다).
    callInTenant(
        1L,
        () ->
            dsl.insertInto(WIKI_SPACE)
                .set(WIKI_SPACE.TYPE, "TEAM")
                .set(WIKI_SPACE.NAME, "아바타 정리 확인-" + agent)
                .set(WIKI_SPACE.OWNER_ID, agent)
                .set(WIKI_SPACE.TENANT_ID, 1L)
                .execute());

    AgentRemovalService.Result result = callInTenant(1L, () -> removal.remove(admin, agent));

    assertThat(result).isEqualTo(AgentRemovalService.Result.DEACTIVATED);
    assertThat(Files.exists(fileStore.resolve(dir + "/64.jpg"))).isTrue();
  }
}
