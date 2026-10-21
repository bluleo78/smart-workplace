package com.workplace.file.api;

import static com.workplace.jooq.Tables.CHAT_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.HOME_MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.ISSUE_ATTACHMENT;
import static com.workplace.jooq.Tables.MAIL_DRAFT;
import static com.workplace.jooq.Tables.MAIL_DRAFT_ATTACHMENT;
import static com.workplace.jooq.Tables.MESSAGE_ATTACHMENT;
import static com.workplace.jooq.Tables.WIKI_PAGE_ATTACHMENT;

import java.util.Collection;
import java.util.Set;
import org.jooq.DSLContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 첨부 정션 바인딩 조회 빈({@link StagedFileClaimer}, WP-421) — 정션마다 "file_id 행이 있으면 묶인 것" 이라는 같은 규칙이라 한곳에
 * 둔다. 도메인 패키지는 import 하지 않고 생성된 jOOQ 표 열만 쓴다. <b>새 첨부 정션이 생기면 여기에 더해야 한다</b> — 빠지면 그 정션에 묶인 파일이 다른
 * 곳에 다시 묶인다.
 *
 * <p>이슈·메시지·이슈 채팅·홈은 묶을 때 영구로 만들어 대개 "임시" 조건이 먼저 거르지만, 묶인 채 만료가 다시 서는 경로(홈 세션 삭제 등)가 있어 정션을 직접 본다.
 * 노트는 묶고도 임시로 두고 강등(demoted_at) 행도 그 페이지의 파일이라, 행 존재만 보는 {@link JunctionBindingLookup} 이 강등과 무관하게
 * 묶인 것으로 본다.
 */
@Configuration
public class AttachmentBindingConfig {

  @Bean
  AttachmentBindingLookup issueAttachmentBindingLookup(DSLContext dsl) {
    return new JunctionBindingLookup(dsl, ISSUE_ATTACHMENT.FILE_ID);
  }

  @Bean
  AttachmentBindingLookup chatAttachmentBindingLookup(DSLContext dsl) {
    return new JunctionBindingLookup(dsl, CHAT_MESSAGE_ATTACHMENT.FILE_ID);
  }

  @Bean
  AttachmentBindingLookup messageAttachmentBindingLookup(DSLContext dsl) {
    return new JunctionBindingLookup(dsl, MESSAGE_ATTACHMENT.FILE_ID);
  }

  @Bean
  AttachmentBindingLookup homeAttachmentBindingLookup(DSLContext dsl) {
    return new JunctionBindingLookup(dsl, HOME_MESSAGE_ATTACHMENT.FILE_ID);
  }

  @Bean
  AttachmentBindingLookup wikiAttachmentBindingLookup(DSLContext dsl) {
    return new JunctionBindingLookup(dsl, WIKI_PAGE_ATTACHMENT.FILE_ID);
  }

  /**
   * 메일 임시저장(WP-577) — 묶는 동안 영구지만, 저장에서 빠지거나 발송 실패로 되돌릴 때 다시 임시가 되므로 정션을 직접 본다. 이 바인딩을 지목한 호출자(발송)는
   * 본인 임시저장에 묶인 업로드를 다시 가져올 수 있다 — 어느 임시저장에서 보내든(다른 탭에서 옮겨 갔어도) 내 파일이면 보낸다.
   */
  @Bean
  AttachmentBindingLookup mailDraftAttachmentBindingLookup(DSLContext dsl) {
    JunctionBindingLookup junction = new JunctionBindingLookup(dsl, MAIL_DRAFT_ATTACHMENT.FILE_ID);
    return new AttachmentBindingLookup() {
      @Override
      public String bindingKey() {
        return junction.bindingKey();
      }

      @Override
      public Set<Long> boundAmong(Collection<Long> fileIds) {
        return junction.boundAmong(fileIds);
      }

      @Override
      public Set<Long> reclaimableBy(long callerId, Collection<Long> fileIds) {
        if (fileIds.isEmpty()) {
          return Set.of();
        }
        return dsl.select(MAIL_DRAFT_ATTACHMENT.FILE_ID)
            .from(MAIL_DRAFT_ATTACHMENT)
            .join(MAIL_DRAFT)
            .on(MAIL_DRAFT.ID.eq(MAIL_DRAFT_ATTACHMENT.DRAFT_ID))
            .where(MAIL_DRAFT.USER_ID.eq(callerId))
            .and(MAIL_DRAFT_ATTACHMENT.FILE_ID.in(fileIds))
            .fetchSet(MAIL_DRAFT_ATTACHMENT.FILE_ID);
      }
    };
  }
}
