package com.workplace.home.repository;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.HOME_MESSAGE;
import static com.workplace.jooq.Tables.HOME_MESSAGE_ATTACHMENT;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * 메인 AI 채팅(홈) 메시지 첨부 정션(home_message_attachment, WP-234) 접근.
 *
 * <p>붙일 수 있는 파일 판정·잠금·영구 승격은 공용 스테이징 클레임({@link com.workplace.file.api.StagedFileClaimer})이
 * 맡는다(WP-423) — 여기에는 정션 쓰기·조회만 둔다.
 */
@Repository
@RequiredArgsConstructor
public class HomeAttachmentRepository {

  private final DSLContext dsl;

  /** 세션 첨부 목록 행(추출 상태는 서비스가 붙인다). */
  public record Row(
      long fileId, long messageId, String originalName, String mimeType, long sizeBytes) {}

  /** 원본 스트리밍용 저장 정보 — path 는 FILE.STORAGE_PATH(상대경로) 그대로, 절대경로 복원은 서비스가 FileStore 로 한다. */
  public record StoredFile(String path, String originalName, String mimeType, long sizeBytes) {}

  /**
   * 정션 INSERT — 파일을 홈 USER 메시지에 연결한다. attached_at·tenant_id 는 컬럼 DEFAULT(NOW()·GUC)로 채워 같은 트랜잭션 행은
   * 시각이 같다.
   */
  public void bind(long fileId, long messageId, long attachedBy) {
    dsl.insertInto(HOME_MESSAGE_ATTACHMENT)
        .set(HOME_MESSAGE_ATTACHMENT.FILE_ID, fileId)
        .set(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID, messageId)
        .set(HOME_MESSAGE_ATTACHMENT.ATTACHED_BY, attachedBy)
        .execute();
  }

  /** 세션에 이미 붙은 첨부 수 — 세션당 상한 검사용(세션 행 잠금 뒤에 호출해야 경합에 뚫리지 않는다). */
  public int countBySession(UUID sessionId) {
    return dsl.fetchCount(
        dsl.selectOne()
            .from(HOME_MESSAGE_ATTACHMENT)
            .join(HOME_MESSAGE)
            .on(HOME_MESSAGE.ID.eq(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID))
            .where(HOME_MESSAGE.SESSION_ID.eq(sessionId)));
  }

  /**
   * 세션 전체 첨부(요약 경계 이전 메시지 포함)를 메시지 id → 연결 시각 → 파일 id 순으로. 한 메시지의 파일은 같은 트랜잭션에서 붙어 attached_at 이
   * 같으므로 파일 id(업로드 순)로 순서를 고정한다.
   */
  public List<Row> findBySession(UUID sessionId) {
    return dsl.select(
            HOME_MESSAGE_ATTACHMENT.FILE_ID,
            HOME_MESSAGE_ATTACHMENT.MESSAGE_ID,
            FILE.ORIGINAL_NAME,
            FILE.MIME_TYPE,
            FILE.SIZE_BYTES)
        .from(HOME_MESSAGE_ATTACHMENT)
        .join(HOME_MESSAGE)
        .on(HOME_MESSAGE.ID.eq(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID))
        .join(FILE)
        .on(FILE.ID.eq(HOME_MESSAGE_ATTACHMENT.FILE_ID))
        .where(HOME_MESSAGE.SESSION_ID.eq(sessionId))
        .orderBy(
            HOME_MESSAGE_ATTACHMENT.MESSAGE_ID.asc(),
            HOME_MESSAGE_ATTACHMENT.ATTACHED_AT.asc(),
            HOME_MESSAGE_ATTACHMENT.FILE_ID.asc())
        .fetch(r -> new Row(r.value1(), r.value2(), r.value3(), r.value4(), r.value5()));
  }

  /** 메시지별 첨부 파일명(이력의 [첨부: …] 표시용) — findBySession 과 같은 순서. 첨부 없는 메시지는 맵에 없다. */
  public Map<Long, List<String>> findNamesByMessageIds(Collection<Long> messageIds) {
    if (messageIds.isEmpty()) return Map.of();
    Map<Long, List<String>> out = new LinkedHashMap<>();
    dsl.select(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID, FILE.ORIGINAL_NAME)
        .from(HOME_MESSAGE_ATTACHMENT)
        .join(FILE)
        .on(FILE.ID.eq(HOME_MESSAGE_ATTACHMENT.FILE_ID))
        .where(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID.in(messageIds))
        .orderBy(
            HOME_MESSAGE_ATTACHMENT.MESSAGE_ID.asc(),
            HOME_MESSAGE_ATTACHMENT.ATTACHED_AT.asc(),
            HOME_MESSAGE_ATTACHMENT.FILE_ID.asc())
        .forEach(r -> out.computeIfAbsent(r.value1(), k -> new ArrayList<>()).add(r.value2()));
    return out;
  }

  /** 그 세션 메시지에 연결된 파일의 저장 정보. 다른 세션 파일이면 empty(호출부가 404). */
  public Optional<StoredFile> findStoredFile(UUID sessionId, long fileId) {
    return dsl.select(FILE.STORAGE_PATH, FILE.ORIGINAL_NAME, FILE.MIME_TYPE, FILE.SIZE_BYTES)
        .from(HOME_MESSAGE_ATTACHMENT)
        .join(HOME_MESSAGE)
        .on(HOME_MESSAGE.ID.eq(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID))
        .join(FILE)
        .on(FILE.ID.eq(HOME_MESSAGE_ATTACHMENT.FILE_ID))
        .where(HOME_MESSAGE_ATTACHMENT.FILE_ID.eq(fileId))
        .and(HOME_MESSAGE.SESSION_ID.eq(sessionId))
        .fetchOptional(r -> new StoredFile(r.value1(), r.value2(), r.value3(), r.value4()));
  }

  /**
   * 세션 삭제 직전 호출 — 그 세션 첨부 파일의 만료시각을 지금으로 당긴다. 연결 행은 home_message CASCADE 로 사라지지만 file 행·디스크 파일은
   * 남으므로, 기존 FileCleanupService(만료 파일 1시간 주기 정리)가 치우게 한다. 갱신 행 수 반환.
   */
  public int expireSessionFiles(UUID sessionId) {
    return dsl.update(FILE)
        .set(FILE.EXPIRES_AT, OffsetDateTime.now())
        .where(
            FILE.ID.in(
                dsl.select(HOME_MESSAGE_ATTACHMENT.FILE_ID)
                    .from(HOME_MESSAGE_ATTACHMENT)
                    .join(HOME_MESSAGE)
                    .on(HOME_MESSAGE.ID.eq(HOME_MESSAGE_ATTACHMENT.MESSAGE_ID))
                    .where(HOME_MESSAGE.SESSION_ID.eq(sessionId))))
        .execute();
  }
}
