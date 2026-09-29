package com.workplace.drive.service;

import static com.workplace.global.realtime.ResourceChangedEvent.OP_UPDATED;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.workplace.drive.outbound.DriveChangeNotifier;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/** WP-63 — 벌크 이동은 항목별 발행 없이 resource.changed 1건에 ids 를 묶어 보낸다(Mockito 단위). */
@ExtendWith(MockitoExtension.class)
@DisplayName("DriveBulkService 벌크 이동 발행 묶음")
class DriveBulkServiceNotifyTest {

  @Mock com.workplace.drive.repository.DriveFileRepository files;
  @Mock com.workplace.drive.repository.DriveFolderRepository folders;
  @Mock DrivePermissions perms;
  @Mock org.jooq.DSLContext dsl;
  @Mock com.workplace.audit.service.AuditLogService auditLogService;
  @Mock com.workplace.user.repository.UserRepository userRepository;
  @Mock DriveFileService fileService;
  @Mock DriveFolderService folderService;
  @Mock DriveChangeNotifier notifier;

  @InjectMocks DriveBulkService bulk;

  @Test
  @DisplayName("파일 2 + 폴더 1 bulkMove → 발행 1건(ids 3), 단건은 notify=false")
  void bulkMove_publishesOnceAndSilencesSingles() {
    long caller = 7L;
    long spaceId = 11L;
    stubFileSpace(1L, spaceId);
    stubFileSpace(2L, spaceId);
    stubFolderSpace(3L, spaceId);

    bulk.bulkMove(caller, spaceId, List.of(1L, 2L), List.of(3L), 99L);

    verify(notifier, times(1))
        .itemsChanged(eq(OP_UPDATED), eq(spaceId), argThat(ids -> ids.size() == 3), eq(caller));
    // 단건 경로는 발행을 끈 오버로드로만 호출된다 — 3-인자 공개 메서드(notify=true 위임)는 쓰지 않는다.
    verify(fileService, times(2)).move(eq(caller), anyLong(), eq(99L), eq(false));
    verify(folderService, times(1)).move(eq(caller), eq(3L), eq(99L), eq(false));
    verify(fileService, never()).move(anyLong(), anyLong(), any());
    verify(folderService, never()).move(anyLong(), anyLong(), any());
    verify(fileService, never()).move(anyLong(), anyLong(), any(), eq(true));
    verify(folderService, never()).move(anyLong(), anyLong(), any(), eq(true));
    // 공간 id 는 단건 move 반환값으로 얻는다 — 항목별 사전 조회(파일·폴더 리포지토리)는 하지 않는다.
    verifyNoInteractions(files, folders);
  }

  @Test
  @DisplayName("서로 다른 공간의 항목 bulkMove → 공간별 발행 2건")
  void bulkMove_publishesPerActualSpace() {
    long caller = 7L;
    stubFileSpace(1L, 11L);
    stubFileSpace(2L, 22L);
    stubFolderSpace(3L, 11L);

    bulk.bulkMove(caller, 11L, List.of(1L, 2L), List.of(3L), 99L);

    verify(notifier, times(1))
        .itemsChanged(eq(OP_UPDATED), eq(11L), argThat(ids -> ids.size() == 2), eq(caller));
    verify(notifier, times(1))
        .itemsChanged(eq(OP_UPDATED), eq(22L), argThat(ids -> ids.equals(List.of(2L))), eq(caller));
  }

  /** 단건 파일 move(notify=false) 가 해결한 공간 id 를 돌려주도록 스텁. */
  private void stubFileSpace(long fileId, long spaceId) {
    when(fileService.move(anyLong(), eq(fileId), any(), eq(false))).thenReturn(spaceId);
  }

  /** 단건 폴더 move(notify=false) 가 해결한 공간 id 를 돌려주도록 스텁. */
  private void stubFolderSpace(long folderId, long spaceId) {
    when(folderService.move(anyLong(), eq(folderId), any(), eq(false))).thenReturn(spaceId);
  }
}
