package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.DRIVE_SPACE_MEMBER;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * DriveContentSearchRepository 통합 테스트. RLS 테넌트 스코프 + drive_space_member 멤버십 필터 + 키워드(tsvector) 매칭 +
 * ts_headline 스니펫 검증.
 */
@Transactional
class DriveContentSearchRepositoryTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveContentSearchRepository repo;

  private static final long TENANT = 1L;

  private long userA; // 테스트 전용 유저(SPACE_A 멤버)
  private long userOther; // SPACE_A 비멤버(별도 공간 소유자)
  private long spaceA; // userA 가 멤버인 공간
  private long spaceOther; // userA 가 멤버가 아닌 공간

  /** 테넌트 GUC 설정. RLS 테이블에 INSERT 하기 전 반드시 필요. */
  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT);
    userA = seedUser("csr_a");
    userOther = seedUser("csr_o");
    spaceA = seedSpaceWithMember("공간A", userA);
    // SPACE_OTHER: userOther 소유, userA 비멤버
    spaceOther = seedSpaceWithMember("공간B", userOther);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  // ---------------------------------------------------------------- 시드 헬퍼

  /** 테스트용 유저 INSERT. */
  private long seedUser(String prefix) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, prefix + "_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, prefix)
        .set(USER.EMAIL, prefix + "_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** drive_space + drive_space_member(OWNER) INSERT → 공간 id 반환. */
  private long seedSpaceWithMember(String name, long ownerId) {
    long spaceId =
        dsl.insertInto(DRIVE_SPACE)
            .set(DRIVE_SPACE.TYPE, "TEAM")
            .set(DRIVE_SPACE.NAME, name)
            .set(DRIVE_SPACE.OWNER_ID, ownerId)
            .returning(DRIVE_SPACE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(DRIVE_SPACE_MEMBER)
        .set(DRIVE_SPACE_MEMBER.SPACE_ID, spaceId)
        .set(DRIVE_SPACE_MEMBER.USER_ID, ownerId)
        .set(DRIVE_SPACE_MEMBER.ROLE, "OWNER")
        .execute();
    return spaceId;
  }

  /**
   * file → drive_file → file_extraction(status=DONE, extracted_text 세팅) 를 한번에 삽입. search_tv 는
   * GENERATED ALWAYS AS (to_tsvector('simple', extracted_text)) STORED 라 자동 생성된다.
   */
  private long seedDriveFileWithExtraction(long spaceId, String fileName, String extractedText) {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long fileId =
        dsl.insertInto(FILE)
            .set(FILE.ORIGINAL_NAME, fileName)
            .set(FILE.STORED_NAME, "stored_" + s)
            .set(FILE.MIME_TYPE, "text/plain")
            .set(FILE.SIZE_BYTES, 100L)
            .set(FILE.STORAGE_PATH, "/data/uploads/" + s)
            .set(FILE.UPLOADED_BY, userA)
            .returning(FILE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(DRIVE_FILE)
        .set(DRIVE_FILE.SPACE_ID, spaceId)
        .set(DRIVE_FILE.FILE_ID, fileId)
        .set(DRIVE_FILE.NAME, fileName)
        .execute();
    dsl.insertInto(FILE_EXTRACTION)
        .set(FILE_EXTRACTION.FILE_ID, fileId)
        .set(FILE_EXTRACTION.STATUS, "DONE")
        .set(FILE_EXTRACTION.EXTRACTED_TEXT, extractedText)
        .set(FILE_EXTRACTION.TENANT_ID, TENANT)
        .execute();
    return dsl.select(DRIVE_FILE.ID)
        .from(DRIVE_FILE)
        .where(DRIVE_FILE.FILE_ID.eq(fileId))
        .fetchOne(DRIVE_FILE.ID);
  }

  // ---------------------------------------------------------------- 테스트

  /**
   * userA 가 멤버인 공간(SPACE_A)의 파일은 결과에 포함되고, 비멤버 공간(SPACE_OTHER)의 동일 키워드 파일은 배제되어야 한다. 멤버십 RLS 필터 검증.
   */
  @Test
  void hybridSearch_returns_only_accessible_files_ranked_by_rrf() {
    long mine = seedDriveFileWithExtraction(spaceA, "분기 매출 보고서", "Q3 매출 성장");
    long notMine = seedDriveFileWithExtraction(spaceOther, "비밀 보고서", "Q3 매출 성장");

    var hits = repo.hybridSearch(userA, "매출", null /* 벡터 없음 = 키워드 전용 */, 10, null);
    var ids = hits.stream().map(DriveContentSearchRepository.ContentRow::driveFileId).toList();

    assertThat(ids).contains(mine).doesNotContain(notMine); // 멤버십 필터
  }

  /** 벡터 없이 키워드 전용 검색 시 매칭 파일이 반환되고, ts_headline 이 쿼리 키워드를 포함한 스니펫을 생성해야 한다. */
  @Test
  void hybridSearch_keyword_only_when_vector_null_still_returns_snippet() {
    long f = seedDriveFileWithExtraction(spaceA, "회의록", "프로젝트 일정 논의");

    var hits = repo.hybridSearch(userA, "일정", null, 10, null);

    assertThat(hits)
        .anySatisfy(
            h -> {
              assertThat(h.driveFileId()).isEqualTo(f);
              assertThat(h.snippet()).contains("일정"); // ts_headline 발췌
            });
  }

  /** userA 가 두 공간 모두 멤버라도, spaceId 를 지정하면 그 공간의 파일만 반환해야 한다(스코프 제한). */
  @Test
  void hybridSearch_withSpaceId_scopesToThatSpaceOnly() {
    long spaceB = seedSpaceWithMember("공간C", userA); // userA 가 멤버인 두 번째 공간
    long inA = seedDriveFileWithExtraction(spaceA, "A공간 보고서", "분기 실적 요약");
    long inB = seedDriveFileWithExtraction(spaceB, "B공간 보고서", "분기 실적 요약");

    var hits = repo.hybridSearch(userA, "실적", null, 10, spaceA);
    var ids = hits.stream().map(DriveContentSearchRepository.ContentRow::driveFileId).toList();

    assertThat(ids).contains(inA).doesNotContain(inB);
  }
}
