package com.workplace.wiki.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiSpaceResponse;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 노트를 여는 조회(get/read)는 마지막 수정자 이름을 채운다(WP-1483 노트 머리 「AI 작성 · {이름} 수정」 표지). */
@Transactional
class WikiPageDetailUpdatedByNameTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** get·read 모두 updatedBy 사용자의 표시 이름을 updatedByName 에 담는다(수정자가 없는 새 페이지는 null). */
  @Test
  void get_fillsUpdatedByName() {
    long u = seedUser("양동희");
    WikiSpaceResponse sp = spaceService.ensurePersonalSpace(u);
    WikiPageDetail page = pageService.create(u, sp.id(), new CreatePageRequest(null, "페이지"));
    // 새 페이지는 수정자가 없다 — 한 번 고쳐 updated_by 를 남긴다.
    pageService.save(u, page.id(), new SavePageRequest(null, "본문", page.version(), false));

    assertThat(pageService.get(u, page.id()).updatedByName()).isEqualTo("양동희");
    WikiPageDetail fresh = pageService.create(u, sp.id(), new CreatePageRequest(null, "새 페이지"));
    assertThat(pageService.get(u, fresh.id()).updatedByName()).isNull();
    assertThat(pageService.read(u, page.id(), true).updatedByName()).isEqualTo("양동희");
    assertThat(pageService.read(u, page.id(), false).updatedByName()).isEqualTo("양동희");
  }

  private long seedUser(String name) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "wp_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, name)
        .set(USER.EMAIL, "wp_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }
}
