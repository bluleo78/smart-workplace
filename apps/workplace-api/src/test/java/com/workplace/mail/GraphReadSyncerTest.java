package com.workplace.mail;

import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.ReadSyncLocator;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.service.GraphReadSyncer;
import com.workplace.mail.service.GraphTokenService;
import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/** GraphReadSyncer — providerMessageId 로 PATCH isRead:true 를 호출하는지. */
class GraphReadSyncerTest extends IntegrationTestBase {

  @Autowired GraphReadSyncer syncer;
  @MockitoBean GraphApiClient graphApiClient;
  @MockitoBean GraphTokenService graphTokenService;

  @Test
  void markReadOnServer_patchesIsRead() {
    when(graphTokenService.getAccessToken(1L, 10L)).thenReturn("FAKE_TOKEN");
    ReadSyncLocator loc =
        new ReadSyncLocator(10L, MailProvider.M365_GRAPH, "AAGRAPHID", null, null);

    syncer.markReadOnServer(1L, /* account */ null, loc); // account 미사용(Graph 는 token 만)

    verify(graphApiClient)
        .patch(eq("FAKE_TOKEN"), eq("/me/messages/AAGRAPHID"), contains("\"isRead\":true"));
  }
}
