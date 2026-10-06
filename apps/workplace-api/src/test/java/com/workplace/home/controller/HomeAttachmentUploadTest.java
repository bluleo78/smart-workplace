package com.workplace.home.controller;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.home.HomeAttachmentTestSupport;
import com.workplace.home.exception.HomeAttachmentInvalidException;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;

/** WP-234: 메인 AI 채팅 첨부 선업로드 — 호출자 단위 임시 저장, 정규화 mime, 개수·크기·빈 요청 400. */
class HomeAttachmentUploadTest extends HomeAttachmentTestSupport {

  @Test
  void 업로드하면_임시_ATTACHMENT_로_저장되고_메타를_돌려준다() throws Exception {
    long uid = user();
    String body =
        http(multipart("/api/v1/home/attachments")
                .file(
                    new MockMultipartFile(
                        "files", "REPORT.PDF", "application/octet-stream", "%PDF".getBytes()))
                .file(new MockMultipartFile("files", "a.png", "image/png", new byte[] {1, 2, 3}))
                .header("Authorization", bearer(uid)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].originalName").value("REPORT.PDF"))
            .andExpect(jsonPath("$[0].mimeType").value("application/pdf"))
            .andExpect(jsonPath("$[0].sizeBytes").value(4))
            .andExpect(jsonPath("$[1].mimeType").value("image/png"))
            .andReturn()
            .getResponse()
            .getContentAsString();
    long fileId = om.readTree(body).get(0).get("fileId").asLong();

    var row = inTx(() -> dsl.selectFrom(FILE).where(FILE.ID.eq(fileId)).fetchOne());
    assertThat(row.getCategory()).isEqualTo("ATTACHMENT");
    assertThat(row.getUploadedBy()).isEqualTo(uid);
    assertThat(row.getExpiresAt()).isAfter(OffsetDateTime.now());
    assertThat(row.getStoragePath()).startsWith("tenant-1/home/");
    // 선업로드만으로는 추출을 요청하지 않는다(버려질 수 있는 임시 파일).
    assertThat(inTx(() -> dsl.fetchExists(FILE_EXTRACTION, FILE_EXTRACTION.FILE_ID.eq(fileId))))
        .isFalse();
  }

  @Test
  void 열한_개를_한번에_올리면_400_한국어_사유() throws Exception {
    long uid = user();
    MockMultipartHttpServletRequestBuilder req = multipart("/api/v1/home/attachments");
    for (int i = 0; i < 11; i++) {
      req.file(new MockMultipartFile("files", "f" + i + ".txt", "text/plain", "x".getBytes()));
    }
    http(req.header("Authorization", bearer(uid)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("한 번에 첨부할 수 있는 파일은 최대 10개예요."));
    assertThat(inTx(() -> dsl.fetchCount(FILE, FILE.UPLOADED_BY.eq(uid)))).isZero();
  }

  @Test
  void files_파트가_없으면_400_한국어_사유() throws Exception {
    long uid = user();
    http(multipart("/api/v1/home/attachments")
            .param("noop", "1")
            .header("Authorization", bearer(uid)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("업로드할 파일이 없어요."));
  }

  @Test
  void 파일_하나가_25MB_를_넘으면_거절하고_아무것도_저장하지_않는다() {
    long uid = user();
    var big =
        new MockMultipartFile("files", "big.bin", "application/octet-stream", new byte[26_214_401]);
    var small = new MockMultipartFile("files", "ok.txt", "text/plain", "x".getBytes());
    assertThatThrownBy(() -> attachmentService.upload(uid, List.of(small, big)))
        .isInstanceOf(HomeAttachmentInvalidException.class)
        .hasMessage("파일 하나는 25MB 까지 첨부할 수 있어요.");
    assertThat(inTx(() -> dsl.fetchCount(FILE, FILE.UPLOADED_BY.eq(uid)))).isZero();
  }
}
