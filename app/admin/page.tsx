"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

interface Observation {
  id: string;
  studentNumber: number;
  studentName: string;
  observedAt: string;
  memo: string;
  imageBytes: number;
  status: "visible" | "hidden";
  createdAt: string;
  imageUrl: string;
  driveUrl: string;
}

interface ClassInfo {
  id: string;
  classLabel: string;
  joinUrl: string;
  rootFolderUrl: string;
  spreadsheetUrl: string;
  createdAt: string;
  updatedAt: string;
}

interface InviteInfo {
  joinUrl: string;
  activeClassId: string;
  classLabel: string;
  googleEmail: string;
  googleDisplayName: string;
  rootFolderUrl: string;
  spreadsheetUrl: string;
  sessionDays: number;
  classes: ClassInfo[];
}

interface PageResult {
  items: Observation[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
  message?: string;
}

function HelpTip({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        className="grid size-7 place-items-center rounded-full border border-space-600 bg-space-900 text-xs font-black text-slate-400 hover:border-amber-400/50 hover:text-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
      >
        ?
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute right-0 top-full z-20 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-space-600 bg-space-900 p-3 text-left text-xs font-medium leading-5 text-slate-200 shadow-card ${open ? "block" : "hidden"}`}
      >
        {label}
      </span>
    </span>
  );
}

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [items, setItems] = useState<Observation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("error") || "",
  );
  const [classLabel, setClassLabel] = useState("우리 반");
  const [newClassLabel, setNewClassLabel] = useState("");
  const [qrClassId, setQrClassId] = useState<string | null>(null);

  const loadData = useCallback(async (nextCursor: string | null = null, append = false) => {
    setLoading(true);
    try {
      const query = nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : "";
      const [recordsResponse, inviteResponse] = await Promise.all([
        fetch(`/api/admin/observations${query}`, { credentials: "same-origin" }),
        fetch("/api/admin/invite", { credentials: "same-origin" }),
      ]);
      if (recordsResponse.status === 401 || inviteResponse.status === 401) {
        setAuthenticated(false);
        return;
      }
      const records = (await recordsResponse.json().catch(() => ({}))) as PageResult;
      const inviteResult = (await inviteResponse.json().catch(() => ({}))) as InviteInfo & { message?: string };
      if (!recordsResponse.ok) throw new Error(records.message || "관찰 기록을 불러오지 못했습니다.");
      if (!inviteResponse.ok) throw new Error(inviteResult.message || "수업 링크를 불러오지 못했습니다.");
      setItems((current) => (append ? [...current, ...records.items] : records.items));
      setCursor(records.nextCursor);
      setHasMore(records.hasMore);
      setInvite(inviteResult);
      setClassLabel(inviteResult.classLabel);
      setQrClassId((current) =>
        current && inviteResult.classes.some((teacherClass) => teacherClass.id === current)
          ? current
          : inviteResult.activeClassId,
      );
      setAuthenticated(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "자료를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/admin/session", { credentials: "same-origin" })
      .then(async (response) => {
        const result = (await response.json()) as { authenticated?: boolean };
        const signedIn = Boolean(result.authenticated);
        setAuthenticated(signedIn);
        if (signedIn) await loadData();
      })
      .catch(() => setAuthenticated(false));
  }, [loadData]);

  async function saveClassLabel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/admin/settings", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classLabel }),
    });
    const result = (await response.json().catch(() => ({}))) as { classLabel?: string; message?: string };
    if (!response.ok) return setMessage(result.message || "학급명을 저장하지 못했습니다.");
    setClassLabel(result.classLabel || classLabel);
    setInvite((current) => current ? {
      ...current,
      classLabel: result.classLabel || classLabel,
      classes: current.classes.map((teacherClass) => teacherClass.id === current.activeClassId
        ? { ...teacherClass, classLabel: result.classLabel || classLabel }
        : teacherClass),
    } : current);
    setMessage("학급명을 저장했습니다.");
  }

  async function rotateInvite() {
    const selectedClass = invite?.classes.find((teacherClass) => teacherClass.id === qrClassId)
      || invite?.classes.find((teacherClass) => teacherClass.id === invite.activeClassId);
    if (!selectedClass) return setMessage("QR을 만들 반을 먼저 선택해 주세요.");
    if (!window.confirm(`${selectedClass.classLabel}의 기존 학생 QR을 즉시 사용할 수 없게 하고 새 QR을 만들까요?`)) return;
    const response = await fetch("/api/admin/invite", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: selectedClass.id }),
    });
    const result = (await response.json().catch(() => ({}))) as InviteInfo & { message?: string };
    if (!response.ok) return setMessage(result.message || "새 수업 링크를 만들지 못했습니다.");
    setInvite(result);
    setQrClassId(selectedClass.id);
    setMessage(`${selectedClass.classLabel}의 새 학생 QR을 만들었습니다.`);
  }

  async function copyQrUrl() {
    const selectedClass = invite?.classes.find((teacherClass) => teacherClass.id === qrClassId)
      || invite?.classes.find((teacherClass) => teacherClass.id === invite.activeClassId);
    if (!selectedClass?.joinUrl) return setMessage("복사할 학생용 주소가 없습니다.");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(selectedClass.joinUrl);
      setMessage(`${selectedClass.classLabel} 학생용 주소를 복사했습니다.`);
    } catch {
      window.prompt("학생에게 보낼 주소입니다. 복사해 주세요.", selectedClass.joinUrl);
      setMessage("브라우저가 자동 복사를 막았습니다. 열린 창에서 주소를 복사해 주세요.");
    }
  }

  async function switchClass(classId: string) {
    if (classId === invite?.activeClassId) return;
    const response = await fetch("/api/admin/classes", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId }),
    });
    const result = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) return setMessage(result.message || "반을 전환하지 못했습니다.");
    setItems([]);
    setCursor(null);
    setHasMore(false);
    await loadData();
    setQrClassId(classId);
    setMessage("반을 전환했습니다.");
  }

  async function createClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/admin/classes", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classLabel: newClassLabel }),
    });
    const result = (await response.json().catch(() => ({}))) as { activeClassId?: string; message?: string };
    if (!response.ok) return setMessage(result.message || "새 반을 만들지 못했습니다.");
    setNewClassLabel("");
    setItems([]);
    setCursor(null);
    setHasMore(false);
    await loadData();
    setQrClassId(result.activeClassId || null);
    setMessage("새 반을 만들었습니다.");
  }

  async function deleteClass(teacherClass: ClassInfo) {
    if ((invite?.classes.length || 0) <= 1) {
      return setMessage("마지막 반은 삭제할 수 없습니다. 전체 해제는 Drive 연결 해제를 사용해 주세요.");
    }
    if (!window.confirm(`${teacherClass.classLabel} 반을 삭제할까요?\n\nDrive 폴더, 사진 파일, 제출 목록도 함께 삭제됩니다. 이 작업은 되돌리기 어렵습니다.`)) return;
    const response = await fetch("/api/admin/classes", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId: teacherClass.id }),
    });
    const result = (await response.json().catch(() => ({}))) as { activeClassId?: string; message?: string };
    if (!response.ok) return setMessage(result.message || "반을 삭제하지 못했습니다.");
    setItems([]);
    setCursor(null);
    setHasMore(false);
    await loadData();
    setQrClassId(result.activeClassId || null);
    setMessage(`${teacherClass.classLabel} 반과 Drive 자료를 삭제했습니다.`);
  }

  async function updateStatus(item: Observation) {
    const status = item.status === "visible" ? "hidden" : "visible";
    const response = await fetch(`/api/admin/observations/${item.id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const result = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) return setMessage(result.message || "공개 상태를 바꾸지 못했습니다.");
    setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, status } : entry)));
  }

  async function remove(item: Observation) {
    if (!window.confirm(`${item.studentNumber}번 ${item.studentName} 학생의 Drive 사진과 제출 행을 완전히 삭제할까요?`)) return;
    const response = await fetch(`/api/admin/observations/${item.id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    const result = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) return setMessage(result.message || "기록을 삭제하지 못했습니다.");
    setItems((current) => current.filter((entry) => entry.id !== item.id));
  }

  async function signOut() {
    await fetch("/api/admin/session", { method: "DELETE", credentials: "same-origin" });
    setAuthenticated(false);
    setItems([]);
    setInvite(null);
    setQrClassId(null);
  }

  async function disconnect() {
    if (!window.confirm("이 Google 계정의 모든 반 연결을 중앙 서비스에서 해제할까요? Drive의 각 반 사진과 제출 목록은 삭제되지 않습니다.")) return;
    const response = await fetch("/api/google/disconnect", { method: "DELETE", credentials: "same-origin" });
    const result = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) return setMessage(result.message || "연결을 해제하지 못했습니다.");
    setAuthenticated(false);
    setInvite(null);
    setItems([]);
    setQrClassId(null);
    setMessage(result.message || "연결을 해제했습니다.");
  }

  if (authenticated === null) {
    return <main className="grid min-h-screen place-items-center bg-space-950 text-amber-300">교사 화면을 준비하고 있어요…</main>;
  }

  if (!authenticated) {
    return (
      <main className="grid min-h-screen place-items-center bg-space-950 px-5 py-10 text-slate-100">
        <section className="w-full max-w-lg rounded-3xl border border-space-700 bg-space-800 p-7 shadow-card">
          <p className="text-xs font-bold text-amber-300">교사용 중앙 서비스</p>
          <h1 className="mt-1 text-2xl font-black">내 Google Drive에 제출함 만들기</h1>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            앱이 새로 만드는 수업 폴더·사진·스프레드시트만 관리합니다. 학생 사진·이름·메모는 중앙 D1이나 R2에 장기 저장하지 않습니다.
          </p>
          {message ? <p className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-200" role="alert">{message}</p> : null}
          <div className="mt-6 flex items-center gap-2">
            <a
              href="/api/google/start"
              title="교사 Google 계정을 연결해 반별 Drive 폴더와 학생 QR을 만들 수 있게 합니다."
              className="flex min-w-0 flex-1 items-center justify-center rounded-xl bg-amber-500 px-5 py-3.5 font-black text-space-950 hover:bg-amber-400"
            >
              Google Drive 연결하기
            </a>
            <HelpTip label="교사 Google 계정을 이 서비스에 연결합니다. 앱이 새로 만드는 반별 Drive 폴더와 제출 목록만 관리합니다." />
          </div>
          <Link href="/" className="mt-4 block text-center text-sm font-bold text-slate-400 hover:text-amber-300">학생 화면으로 돌아가기</Link>
          <Link href="/operator" className="mt-3 block text-center text-xs text-slate-600 hover:text-slate-400">서비스 운영 설정</Link>
        </section>
      </main>
    );
  }

  const selectedQrClass = invite?.classes.find((teacherClass) => teacherClass.id === qrClassId)
    || invite?.classes.find((teacherClass) => teacherClass.id === invite.activeClassId);

  return (
    <main className="min-h-screen bg-space-950 px-4 py-7 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-amber-300">교사용 관리 · {invite?.classLabel || classLabel}</p>
            <h1 className="mt-1 text-2xl font-black">Google Drive 달 관찰 제출함</h1>
            <p className="mt-1 text-xs text-slate-500">{invite?.googleDisplayName} {invite?.googleEmail ? `· ${invite.googleEmail}` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/" className="rounded-xl border border-space-600 bg-space-800 px-4 py-2 text-sm font-bold">학생 화면</Link>
            <span className="flex items-center gap-1">
              <button
                onClick={signOut}
                title="이 브라우저의 교사 로그인만 끝냅니다. Drive 연결과 반별 QR은 유지됩니다."
                className="rounded-xl border border-space-600 bg-space-800 px-4 py-2 text-sm font-bold"
              >
                로그아웃
              </button>
              <HelpTip label="이 브라우저의 교사 화면 세션만 종료합니다. Google 계정 연결과 반별 Drive/QR은 유지되며, 같은 계정으로 다시 연결하면 기존 반 목록으로 돌아옵니다." />
            </span>
            <span className="flex items-center gap-1">
              <button
                onClick={disconnect}
                title="중앙 서비스의 Google 토큰과 모든 반 연결을 해제합니다. Drive 자료는 삭제하지 않습니다."
                className="rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-2 text-sm font-bold text-red-200"
              >
                Drive 연결 해제
              </button>
              <HelpTip label="이 서비스의 Google Drive 생성/관리 권한을 해제합니다. 업로드된 파일과 반별 폴더·제출 목록은 Google Drive에 그대로 남습니다." />
            </span>
          </div>
        </header>

        {message ? <p className="rounded-xl border border-blue-400/25 bg-blue-400/10 p-3 text-sm text-blue-100" role="status">{message}</p> : null}

        <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <div className="space-y-5">
            <article className="rounded-3xl border border-space-700 bg-space-800 p-5 shadow-card">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black">반 선택</h2>
                <HelpTip label="관리 화면의 기록 조회와 학급 설정 기준을 바꿉니다. 학생에게 보낼 QR 선택은 아래 영역에서 따로 할 수 있습니다." />
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-400">같은 Google 계정 안에서 반마다 Drive 폴더와 제출 목록을 따로 씁니다.</p>
              <div className="mt-4 space-y-2">
                {(invite?.classes || []).map((teacherClass) => {
                  const active = teacherClass.id === invite?.activeClassId;
                  const canDelete = (invite?.classes.length || 0) > 1;
                  return (
                    <div
                      key={teacherClass.id}
                      className={`relative overflow-hidden rounded-xl border text-sm font-bold ${active ? "border-amber-400/50 bg-amber-400/10 text-amber-100" : "border-space-600 bg-space-900 text-slate-200"}`}
                    >
                      <button
                        type="button"
                        onClick={() => void switchClass(teacherClass.id)}
                        className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-3 pr-10 text-left hover:bg-amber-400/10"
                      >
                        <span className="min-w-0 truncate">{teacherClass.classLabel}</span>
                        <span className="shrink-0 text-xs text-slate-400">{active ? "현재 반" : "전환"}</span>
                      </button>
                      {canDelete ? (
                        <button
                          type="button"
                          onClick={() => void deleteClass(teacherClass)}
                          aria-label={`${teacherClass.classLabel} 반 삭제`}
                          title="이 반의 Drive 폴더, 사진 파일, 제출 목록을 삭제합니다."
                          className="absolute right-2 top-2 grid size-6 place-items-center rounded-full border border-red-400/25 bg-red-400/10 text-sm font-black leading-none text-red-200 hover:bg-red-400/20"
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <form onSubmit={createClass} className="mt-4 flex gap-2">
                <input
                  value={newClassLabel}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setNewClassLabel(event.target.value)}
                  maxLength={40}
                  placeholder="새 반 이름"
                  className="min-w-0 flex-1 rounded-xl border border-space-600 bg-space-900 px-4 py-3 text-sm"
                  aria-label="새 반 이름"
                />
                <span className="flex items-center gap-1">
                  <button disabled={!newClassLabel.trim() || loading} className="min-w-0 flex-1 rounded-xl bg-amber-500 px-4 py-3 text-sm font-black text-space-950 disabled:opacity-50">새 반 만들기</button>
                  <HelpTip label="새 Drive 폴더, 사진 폴더, 제출 목록, 학생용 QR을 가진 별도 반을 추가합니다." />
                </span>
              </form>
            </article>

            <article className="rounded-3xl border border-space-700 bg-space-800 p-5 shadow-card">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black">학생용 QR</h2>
                <HelpTip label="학생에게 나눠 줄 반별 입장 링크입니다. 현재 관리 중인 반과 다른 반의 QR도 선택해서 볼 수 있습니다." />
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-400">반을 고르면 그 반 학생용 QR을 바로 만들거나 다시 만들 수 있습니다.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {(invite?.classes || []).map((teacherClass) => {
                  const selected = teacherClass.id === selectedQrClass?.id;
                  return (
                    <button
                      key={teacherClass.id}
                      type="button"
                      onClick={() => setQrClassId(teacherClass.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold ${selected ? "border-amber-400/60 bg-amber-400/15 text-amber-100" : "border-space-600 bg-space-900 text-slate-300 hover:border-amber-400/50"}`}
                    >
                      {teacherClass.classLabel}
                    </button>
                  );
                })}
              </div>
              {selectedQrClass?.joinUrl ? (
                <div className="mt-5 rounded-2xl bg-white p-4 text-center">
                  <QRCodeSVG value={selectedQrClass.joinUrl} size={260} className="mx-auto h-auto max-w-full" />
                </div>
              ) : null}
              <p className="mt-3 text-center text-xs font-bold text-slate-400">{selectedQrClass?.classLabel || "반"} · {invite?.sessionDays || 60}일 유지</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  onClick={copyQrUrl}
                  disabled={!selectedQrClass?.joinUrl}
                  className="rounded-xl border border-space-600 bg-space-900 px-4 py-2.5 text-sm font-black text-slate-100 hover:border-amber-400 disabled:opacity-50"
                >
                  주소 복사
                </button>
                <span className="flex items-center gap-1">
                  <button onClick={rotateInvite} className="min-w-0 flex-1 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-sm font-black text-amber-200">선택한 반 새 QR 만들기</button>
                  <HelpTip label="선택한 반의 새 입장 주소를 만듭니다. 기존 QR 주소로는 새로 입장할 수 없지만, 이미 입장한 기기의 60일 학생 세션은 유지됩니다." />
                </span>
              </div>
            </article>
          </div>

          <article className="rounded-3xl border border-space-700 bg-space-800 p-5 shadow-card">
            <h2 className="text-lg font-black">저장 위치와 학급 설정</h2>
            <p className="mt-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm leading-6 text-emerald-100">
              학생 원본 자료는 교사 소유 Google Drive에만 장기 보관됩니다.
            </p>
            <form onSubmit={saveClassLabel} className="mt-5 flex flex-col gap-2 sm:flex-row">
              <input value={classLabel} onChange={(event: ChangeEvent<HTMLInputElement>) => setClassLabel(event.target.value)} maxLength={40} required className="min-w-0 flex-1 rounded-xl border border-space-600 bg-space-900 px-4 py-3" aria-label="학급명" />
              <span className="flex items-center gap-1">
                <button className="min-w-0 flex-1 rounded-xl bg-amber-500 px-5 py-3 font-black text-space-950">학급명 변경</button>
                <HelpTip label="현재 선택한 반의 화면 표시 이름만 바꿉니다. Drive 폴더, 제출 목록, 학생용 QR 주소는 그대로 유지됩니다." />
              </span>
            </form>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <a href={invite?.rootFolderUrl || "#"} target="_blank" rel="noreferrer" className="rounded-xl border border-space-600 bg-space-900 p-4 font-bold hover:border-amber-400">Google Drive 폴더 열기</a>
              <a href={invite?.spreadsheetUrl || "#"} target="_blank" rel="noreferrer" className="rounded-xl border border-space-600 bg-space-900 p-4 font-bold hover:border-amber-400">제출 목록 열기</a>
            </div>
          </article>
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-amber-300">교사 Drive에서 실시간 조회</p>
              <h2 className="mt-1 text-2xl font-black">관찰 기록 {items.length ? `(${items.length}${hasMore ? "+" : ""})` : ""}</h2>
            </div>
            <button onClick={() => void loadData()} disabled={loading} className="rounded-xl border border-space-600 bg-space-800 px-4 py-2.5 text-sm font-bold disabled:opacity-50">↻ 새로고침</button>
          </div>
          {!loading && items.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-space-600 bg-space-800/60 py-16 text-center text-slate-400">아직 제출된 사진이 없습니다.</div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <article key={item.id} className={`overflow-hidden rounded-2xl border bg-space-800 shadow-card ${item.status === "hidden" ? "border-red-400/30 opacity-70" : "border-space-700"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.imageUrl} alt={`${item.studentNumber}번 ${item.studentName} 달 관찰 사진`} className="h-56 w-full bg-space-900 object-cover" />
                <div className="p-4">
                  <div className="flex items-center justify-between gap-2"><h3 className="font-black">{item.studentNumber}번 {item.studentName}</h3><span className="text-xs text-slate-500">{Math.ceil(item.imageBytes / 1024)}KB</span></div>
                  <p className="mt-2 text-xs text-slate-400">{item.observedAt.replace("T", " ")}</p>
                  {item.memo ? <p className="mt-3 rounded-xl bg-space-900 p-3 text-sm leading-6 text-slate-300">{item.memo}</p> : null}
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs font-bold">
                    <button onClick={() => void updateStatus(item)} className="rounded-lg border border-space-600 px-2 py-2">{item.status === "visible" ? "숨기기" : "공개"}</button>
                    <a href={item.driveUrl || invite?.rootFolderUrl || "#"} target="_blank" rel="noreferrer" className="rounded-lg border border-space-600 px-2 py-2 text-center">Drive</a>
                    <button onClick={() => void remove(item)} className="rounded-lg border border-red-400/25 bg-red-400/10 px-2 py-2 text-red-200">삭제</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {hasMore ? <div className="mt-5 text-center"><button onClick={() => void loadData(cursor, true)} disabled={loading} className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-6 py-3 font-black text-amber-200">기록 더 보기</button></div> : null}
        </section>
      </div>
    </main>
  );
}
