package com.workplace.wiki;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static com.workplace.jooq.Tables.WIKI_PAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static com.workplace.jooq.tables.File.FILE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.file.service.FileCleanupService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiAttachmentResponse;
import com.workplace.wiki.service.WikiAttachmentService;
import com.workplace.wiki.service.WikiPageService;
import com.workplace.wiki.service.WikiSpaceService;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;

/**
 * #759 강등(만료 재무장) → 정리 스윕 회수의 종단 검증.
 *
 * <p>"강등하면 expires_at 이 채워진다" 만 단언하면 회수에 대해서는 아무것도 증명하지 못한다. 실제로 blob 과 매핑이 사라지는지, 그리고 #751 이 즉시
 * 삭제를 기각한 이유였던 "살아 있는 참조" 가 보호되는지 두 방향을 함께 고정한다.
 *
 * <p>비-@Transactional: {@code FileCleanupService} 는 {@code TenantScopedRunner} 로 자기 트랜잭션을 열므로 테스트
 * 트랜잭션 안의 미커밋 데이터를 볼 수 없다. 정리는 자기-id {@code @AfterEach} 로 직접 한다.
 *
 * <p>유예 경과는 시계를 기다리는 대신 {@code expires_at} 을 과거로 backdate 해 재현한다 — 이 테스트의 대상은 유예 계산이 아니라 스윕이다(유예
 * 왕복은 WikiAttachmentIntegrationTest 가 담당).
 */
class WikiAttachmentReclaimSweepTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired WikiSpaceService spaceService;
  @Autowired WikiPageService pageService;
  @Autowired WikiAttachmentService attachmentService;
  @Autowired FileCleanupService cleanupService;

  private final List<Long> seededUserIds = new ArrayList<>();
  private final List<Long> seededFileIds = new ArrayList<>();
  private long seededSpaceId = -1;

  @AfterEach
  void cleanup() {
    cleanupInTenant(
        1L,
        () -> {
          if (!seededFileIds.isEmpty()) {
            dsl.deleteFrom(FILE).where(FILE.ID.in(seededFileIds)).execute();
          }
          if (seededSpaceId != -1) {
            dsl.deleteFrom(WIKI_SPACE).where(WIKI_SPACE.ID.eq(seededSpaceId)).execute();
          }
          if (!seededUserIds.isEmpty()) {
            dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(seededUserIds)).execute();
            dsl.deleteFrom(USER).where(USER.ID.in(seededUserIds)).execute();
          }
        });
    seededUserIds.clear();
    seededFileIds.clear();
    seededSpaceId = -1;
  }

  @Test
  void 참조가_빠진_첨부는_유예가_지나면_스윕이_blob과_매핑을_회수한다() {
    TenantContext.set(1L);
    try {
      long ownerId = createUser("own");
      long spaceId = spaceService.createTeamSpace(ownerId, "회수 스윕 공간").id();
      seededSpaceId = spaceId;
      long pageId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "페이지")).id();

      var res = attachmentService.upload(ownerId, pageId, png("a.png"));
      seededFileIds.add(res.fileId());
      String body = "![img](" + WikiAttachmentResponse.urlOf(pageId, res.fileId()) + ")";
      attachmentService.syncReferences(pageId, body);
      Path path = attachmentService.download(ownerId, pageId, res.fileId()).path();
      assertThat(Files.exists(path)).as("승격 후 디스크 파일 존재").isTrue();

      // 본문에서 참조 제거 → 강등(유예 후 만료). 이 시점엔 아직 아무것도 사라지지 않아야 한다.
      attachmentService.syncReferences(pageId, "참조를 지운 본문");
      assertThat(Files.exists(path)).as("강등 직후에는 아직 살아 있어야 함").isTrue();

      backdateExpiry(res.fileId());
      cleanupService.cleanupExpiredFiles();

      assertThat(Files.exists(path)).as("유예 경과 후 스윕이 blob 을 지워야 함").isFalse();
      assertThat(fileRowExists(res.fileId())).as("file 행도 사라져야 함").isFalse();
      assertThat(mappingExists(res.fileId())).as("매핑은 file CASCADE 로 함께 사라진다").isFalse();
    } finally {
      TenantContext.clear();
    }
  }

  @Test
  void 다른_페이지_본문이_아직_참조하면_스윕이_지우지_않는다() {
    // #751 이 즉시 삭제를 기각한 실데이터 손실 시나리오 — 첨부 URL 에는 원본 pageId 가 박혀 있어
    // 복사본은 원본의 매핑으로 서빙된다. 원본에서 참조가 빠졌다고 지우면 복사본이 조용히 깨진다.
    TenantContext.set(1L);
    try {
      long ownerId = createUser("own");
      long spaceId = spaceService.createTeamSpace(ownerId, "복사본 보존 공간").id();
      seededSpaceId = spaceId;
      long originId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "원본")).id();
      long copyId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "복사본")).id();

      var res = attachmentService.upload(ownerId, originId, png("a.png"));
      seededFileIds.add(res.fileId());
      String url = WikiAttachmentResponse.urlOf(originId, res.fileId());
      pageService.save(
          ownerId, originId, new SavePageRequest(null, "![img](" + url + ")", 1, false));
      // 같은 URL(원본 pageId 가 박힌 채)을 다른 페이지 본문에 붙여넣는다.
      pageService.save(
          ownerId, copyId, new SavePageRequest(null, "붙여넣은 이미지 ![img](" + url + ")", 1, false));
      Path path = attachmentService.download(ownerId, originId, res.fileId()).path();

      // 원본에서만 참조를 지운다 → 강등.
      pageService.save(ownerId, originId, new SavePageRequest(null, "원본에서는 지웠다", 2, false));
      backdateExpiry(res.fileId());

      cleanupService.cleanupExpiredFiles();

      assertThat(Files.exists(path)).as("복사본이 참조 중이므로 blob 이 살아 있어야 함").isTrue();
      assertThat(fileRowExists(res.fileId())).as("file 행도 살아 있어야 함").isTrue();
      // 보존은 "승격" 이 아니라 "만료를 유예만큼 미룸" 이어야 한다. 여기서 NULL 로 만들면(승격) 원본을
      // 다시 저장하지 않는 한 재무장 트리거가 없어, 복사본 쪽 참조까지 지워졌을 때 어떤 본문도 참조하지 않는
      // 영구 고아가 남는다 — 무제한 증가 경로가 그대로 되살아난다.
      assertThat(expiresAt(res.fileId()))
          .as("보존 시 만료는 해제가 아니라 유예 뒤로 미뤄져야 함")
          .isNotNull()
          .isAfter(OffsetDateTime.now());
      assertThat(demotedAt(res.fileId())).as("강등 표식은 유지 — 상한 계산에서 여전히 임시가 아니다").isNotNull();
    } finally {
      TenantContext.clear();
    }
  }

  @Test
  void 보존된_첨부는_강등표식이_찍혀_임시_슬롯을_영원히_점유하지_않는다() {
    // 페이지 A 에서 잘라내 B 에 붙여넣은 파일은 A 저장 시 아직 임시라 강등을 건너뛰고, B 저장 시엔
    // URL 에 박힌 pageId 가 A 라 승격도 되지 않는다. 보존만 반복하면 그 파일은 영원히 "임시" 로 남아
    // A 의 업로드 상한 슬롯을 점유하고, 사용자는 본문을 어떻게 고쳐도 풀 수 없는 409 를 만난다.
    TenantContext.set(1L);
    try {
      long ownerId = createUser("own");
      long spaceId = spaceService.createTeamSpace(ownerId, "슬롯 점유 공간").id();
      seededSpaceId = spaceId;
      long aId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "A")).id();
      long bId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "B")).id();

      // A 에 업로드만 하고(임시) 본문에는 넣지 않은 채, 그 URL 을 B 본문에 붙여넣는다.
      var res = attachmentService.upload(ownerId, aId, png("cut.png"));
      seededFileIds.add(res.fileId());
      String url = WikiAttachmentResponse.urlOf(aId, res.fileId());
      pageService.save(ownerId, aId, new SavePageRequest(null, "잘라냈다", 1, false));
      pageService.save(
          ownerId, bId, new SavePageRequest(null, "붙여넣었다 ![img](" + url + ")", 1, false));

      backdateExpiry(res.fileId());
      cleanupService.cleanupExpiredFiles();

      assertThat(fileRowExists(res.fileId())).as("B 가 참조 중이므로 보존").isTrue();
      assertThat(demotedAt(res.fileId())).as("보존 시 강등 표식이 찍혀 임시 집합에서 빠져야 함").isNotNull();
    } finally {
      TenantContext.clear();
    }
  }

  @Test
  void 위키_첨부가_아닌_파일은_본문에_URL이_있어도_보존하지_않는다() {
    // file.id 는 도메인 공통 시퀀스다. 보존 판정이 매핑 소속을 먼저 확인하지 않으면, 위키 본문에 붙여넣은
    // 이슈/채팅/메일 첨부 URL 때문에 그쪽 파일이 위키 정책에 의해 영구 보존되어 그 도메인의 회수가 무력화된다.
    TenantContext.set(1L);
    try {
      long ownerId = createUser("own");
      long spaceId = spaceService.createTeamSpace(ownerId, "타도메인 파일 공간").id();
      seededSpaceId = spaceId;
      long pageId = pageService.create(ownerId, spaceId, new CreatePageRequest(null, "페이지")).id();

      // 위키 매핑이 없는 만료 파일을 직접 만든다(다른 도메인의 임시 첨부를 흉내).
      Path blob = Files.createTempFile("foreign", ".bin");
      Files.writeString(blob, "x");
      long foreignId =
          dsl.insertInto(FILE)
              .set(FILE.ORIGINAL_NAME, "foreign.png")
              .set(FILE.STORED_NAME, "foreign.png")
              .set(FILE.MIME_TYPE, "image/png")
              .set(FILE.STORAGE_PATH, blob.toAbsolutePath().toString())
              .set(FILE.SIZE_BYTES, 1L)
              .set(FILE.UPLOADED_BY, ownerId)
              .set(FILE.EXPIRES_AT, OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(1))
              .returning(FILE.ID)
              .fetchOne()
              .getId();
      seededFileIds.add(foreignId);

      // 그 파일의 URL 을 위키 본문에 붙여넣는다 — 위키 첨부가 아니므로 보존 근거가 되면 안 된다.
      pageService.save(
          ownerId,
          pageId,
          new SavePageRequest(
              null,
              "![img](/api/v1/wiki/pages/" + pageId + "/attachments/" + foreignId + "/content)",
              1,
              false));

      cleanupService.cleanupExpiredFiles();

      assertThat(fileRowExists(foreignId)).as("위키 매핑이 없으면 만료대로 회수돼야 함").isFalse();
    } catch (java.io.IOException e) {
      throw new java.io.UncheckedIOException(e);
    } finally {
      TenantContext.clear();
    }
  }

  /** 유예가 지난 상태를 만든다 — 시계를 기다리지 않고 만료 시각만 과거로 옮긴다. */
  private void backdateExpiry(long fileId) {
    dsl.update(FILE)
        .set(FILE.EXPIRES_AT, OffsetDateTime.now(ZoneOffset.UTC).minusMinutes(1))
        .where(FILE.ID.eq(fileId))
        .execute();
  }

  private boolean fileRowExists(long fileId) {
    return dsl.fetchExists(dsl.selectOne().from(FILE).where(FILE.ID.eq(fileId)));
  }

  private boolean mappingExists(long fileId) {
    return dsl.fetchExists(
        dsl.selectOne().from(WIKI_PAGE_ATTACHMENT).where(WIKI_PAGE_ATTACHMENT.FILE_ID.eq(fileId)));
  }

  private OffsetDateTime demotedAt(long fileId) {
    return dsl.select(WIKI_PAGE_ATTACHMENT.DEMOTED_AT)
        .from(WIKI_PAGE_ATTACHMENT)
        .where(WIKI_PAGE_ATTACHMENT.FILE_ID.eq(fileId))
        .fetchOne(0, OffsetDateTime.class);
  }

  private OffsetDateTime expiresAt(long fileId) {
    return dsl.select(FILE.EXPIRES_AT)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(0, OffsetDateTime.class);
  }

  private MockMultipartFile png(String name) {
    return new MockMultipartFile(
        "file",
        name,
        "image/png",
        new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0});
  }

  private long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    seededUserIds.add(id);
    return id;
  }
}
