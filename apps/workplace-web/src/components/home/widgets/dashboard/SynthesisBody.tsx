// 대시보드 그리드 위젯 어댑터 — SynthesisLayer(카운트 스트립+지금 신경 쓸 일)를 registry Component
// 시그니처({ count? })에 맞춰 감싼다. count 는 이 위젯에 의미 없어 무시한다.
// previewData 는 SynthesisLayer 가 여러 하위 신호(이슈 마감·멘션·메일·일정·메시징)를 각자의
// TanStack Query 훅으로 합성하는 컨테이너라 단일 목데이터 주입 지점이 없어, 존재 시 실제 API 호출
// 없는 정적 안내만 렌더한다(위젯 추가 모달 프리뷰 전용).
import { SynthesisLayer } from '../../synthesis/SynthesisLayer'

export default function SynthesisBody({ previewData }: { count?: number; previewData?: unknown }) {
  if (previewData !== undefined) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        여러 신호(이슈·메일·대화)를 종합해 지금 신경 써야 할 일을 요약해 보여줍니다.
      </p>
    )
  }
  return <SynthesisLayer />
}
