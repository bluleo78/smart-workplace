package com.workplace.drive.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.DriveFileHit;
import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.dto.DriveSearchResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/** 공간 이름 검색 — 중첩 폴더 매칭/경로/권한/이스케이프. */
@Transactional
class DriveSearchServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileService fileService;
  @Autowired DriveFolderService folderService;
  @Autowired DriveSearchService searchService;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "se_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Se" + s)
        .set(USER.EMAIL, "se_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private MockMultipartFile txt(String name) {
    return new MockMultipartFile("file", name, "text/plain", "x".getBytes());
  }

  /** 중첩 폴더의 파일/폴더 이름 매칭 + folderPath 계산. */
  @Test
  void search_matchesNestedItems_withPath() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFolderResponse a = folderService.create(u, sp.id(), null, "프로젝트");
    DriveFolderResponse b = folderService.create(u, sp.id(), a.id(), "문서");
    fileService.upload(u, sp.id(), b.id(), txt("report-final.txt"));
    folderService.create(u, sp.id(), a.id(), "report-archive");

    DriveSearchResponse res = searchService.search(u, sp.id(), "report");

    assertThat(res.files()).hasSize(1);
    DriveFileHit hit = res.files().get(0);
    assertThat(hit.name()).isEqualTo("report-final.txt");
    assertThat(hit.folderPath()).isEqualTo("프로젝트/문서");
    assertThat(res.folders()).extracting(f -> f.name()).contains("report-archive");
    assertThat(res.folders().get(0).folderPath()).isEqualTo("프로젝트");
  }

  /** 2자 미만 쿼리는 빈 결과. */
  @Test
  void search_shortQuery_returnsEmpty() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    fileService.upload(u, sp.id(), null, txt("aa.txt"));

    DriveSearchResponse res = searchService.search(u, sp.id(), "a");

    assertThat(res.files()).isEmpty();
    assertThat(res.folders()).isEmpty();
  }

  /** 와일드카드 이스케이프 — 쿼리 'a%' 는 리터럴 'a%' 로 매칭(’%’를 와일드카드로 해석하지 않음). */
  @Test
  void search_escapesWildcards() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    fileService.upload(u, sp.id(), null, txt("a%b.txt")); // 리터럴 'a%' 포함
    fileService.upload(u, sp.id(), null, txt("axb.txt")); // 'a%'가 와일드카드면 매칭될 대조군

    DriveSearchResponse res = searchService.search(u, sp.id(), "a%");

    assertThat(res.files()).hasSize(1);
    assertThat(res.files().get(0).name()).isEqualTo("a%b.txt");
  }

  /** 비멤버는 검색 불가(존재 은닉 → NotFound). */
  @Test
  void search_byNonMember_isRejected() throws Exception {
    long owner = seedUser();
    long outsider = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(owner, "팀");

    assertThatThrownBy(() -> searchService.search(outsider, sp.id(), "report"))
        .isInstanceOf(DriveSpaceNotFoundException.class);
  }
}
