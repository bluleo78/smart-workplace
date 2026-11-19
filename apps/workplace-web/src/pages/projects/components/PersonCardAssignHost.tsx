// 사람 카드 「일 맡기기」 자리(WP-1767·WP-1768) — AI 카드의 「일 맡기기」가 그 AI 를 골라 둔 새 이슈 창을 연다.
// - projectKey 있음: 이슈 상세(코멘트·담당자·보고자·이슈 챗) — 그 이슈의 프로젝트로 고정. 더 가까운 Provider 라 전역 호스트를 덮는다.
// - projectKey 없음: 앱 전역(AppLayout) — 채팅·노트처럼 프로젝트가 정해지지 않은 곳. 창 맨 위 「프로젝트」 칸에서 고른다.
//   hintProjectKey 가 있으면(프로젝트 화면 안) 그 프로젝트를 처음 값으로 고르되, 칸은 그대로 두어 바꿀 수 있다.
// 창은 화면에 하나만 두고 처리기를 컨텍스트로 내려 준다 — 카드마다 창을 두면 카드가 닫힐 때 창도 함께 사라진다.
import { Component, type ComponentType, lazy, type ReactNode, Suspense, useCallback, useState } from 'react';
import { useMatch } from 'react-router-dom';
import { toast } from 'sonner';

import { PersonCardAssignContext } from '@/components/users/personCard/PersonCardAssignContext';

import type { IssueCreateDialog as IssueCreateDialogType } from './IssueCreateDialog';

type DialogComponent = ComponentType<Parameters<typeof IssueCreateDialogType>[0]>;

/** 창 묶음(지연 import) 로드 실패 표시 — 이 오류만 아래 경계가 토스트로 바꾼다. 원래 오류는 cause 로 남긴다. */
class AssignDialogLoadError extends Error {
  constructor(cause: unknown) {
    super('새 이슈 창 묶음을 불러오지 못했습니다', { cause });
    this.name = 'AssignDialogLoadError';
  }
}

// 창은 처음 맡길 때 불러온다 — 전역 호스트가 앱 셸(AppLayout)에 있어 정적으로 들이면 이슈 만들기 폼 전체가 셸 묶음에 실린다.
// lazy 는 실패한 import 결과를 기억해 같은 오류를 계속 던지므로, 실패하면 새 lazy 를 만들어 다음 클릭이 다시 불러오게 한다.
// import 실패만 AssignDialogLoadError 로 감싸 표시한다 — 오류 경계가 묶음 로드 실패와 창 안 렌더 오류를 가르는 표시다.
function loadDialog(): DialogComponent {
  return lazy(() =>
    import('./IssueCreateDialog').then(
      (m) => ({ default: m.IssueCreateDialog }),
      (cause: unknown) => {
        throw new AssignDialogLoadError(cause);
      },
    ),
  );
}

/** 창 묶음을 못 불러왔을 때 알릴 문구 — 배포 뒤 옛 묶음 이름(hash)을 찾는 경우가 대부분이라 새로고침을 권한다. */
const ASSIGN_DIALOG_LOAD_ERROR = '새 이슈 창을 열지 못했습니다 — 새로고침해 주세요';
/** 창 안에서 그리다 오류가 났을 때 알릴 문구 — 창만 닫고 앱 셸은 그대로 둔다. 새로고침이 아니라 다시 열기를 권한다. */
const ASSIGN_DIALOG_RENDER_ERROR = '새 이슈 창에 문제가 생겨 닫았습니다 — 다시 열어 주세요';

/** 브라우저·번들러가 지연 묶음을 못 받았을 때 내는 오류 문구(Chrome·Firefox·Safari·webpack 류). */
const CHUNK_LOAD_MESSAGE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (CSS )?chunk .* failed/i;

/**
 * 창 묶음 로드 실패인가 — loadDialog 가 감싼 오류, 또는 감싸기 전에 경계로 온 청크 실패 모양(ChunkLoadError 이름·브라우저 문구).
 * 이 경우만 새로고침을 권한다(새 배포의 묶음 이름을 받아야 낫는다).
 */
function isDialogLoadError(error: unknown): boolean {
  if (error instanceof AssignDialogLoadError) return true;
  if (!(error instanceof Error)) return false;
  return error.name === 'ChunkLoadError' || CHUNK_LOAD_MESSAGE.test(error.message);
}

