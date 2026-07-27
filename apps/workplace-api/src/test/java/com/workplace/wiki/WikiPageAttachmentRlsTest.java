package com.workplace.wiki;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_PAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * V126 wiki_page_attachment RLS 격리 증명: file 테이블 자체는 RLS 를 가지지만(V53), 노트 이미지 첨부는 이 매핑 테이블의
 * tenant_id/RLS 로 "어떤 페이지에 첨부됐는지"의 테넌트 경계를 별도로 보장해야 한다. WikiRlsTest 와 동일하게 롤백되는 단일 트랜잭션 안에서 raw
 * jOOQ 로 정책(USING/WITH CHECK)을 직접 검증한다 — 공유 DB 무오염.
 */
class WikiPageAttachmentRlsTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  @Test
  void wikiPageAttachment_createdInTenant1_isInvisibleInTenant2() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              // 신규 테넌트(tid2) — 같은 트랜잭션 내 FK 대상(미커밋)
              Long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, "rls-wiki-attach-" + System.nanoTime())
                      .set(TENANT.NAME, "RLS-WIKI-ATTACH")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              // wiki_space.owner_id / file.uploaded_by / wiki_page_attachment.attached_by 용 임시 user
              String suffix = String.valueOf(System.nanoTime() % 1_000_000);
              Long userId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "rls-wiki-attach-" + suffix)
                      .set(USER.NAME, "RLS Wiki Attach Owner")
                      .set(USER.EMAIL, "rls-wiki-attach-" + suffix + "@example.com")
                      .set(USER.KIND, "HUMAN")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();

              // tenant#1 컨텍스트에서 공간/페이지/파일/첨부 매핑을 순서대로 삽입
              setGuc(1L);
              Long spaceId =
                  dsl.insertInto(WIKI_SPACE)
                      .set(WIKI_SPACE.TYPE, "TEAM")
                      .set(WIKI_SPACE.NAME, "T1 첨부 공간")
                      .set(WIKI_SPACE.OWNER_ID, userId)
                      .set(WIKI_SPACE.TENANT_ID, 1L)
                      .returning(WIKI_SPACE.ID)
                      .fetchOne()
                      .getId();
              Long pageId =
                  dsl.insertInto(WIKI_PAGE)
                      .set(WIKI_PAGE.SPACE_ID, spaceId)
                      .set(WIKI_PAGE.TITLE, "T1 첨부 페이지")
                      .set(WIKI_PAGE.TENANT_ID, 1L)
                      .returning(WIKI_PAGE.ID)
                      .fetchOne()
                      .getId();
              Long fileId =
                  dsl.insertInto(FILE)
                      .set(FILE.ORIGINAL_NAME, "image.png")
                      .set(FILE.STORED_NAME, "stored-" + suffix + ".png")
                      .set(FILE.MIME_TYPE, "image/png")
                      .set(FILE.SIZE_BYTES, 1024L)
                      .set(FILE.STORAGE_PATH, "tenant-1/wiki/stored-" + suffix + ".png")
                      .set(FILE.UPLOADED_BY, userId)
                      .set(FILE.TENANT_ID, 1L)
                      .returning(FILE.ID)
                      .fetchOne()
                      .getId();
              // tenant_id 를 명시하지 않고 삽입 — DEFAULT 로 현재 GUC 테넌트(1L)가 채워지는지 확인
              dsl.insertInto(WIKI_PAGE_ATTACHMENT)
                  .set(WIKI_PAGE_ATTACHMENT.FILE_ID, fileId)
                  .set(WIKI_PAGE_ATTACHMENT.PAGE_ID, pageId)
                  .set(WIKI_PAGE_ATTACHMENT.ATTACHED_BY, userId)
                  .execute();

              // tenant#1 컨텍스트에서는 가시 (양성 대조 — 행이 실제로 삽입됐고 DEFAULT 로 tenant_id=1 이 채워짐)
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(WIKI_PAGE_ATTACHMENT)
                              .where(WIKI_PAGE_ATTACHMENT.FILE_ID.eq(fileId))))
                  .isEqualTo(1);
              assertThat(
                      dsl.select(WIKI_PAGE_ATTACHMENT.TENANT_ID)
                          .from(WIKI_PAGE_ATTACHMENT)
                          .where(WIKI_PAGE_ATTACHMENT.FILE_ID.eq(fileId))
                          .fetchOne(WIKI_PAGE_ATTACHMENT.TENANT_ID))
                  .isEqualTo(1L);

              // tenant#2 컨텍스트로 전환 → tenant#1 의 첨부 매핑은 비가시 (RLS USING 차단)
              setGuc(tid2);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(WIKI_PAGE_ATTACHMENT)
                              .where(WIKI_PAGE_ATTACHMENT.FILE_ID.eq(fileId))))
                  .isZero();

              // tenant#1 로 되돌리면 다시 1건
              setGuc(1L);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(WIKI_PAGE_ATTACHMENT)
                              .where(WIKI_PAGE_ATTACHMENT.FILE_ID.eq(fileId))))
                  .isEqualTo(1);

              status.setRollbackOnly(); // 공유 DB 무오염
              return null;
            });
  }
}
