// 메일 읽기 자리 슬롯(WP-1743) — 작성창을 「읽기 창으로」 옮길 자리와, 그동안 메일 상세를 감추는 래퍼를 한데 둔다.
// 메일 화면(MailInboxPage)은 상세를 이 컴포넌트로 감싸기만 하고 작성 배치·작성 상태를 읽지 않는다 —
// 크기 전환마다 큰 메일 화면이 다시 그려지지 않게, 그 값을 구독하는 곳을 이 작은 컴포넌트로 좁힌다.

import type { ReactNode } from 'react';

import { useMailCompose, useMailComposeLayout } from './MailComposeContext';

/** 읽기 자리 슬롯 + 상세 감춤 래퍼. children 은 메일 상세(MessageDetailPanel). */
export function MailComposePaneSlot({ children }: { children: ReactNode }) {
  const { draft } = useMailCompose();
  const { size, registerSlot } = useMailComposeLayout();
  return (
    <>
      {/* 슬롯 — display: contents 라 레이아웃에 끼지 않고, 그 안의 작성창 패널이 읽기 자리 박스를 그대로 채운다.
          ref 로 등록하므로 마운트 때 등록되고 언마운트(라우트 이탈) 때 React 가 null 을 넘겨 비운다.
          슬롯은 메일 화면에 있는 한 늘 등록해 둔다 — 「읽기 창으로」 단추가 슬롯 유무로 메일 화면인 판정을 하기 때문이다.
          슬롯이 사라지면 도크가 호스트를 주차 칸으로 되돌린다. */}
      <div style={{ display: 'contents' }} data-testid="mail-compose-pane-slot" ref={registerSlot} />
      {/* 읽기 창 작성 중 — 메일 상세와 빈 안내 문구를 감춘다(그 자리는 작성창이 차지). 작성이 닫히면 곧바로 되돌린다.
          언마운트하지 않고 hidden 속성(Tailwind preflight 가 display:none !important)으로만 감춰 스크롤·원본 배경 같은 상세 상태가 남는다.
          보일 땐 display:contents 라 감싼 div 가 상세 레이아웃(flex·높이)에 끼지 않는다. */}
      <div className="contents" hidden={size === 'pane' && draft != null}>
        {children}
      </div>
    </>
  );
}