/**
 * 지연 창 전용 오류 경계 — 창의 오류가 앱 전체 PageErrorBoundary 로 올라가 셸을 통째로 오류 화면으로 바꾸지 않게 여기서 멈춘다.
 * 어떤 오류든 창 자리를 비우고(아무것도 그리지 않음) 호스트에 알린다 — 로드 실패면 onLoadError(새로고침 토스트·새 lazy),
 * 그 밖의 렌더 오류면 onRenderError(창 닫힘 토스트). 렌더 오류는 버그라 console.error 로 남긴다(토스트만으로는 원인이 사라진다).
 */
class AssignDialogBoundary extends Component<
  { onLoadError: () => void; onRenderError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  /** 오류가 나면 창 자리를 비운다. */
  static getDerivedStateFromError() {
    return { failed: true };
  }

  /** 오류 종류에 따라 호스트에 알린다 — 호스트가 창을 내리면(agentId 비움) 이 경계도 함께 걷혀 다음 클릭은 새로 시작한다. */
  componentDidCatch(error: unknown) {
    if (isDialogLoadError(error)) {
      this.props.onLoadError();
      return;
    }
    console.error('새 이슈 창 렌더 오류', error);
    this.props.onRenderError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function PersonCardAssignHost({
  projectKey,
  hintProjectKey,
  children,
}: {
  /** 팀 프로젝트 키 — 개인 프로젝트 이슈는 상세 화면이 프로젝트 화면으로 돌려보내 여기 오지 않는다. 없으면 창 안에서 프로젝트를 고른다. */
  projectKey?: string;
  /** 프로젝트를 고르는 창(projectKey 없음)의 처음 값 — 지금 보고 있는 프로젝트. 고를 수 없는 프로젝트(개인 등)면 창이 목록 첫 프로젝트로 떨어진다. */
  hintProjectKey?: string;
  children: ReactNode;
}) {
  // 열림과 맡길 AI 를 한 상태로 — 창의 훅은 열리는 순간의 initialAgentId 를 읽으므로 둘을 같은 갱신에서 바꾼다.
  const [state, setState] = useState<{ open: boolean; agentId?: number }>({ open: false });
  const assign = useCallback((agentId: number) => setState({ open: true, agentId }), []);
  // 지연 창 — 로드가 실패하면 새로 만든다(위 loadDialog 설명).
  const [Dialog, setDialog] = useState<DialogComponent>(loadDialog);
  // 로드 실패 — 알리고, 창을 내려(agentId 비움) 오류 경계도 함께 걷어 다음 클릭이 처음부터 다시 불러오게 한다.
  const handleLoadError = useCallback(() => {
    toast.error(ASSIGN_DIALOG_LOAD_ERROR);
    setDialog(() => loadDialog());
    setState({ open: false });
  }, []);
  // 창 안 렌더 오류 — 창만 내리고(입력은 사라진다) 알린다. 묶음은 이미 받아 두었으니 lazy 는 그대로 쓴다.
  const handleRenderError = useCallback(() => {
    toast.error(ASSIGN_DIALOG_RENDER_ERROR);
    setState({ open: false });
  }, []);

  return (
    <PersonCardAssignContext.Provider value={assign}>
      {children}
      {/* 한 번도 맡기지 않았으면 창을 그리지 않는다 — 닫힌 창의 훅이 유형·멤버를 미리 받지 않게. */}
      {state.agentId !== undefined && (
        <AssignDialogBoundary onLoadError={handleLoadError} onRenderError={handleRenderError}>
          <Suspense fallback={null}>
            <Dialog
              projectKey={projectKey ?? hintProjectKey ?? ''}
              selectProject={projectKey === undefined}
              open={state.open}
              // 닫을 때 agentId 는 남겨 둔다 — 닫힘 애니메이션 동안 창 내용이 바뀌지 않게. 다음에 열 때 새 값으로 덮는다.
              onOpenChange={(open) => setState((s) => ({ ...s, open }))}
              initialAgentId={state.agentId}
            />
          </Suspense>
        </AssignDialogBoundary>
      )}
    </PersonCardAssignContext.Provider>
  );
}

/**
 * 앱 셸(AppLayout)의 전역 호스트(WP-1768) — 지금 프로젝트 화면(/projects/:key/...) 안이면 그 키를 창의 처음 값(힌트)으로 준다.
 * 고정(projectKey)이 아니라 힌트라 프로젝트 칸은 그대로 남아 바꿀 수 있다. 이슈 상세는 자기 호스트(고정)로 덮는다.
 */
export function GlobalPersonCardAssignHost({ children }: { children: ReactNode }) {
  const currentProjectKey = useMatch('/projects/:key/*')?.params.key;
  return <PersonCardAssignHost hintProjectKey={currentProjectKey}>{children}</PersonCardAssignHost>;
}
