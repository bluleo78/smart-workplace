// 대시보드 그리드 위젯 어댑터 — SynthesisLayer(카운트 스트립+지금 신경 쓸 일)를 registry Component
// 시그니처({ count? })에 맞춰 감싼다. count 는 이 위젯에 의미 없어 무시한다.
import { SynthesisLayer } from '../../synthesis/SynthesisLayer'

export default function SynthesisBody() {
  return <SynthesisLayer />
}
