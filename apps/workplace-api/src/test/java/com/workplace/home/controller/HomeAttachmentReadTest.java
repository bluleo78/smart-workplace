package com.workplace.home.controller;

import static com.workplace.jooq.Tables.FILE_EXTRACTION;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.home.HomeAttachmentTestSupport;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** WP-234: 세션 첨부 목록·구간 읽기·원본 + 메시지 조회 attachments. 세션 소유자만, 다른 세션 파일은 404, ai-agent 대행 인증 동작. */
class HomeAttachmentReadTest extends HomeAttachmentTestSupport {

  private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', 1, 2};

  /** 시드: m1(USER "첫 질문" + a.pdf, b.png) → ASSISTANT → m2(USER "" + c.txt). */
  private record Seed(long uid, UUID sid, long pdf, long png, long txt, long m1, long m2) {}

  private Seed seed() {
    long uid = user();
    UUID sid = sessionService.create(uid).id();
    long pdf = upload(uid, "a.pdf", "application/pdf", "%PDF".getBytes());
    long png = upload(uid, "b.png", "image/png", PNG);
    long m1 = attachmentService.appendUserMessage(uid, sid, "첫 질문", List.of(pdf, png));
    sessionService.appendMessage(uid, sid, "ASSISTANT", "봤어요", null, null, null);
    long txt = upload(uid, "c.txt", "text/plain", "hello".getBytes());
    long m2 = attachmentService.appendUserMessage(uid, sid, "", List.of(txt));
    return new Seed(uid, sid, pdf, png, txt, m1, m2);
  }

  /** 해당 사용자의 브라우저 JWT 를 붙인 요청. */
  private MockHttpServletRequestBuilder as(long uid, MockHttpServletRequestBuilder req) {
    return req.header("Authorization", bearer(uid));
  }

