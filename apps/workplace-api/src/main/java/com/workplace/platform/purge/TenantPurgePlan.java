package com.workplace.platform.purge;

import static com.workplace.jooq.Tables.*;

import java.util.List;
import java.util.Set;
import org.jooq.DSLContext;
import org.jooq.Table;

/**
 * 테넌트 영구 삭제 시 데이터를 지우는 순서(자식 → 부모). 각 테이블을 대상 테넌트 GUC 아래에서 {@code DELETE ... WHERE tenant_id = ?} 로
 * 비운다.
 *
 * <p>FK CASCADE 전환 대신 명시 목록을 쓰는 이유: RLS 아래에서 실행되어 다른 테넌트 행에 닿을 수 없고, RESTRICT FK (issue.type_id,
 * email_message.content_id, email_attachment.content_attachment_id)의 연쇄 순서 문제를 피한다. 목록 누락·순서 오류는
 * TenantPurgePlanGuardTest 가 카탈로그와 대조해 잡는다.
 */
public final class TenantPurgePlan {

  private TenantPurgePlan() {}

  /** tenant FK CASCADE 또는 purge_tenant() 가 처리하므로 목록에서 제외(app_tenant 는 membership DELETE 권한 없음). */
  public static final Set<String> EXCLUDED = Set.of("membership", "user_api_token");

  /**
   * tenant_id 컬럼을 가진 public 스키마 BASE TABLE 이름 카탈로그 쿼리. information_schema 는 현재 롤에 권한 있는 테이블만 보여 누락을
   * 숨길 수 있어 pg_class/pg_attribute 로 읽는다. 서비스·가드 테스트·격리 테스트가 같은 SQL 을 쓰도록 한 곳에 둔다.
   */
  public static final String TENANT_TABLES_SQL =
      "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
          + "JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped "
          + "WHERE n.nspname = 'public' AND c.relkind = 'r'";

  /** 카탈로그상 tenant_id 를 가진 모든 테이블 이름(EXCLUDED 포함, 정렬 없음). */
  public static List<String> tenantTableNames(DSLContext dsl) {
    return dsl.fetchValues(TENANT_TABLES_SQL).stream().map(Object::toString).toList();
  }

  public static final List<Table<?>> ORDER =
      List.of(
          // 이슈 컨텍스트 채팅·알림·읽음 (issue 를 참조)
          CHAT_MESSAGE_ATTACHMENT,
          CHAT_MESSAGE,
          CHAT_THREAD_MEMBER,
          CHAT_THREAD,
          NOTIFICATION,
          THREAD_READ_STATE,
          // 이슈 하위 → 이슈 → 프로젝트 하위 → 프로젝트 (issue.type_id RESTRICT 때문에 issue 가 issue_type_def 보다 먼저)
          ISSUE_DEPENDENCY,
          ISSUE_LABEL,
          ISSUE_ASSIGNEE,
          ISSUE_WATCHER,
          ISSUE_CYCLE,
          ISSUE_FIELD_VALUE,
          ISSUE_HISTORY,
          ISSUE_COMMENT,
          ISSUE_ATTACHMENT,
          ISSUE_BODY_IMAGE,
          ISSUE_AI_SUMMARY,
          AGENT_WORK_EVENT,
          AGENT_WORK,
          ISSUE,
          MILESTONE,
          CYCLE,
          SAVED_VIEW,
          LABEL,
          ISSUE_FIELD_DEF,
          PROJECT_MEMBER,
          PROJECT_ISSUE_SEQUENCE,
          ISSUE_TYPE_DEF,
          PROJECT,
          // 팀 채팅 (drive_space.linked_channel_id 는 SET NULL)
          MESSAGE_REACTION,
          MESSAGE_ATTACHMENT,
          MESSAGE_ACTION_PROPOSAL,
          CONVERSATION_ATTENTION,
          MESSAGING_CLASSIFY_WATERMARK,
          MESSAGE,
          CHANNEL_MEMBER,
          CHANNEL,
          // 홈·비서 (ai_memory 는 home_session 을 SET NULL 로 참조 — 세션보다 먼저, WP-55)
          // 메모리 기록·지운 기록(WP-385)과 공용 메모리 3표(WP-386)는 서로·세션과 FK 가 없다 — 메모리 표와 함께.
          SHARED_AI_MEMORY_CHANGE,
          SHARED_AI_MEMORY_FORGOTTEN,
          SHARED_AI_MEMORY,
          AI_MEMORY_CHANGE,
          AI_MEMORY_FORGOTTEN,
          AI_MEMORY,
          HOME_ACTION_PROPOSAL,
          HOME_MESSAGE_ATTACHMENT,
          HOME_MESSAGE,
          HOME_SESSION,
          USER_PRIORITY_ITEM,
          USER_DASHBOARD,
          ASSISTANT_CONFIG,
          WORKSPACE_ASSISTANT,
          // 위키
          WIKI_REFERENCE,
          WIKI_PAGE_ATTACHMENT,
          WIKI_PAGE_BODY_HISTORY,
          WIKI_PAGE_DOC,
          WIKI_REVISION,
          WIKI_PAGE,
          WIKI_SPACE_MEMBER,
          WIKI_SPACE,
          // 캘린더 (외부 캘린더는 email_account 를 참조하므로 메일보다 먼저)
          EVENT_ATTENDEE,
          EVENT_REMINDER,
          CALENDAR_EVENT_EXCEPTION,
          CALENDAR_EVENT,
          CALENDAR,
          // 메일 (email_message.content_id RESTRICT 때문에 메시지·첨부가 본문보다 먼저)
          EMAIL_ATTACHMENT,
          EMAIL_MESSAGE,
          EMAIL_FOLDER,
          EMAIL_ACCOUNT,
          CONTENT_ATTACHMENT,
          EMAIL_CONTENT,
          MAIL_ATTACHMENT_BLOB,
          // 드라이브 → 파일 (drive_file·drive_file_version.file_id NO ACTION)
          DRIVE_SHARE_LINK,
          DRIVE_TRANSFER_LINK,
          DRIVE_FILE_REF,
          DRIVE_FILE_VERSION,
          FILE_EXTRACTION,
          DRIVE_FILE,
          DRIVE_FOLDER,
          DRIVE_SPACE_MEMBER,
          DRIVE_SPACE,
          WORKER_JOB,
          FILE,
          // 연락처·그룹
          CONTACT_FAVORITE,
          CONTACT_ENTRY,
          USER_GROUP_MEMBER,
          USER_GROUP,
          // 권한·감사·기타
          USER_ROLE,
          ROLE_PERMISSION,
          ROLE,
          AUDIT_LOG,
          TENANT_CANARY);
}
