package com.workplace.mail.repository;

import static com.workplace.jooq.Tables.MAIL_USER_SETTING;

import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 메일 사용자 설정(WP-1744) 저장소 — 테넌트·사용자당 한 행({@code mail_user_setting}). 테넌트는 RLS GUC 와 tenant_id 기본값이
 * 정하므로 여기서는 user_id 로만 거른다(서명 저장소와 같은 방식).
 */
@Repository
@RequiredArgsConstructor
public class MailUserSettingRepository {

  private final DSLContext dsl;

  /** 내 작성 방식 값(행이 없으면 empty). 값은 DB CHECK 가 PANE·DOCK·WINDOW 로 묶는다. */
  public Optional<String> findComposeMode(long userId) {
    return dsl.select(MAIL_USER_SETTING.COMPOSE_MODE)
        .from(MAIL_USER_SETTING)
        .where(MAIL_USER_SETTING.USER_ID.eq(userId))
        .fetchOptional(MAIL_USER_SETTING.COMPOSE_MODE);
  }

  /** 작성 방식을 넣거나 덮어쓴다(테넌트·사용자당 한 행). 덮어쓸 때 updated_at 은 지금으로 바꾼다. */
  public void upsertComposeMode(long userId, String mode) {
    dsl.insertInto(MAIL_USER_SETTING)
        .set(MAIL_USER_SETTING.USER_ID, userId)
        .set(MAIL_USER_SETTING.COMPOSE_MODE, mode)
        .onConflict(MAIL_USER_SETTING.TENANT_ID, MAIL_USER_SETTING.USER_ID)
        .doUpdate()
        .set(MAIL_USER_SETTING.COMPOSE_MODE, mode)
        .set(MAIL_USER_SETTING.UPDATED_AT, DSL.currentOffsetDateTime())
        .execute();
  }
}