  @Test
  void 세션_첨부_목록은_메시지_파일_순서와_추출상태를_돌려준다() throws Exception {
    Seed s = seed();
    http(as(s.uid(), get("/api/v1/home/sessions/{sid}/attachments", s.sid())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(3))
        .andExpect(jsonPath("$[0].fileId").value(s.pdf()))
        .andExpect(jsonPath("$[0].messageId").value(s.m1()))
        .andExpect(jsonPath("$[0].originalName").value("a.pdf"))
        .andExpect(jsonPath("$[0].mimeType").value("application/pdf"))
        .andExpect(jsonPath("$[0].sizeBytes").value(4))
        .andExpect(jsonPath("$[0].extraction.status").value("PENDING"))
        .andExpect(jsonPath("$[1].fileId").value(s.png()))
        .andExpect(jsonPath("$[1].extraction.status").value("SKIPPED"))
        .andExpect(jsonPath("$[1].extraction.reasonCode").value("IMAGE"))
        .andExpect(jsonPath("$[2].fileId").value(s.txt()))
        .andExpect(jsonPath("$[2].messageId").value(s.m2()));
  }

  @Test
  void 구간_읽기는_READY_텍스트를_자르고_음수_offset_은_400() throws Exception {
    Seed s = seed();
    inTx(
        () ->
            dsl.update(FILE_EXTRACTION)
                .set(FILE_EXTRACTION.STATUS, "DONE")
                .set(FILE_EXTRACTION.EXTRACTED_TEXT, "abcdef")
                .set(FILE_EXTRACTION.CHAR_COUNT, 6)
                .where(FILE_EXTRACTION.FILE_ID.eq(s.pdf()))
                .execute());
    String base = "/api/v1/home/sessions/{sid}/attachments/{fileId}/text";
    http(as(s.uid(), get(base, s.sid(), s.pdf()).param("offset", "2").param("limit", "2")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("READY"))
        .andExpect(jsonPath("$.text").value("cd"))
        .andExpect(jsonPath("$.nextOffset").value(4))
        .andExpect(jsonPath("$.totalChars").value(6));
    http(as(s.uid(), get(base, s.sid(), s.pdf())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.text").value("abcdef"));
    http(as(s.uid(), get(base, s.sid(), s.png())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("SKIPPED"))
        .andExpect(jsonPath("$.text").doesNotExist());
    http(as(s.uid(), get(base, s.sid(), s.pdf()).param("offset", "-1")))
        .andExpect(status().isBadRequest());
  }

  @Test
  void 원본은_이미지만_inline_이고_그_외는_attachment_로_내려준다() throws Exception {
    Seed s = seed();
    String base = "/api/v1/home/sessions/{sid}/attachments/{fileId}/content";
    http(as(s.uid(), get(base, s.sid(), s.png())))
        .andExpect(status().isOk())
        .andExpect(header().string("Content-Type", "image/png"))
        .andExpect(header().string("Content-Disposition", startsWith("inline")))
        .andExpect(content().bytes(PNG));
    http(as(s.uid(), get(base, s.sid(), s.pdf())))
        .andExpect(status().isOk())
        .andExpect(header().string("Content-Type", "application/pdf"))
        .andExpect(header().string("Content-Disposition", startsWith("attachment")));
  }

  @Test
  void 남의_세션과_다른_세션_파일과_없는_세션은_404() throws Exception {
    Seed s = seed();
    long stranger = user();
    String list = "/api/v1/home/sessions/{sid}/attachments";
    String text = "/api/v1/home/sessions/{sid}/attachments/{fileId}/text";
    String raw = "/api/v1/home/sessions/{sid}/attachments/{fileId}/content";
    http(as(stranger, get(list, s.sid()))).andExpect(status().isNotFound());
    http(as(stranger, get(text, s.sid(), s.pdf()))).andExpect(status().isNotFound());
    http(as(stranger, get(raw, s.sid(), s.png()))).andExpect(status().isNotFound());

    // 같은 소유자의 다른 세션 — 그 세션에 붙지 않은 파일은 404.
    UUID other = sessionService.create(s.uid()).id();
    long x = upload(s.uid(), "x.pdf", "application/pdf", "%PDF".getBytes());
    attachmentService.appendUserMessage(s.uid(), other, "다른", List.of(x));
    http(as(s.uid(), get(text, s.sid(), x))).andExpect(status().isNotFound());
    http(as(s.uid(), get(raw, s.sid(), x))).andExpect(status().isNotFound());
    http(as(s.uid(), get(raw, other, s.png()))).andExpect(status().isNotFound());
    http(as(s.uid(), get(list, UUID.randomUUID()))).andExpect(status().isNotFound());
  }

  @Test
  void ai_agent_사용자_대행_인증으로도_읽는다() throws Exception {
    Seed s = seed();
    http(get("/api/v1/home/sessions/{sid}/attachments", s.sid())
            .header("Authorization", "Internal test-token")
            .header("X-On-Behalf-Of", String.valueOf(s.uid())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(3));
    http(get("/api/v1/home/sessions/{sid}/attachments/{fileId}/content", s.sid(), s.png())
            .header("Authorization", "Internal test-token")
            .header("X-On-Behalf-Of", String.valueOf(s.uid())))
        .andExpect(status().isOk())
        .andExpect(content().bytes(PNG));
  }

  @Test
  void 메시지_조회의_각_메시지에_attachments_가_붙는다() throws Exception {
    Seed s = seed();
    http(as(s.uid(), get("/api/v1/home/sessions/{id}/messages", s.sid())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(3))
        .andExpect(jsonPath("$[0].attachments.length()").value(2))
        .andExpect(jsonPath("$[0].attachments[0].originalName").value("a.pdf"))
        .andExpect(jsonPath("$[0].attachments[1].extraction.status").value("SKIPPED"))
        .andExpect(jsonPath("$[1].role").value("ASSISTANT"))
        .andExpect(jsonPath("$[1].attachments.length()").value(0))
        .andExpect(jsonPath("$[2].content").value(""))
        .andExpect(jsonPath("$[2].attachments[0].fileId").value(s.txt()));
  }
}
