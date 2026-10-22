package com.workplace.file;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.chat.service.ChatMessageAttachmentStorage;
import com.workplace.file.storage.StorageDomain;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.service.IssueAttachmentStorage;
import com.workplace.messaging.service.MessageAttachmentStorage;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.service.WikiAttachmentStorage;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

/**
 * 첨부 업로드의 원본 파일명 정리(WP-737) — 이슈·메시징·채팅(홈)·위키 첨부 저장소가 길이만 맞추고 경로 구분자·제어 문자를 그대로 저장해
 * "../../etc/passwd" 가 그대로 저장·다운로드 이름이 됐다. 드라이브·메일 작성 첨부처럼 SafeFileNames.sanitize 를 거쳐 "_" 로 바꾸고, 빈
 * 이름은 대체 이름으로 받는다.
 */
@Transactional
class UploadOriginalNameSanitizeTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired IssueAttachmentStorage issueStorage;
  @Autowired MessageAttachmentStorage messageStorage;
  @Autowired ChatMessageAttachmentStorage chatStorage;
  @Autowired WikiAttachmentStorage wikiStorage;

  private long uploader;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    String s = UUID.randomUUID().toString().substring(0, 8);
    uploader =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "up-" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "up")
            .set(USER.EMAIL, "up-" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
  }

  @AfterEach
  void clear() {
    TenantContext.clear();
  }

  private static MockMultipartFile file(String name) {
    return new MockMultipartFile("file", name, "text/plain", "x".getBytes());
  }

  private String storedName(long fileId) {
    return dsl.select(FILE.ORIGINAL_NAME)
        .from(FILE)
        .where(FILE.ID.eq(fileId))
        .fetchOne(FILE.ORIGINAL_NAME);
  }

  @Test
  void 이슈_첨부는_경로_문자를_바꾸고_빈_이름은_대체한다() {
    assertThat(storedName(issueStorage.storeAndInsert(file("../../etc/passwd"), uploader)))
        .isEqualTo(".._.._etc_passwd");
    assertThat(storedName(issueStorage.storeAndInsert(file("a\u0001b‮txt.exe"), uploader)))
        .isEqualTo("a_b_txt.exe");
    assertThat(storedName(issueStorage.storeAndInsert(file(""), uploader))).isEqualTo("file");
  }

  @Test
  void 메시징_첨부는_경로_문자를_바꾼다() throws Exception {
    assertThat(storedName(messageStorage.storeTemporary(file("../../etc/passwd"), uploader)))
        .isEqualTo(".._.._etc_passwd");
  }

  @Test
  void 채팅_홈_첨부는_경로_문자를_바꾸고_응답_이름도_같다() throws Exception {
    for (StorageDomain domain : new StorageDomain[] {StorageDomain.CHAT, StorageDomain.HOME}) {
      var stored = chatStorage.storeTemporary(file("..\\..\\x.txt"), uploader, domain);
      assertThat(stored.originalName()).isEqualTo(".._.._x.txt");
      assertThat(storedName(stored.fileId())).isEqualTo(".._.._x.txt");
    }
  }

  @Test
  void 위키_첨부는_경로_문자를_바꾸고_공백_이름은_image() {
    assertThat(
            storedName(wikiStorage.storeTemporary(file("../../etc/x.png"), uploader, "image/png")))
        .isEqualTo(".._.._etc_x.png");
    assertThat(storedName(wikiStorage.storeTemporary(file("   "), uploader, "image/png")))
        .isEqualTo("image");
  }
}
