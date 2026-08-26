import Link from "next/link";

export default function DataDeletionPage() {
  return (
    <main className="min-h-screen bg-space-950 px-5 py-10 text-slate-100">
      <article className="mx-auto max-w-3xl rounded-3xl border border-space-700 bg-space-800 p-6 shadow-card sm:p-8">
        <p className="text-xs font-bold text-amber-300">달 관찰 탐험대</p>
        <h1 className="mt-1 text-3xl font-black">연결 및 자료 삭제 안내</h1>
        <h2 className="mt-7 text-xl font-black">교사 Google 연결 삭제</h2>
        <p className="mt-2 text-sm leading-7 text-slate-300">교사 관리 화면에서 <strong>Drive 연결 해제</strong>를 선택하면 중앙 D1의 교사 연결정보·암호화 토큰·학생 QR 설정이 삭제되고 Google OAuth 토큰이 폐기됩니다.</p>
        <h2 className="mt-7 text-xl font-black">학생 사진과 제출 기록 삭제</h2>
        <p className="mt-2 text-sm leading-7 text-slate-300">학생 자료는 교사 Google Drive의 ‘달 관찰 탐험대’ 폴더에 있습니다. 교사는 관리 화면에서 개별 기록을 삭제하거나 Google Drive에서 수업 폴더를 직접 삭제할 수 있습니다.</p>
        <h2 className="mt-7 text-xl font-black">중앙 임시 기록</h2>
        <p className="mt-2 text-sm leading-7 text-slate-300">중복 방지·속도 제한·이미지 전달을 위한 임시 식별표에는 학생 이름·메모·사진이 없으며 각각 최대 24시간, 1시간, 30분 후 정리됩니다. 교사 연결을 해제하면 해당 교사와 연결된 임시 식별표도 즉시 삭제됩니다.</p>
        <div className="mt-8 flex gap-3"><Link href="/admin" className="rounded-xl bg-amber-500 px-5 py-3 font-black text-space-950">교사 관리 화면</Link><Link href="/privacy" className="rounded-xl border border-space-600 px-5 py-3 font-bold">개인정보 안내</Link></div>
      </article>
    </main>
  );
}
