import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-space-950 px-5 py-10 text-slate-100">
      <article className="mx-auto max-w-3xl rounded-3xl border border-space-700 bg-space-800 p-6 shadow-card sm:p-8">
        <p className="text-xs font-bold text-amber-300">공주 달 관찰 탐험대</p>
        <h1 className="mt-1 text-3xl font-black">개인정보 처리 안내</h1>
        <p className="mt-5 text-sm leading-7 text-slate-300">이 서비스는 교사가 연결한 Google Drive에 학생 관찰 자료를 수합하기 위한 중앙 웹앱입니다.</p>

        <h2 className="mt-7 text-xl font-black">Google Drive 권한</h2>
        <p className="mt-2 text-sm leading-7 text-slate-300">서비스는 <code className="rounded bg-space-900 px-1.5 py-1">drive.file</code> 권한만 요청합니다. 앱이 직접 만든 수업 폴더, 사진 파일, 제출 스프레드시트만 읽고 수정할 수 있으며 교사의 기존 Drive 전체를 열람하지 않습니다.</p>

        <h2 className="mt-7 text-xl font-black">학생 자료 저장 위치</h2>
        <p className="mt-2 text-sm leading-7 text-slate-300">학생 사진·번호·이름·관찰 시각·메모는 제출 처리 중 서버 메모리를 통과한 뒤 교사 소유 Google Drive와 Google Sheets에 저장됩니다. 중앙 D1 또는 R2에는 해당 내용을 장기 저장하지 않습니다.</p>

        <h2 className="mt-7 text-xl font-black">중앙 서비스에 보관하는 정보</h2>
        <p className="mt-2 text-sm leading-7 text-slate-300">교사 Google 계정 표시정보, 암호화된 OAuth 갱신 토큰, 앱이 만든 Drive 파일 ID, 학급명과 학생 초대 토큰을 보관합니다. 중복 제출 방지표는 최대 24시간, 속도 제한 기록은 최대 1시간, 이미지 전달용 파일 표는 최대 30분 동안만 유지됩니다.</p>

        <h2 className="mt-7 text-xl font-black">연결 해제와 삭제</h2>
        <p className="mt-2 text-sm leading-7 text-slate-300">교사는 관리 화면에서 언제든 연결을 해제할 수 있습니다. 이때 중앙 연결정보와 토큰은 삭제되고 Google 권한은 폐기됩니다. 교사 Drive의 수업 폴더와 학생 자료는 교사가 계속 소유하며 직접 보관하거나 삭제할 수 있습니다.</p>

        <h2 className="mt-7 text-xl font-black">보호 조치</h2>
        <p className="mt-2 text-sm leading-7 text-slate-300">OAuth 토큰과 클라이언트 보안 비밀번호는 서버에서 AES-GCM 방식으로 암호화합니다. 학생·교사 세션은 서명된 HttpOnly·Secure 쿠키를 사용하며, 제출 사진은 위치정보 등 메타데이터를 제거한 뒤 전송합니다.</p>

        <div className="mt-8 flex flex-wrap gap-3"><Link href="/" className="rounded-xl bg-amber-500 px-5 py-3 font-black text-space-950">학생 화면</Link><Link href="/admin" className="rounded-xl border border-space-600 px-5 py-3 font-bold">교사 화면</Link><Link href="/data-deletion" className="rounded-xl border border-space-600 px-5 py-3 font-bold">자료 삭제 안내</Link></div>
      </article>
    </main>
  );
}
