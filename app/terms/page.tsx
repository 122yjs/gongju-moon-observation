import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-space-950 px-5 py-10 text-slate-100">
      <article className="mx-auto max-w-3xl rounded-3xl border border-space-700 bg-space-800 p-6 shadow-card sm:p-8">
        <p className="text-xs font-bold text-amber-300">공주 달 관찰 탐험대</p>
        <h1 className="mt-1 text-3xl font-black">서비스 이용 안내</h1>
        <p className="mt-5 text-sm leading-7 text-slate-300">이 서비스는 학교 과학 관찰 활동을 돕기 위한 수업용 도구입니다. 교사는 학생과 보호자에게 활동 목적, 제출 범위, 보관 기간을 안내하고 필요한 학교 내부 절차를 확인해야 합니다.</p>
        <h2 className="mt-7 text-xl font-black">교사의 책임</h2>
        <p className="mt-2 text-sm leading-7 text-slate-300">교사는 학생 QR을 적절히 관리하고, 제출된 사진과 기록을 본인의 Google Drive에서 확인·정리하며, 불필요해진 자료를 삭제합니다. 얼굴·주소·차량 번호 등 불필요한 개인정보가 포함되지 않도록 학생에게 촬영 지침을 안내해야 합니다.</p>
        <h2 className="mt-7 text-xl font-black">서비스 제한</h2>
        <p className="mt-2 text-sm leading-7 text-slate-300">Google 계정 정책, 학교 Workspace 관리자 정책, Google Drive 저장공간, 네트워크 장애 또는 외부 API 상태에 따라 일부 기능을 이용하지 못할 수 있습니다.</p>
        <h2 className="mt-7 text-xl font-black">금지 행위</h2>
        <p className="mt-2 text-sm leading-7 text-slate-300">수업 목적과 무관한 자료 업로드, 타인의 학생 QR 무단 공유, 자동화된 대량 요청, 다른 사람의 이름을 도용한 제출은 허용되지 않습니다.</p>
        <div className="mt-8 flex gap-3"><Link href="/" className="rounded-xl bg-amber-500 px-5 py-3 font-black text-space-950">학생 화면</Link><Link href="/privacy" className="rounded-xl border border-space-600 px-5 py-3 font-bold">개인정보 안내</Link></div>
      </article>
    </main>
  );
}
