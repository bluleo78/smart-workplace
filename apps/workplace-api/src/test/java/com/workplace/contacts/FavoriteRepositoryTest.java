package com.workplace.contacts;

import static com.workplace.jooq.Tables.CONTACT_FAVORITE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.contacts.repository.FavoriteRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 즐겨찾기 쓰기 경로 — 멱등 add/remove. tenant_id 는 GUC DEFAULT(test=1) 자동 충전. */
@Transactional
class FavoriteRepositoryTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired FavoriteRepository repo;

  /** 즐겨찾기 owner 로 쓸 HUMAN 유저 시드. */
  private long caller() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "f_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Fav " + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private long countFav(long owner, String type, long targetId) {
    return dsl.fetchCount(
        CONTACT_FAVORITE,
        CONTACT_FAVORITE
            .OWNER_ID
            .eq(owner)
            .and(CONTACT_FAVORITE.TARGET_TYPE.eq(type))
            .and(CONTACT_FAVORITE.TARGET_ID.eq(targetId)));
  }

  @Test
  void add_isIdempotent() {
    long c = caller();
    repo.add(c, "MEMBER", 999L);
    repo.add(c, "MEMBER", 999L); // 중복 호출 — 충돌 무시
    assertThat(countFav(c, "MEMBER", 999L)).isEqualTo(1);
  }

  @Test
  void remove_deletesAndIsIdempotentWhenAbsent() {
    long c = caller();
    repo.add(c, "EXTERNAL", 555L);
    repo.remove(c, "EXTERNAL", 555L);
    assertThat(countFav(c, "EXTERNAL", 555L)).isEqualTo(0);
    repo.remove(c, "EXTERNAL", 555L); // 부재 호출 — 예외 없음
    assertThat(countFav(c, "EXTERNAL", 555L)).isEqualTo(0);
  }
}
