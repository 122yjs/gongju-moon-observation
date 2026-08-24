"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import Link from "next/link";

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
}

interface PageResult {
  items: Observation[];
  hasMore: boolean;
  nextCursor: string | null;
  message?: string;
}

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<Observation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [joinUrl, setJoinUrl] = useState("");
  const [classLabel, setClassLabel] = useState("4학년 1반");

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
      const records = (await recordsResponse.json()) as PageResult;
      const invite = (await inviteResponse.json()) as { joinUrl?: string; classLabel?: string; message?: string };
      if (!recordsResponse.ok) throw new Error(records.message || "관찰 기록을 불러오지 못했습니다.");
      if (!inviteResponse.ok) throw new Error(invite.message || "수업 링크를 불러오지 못했습니다.");
      setItems((current) => append ? [...current, ...records.items] : records.items);
      setCursor(records.nextCursor);
      setHasMore(records.hasMore);
      setJoinUrl(invite.joinUrl || "");
      setClassLabel(invite.classLabel || "4학년 1반");
      setAuthenticated(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "자료를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/admin/session", { credentials: "same-origin" })
      .then((response) => response.json())
      .then((result: { authenticated?: boolean }) => {
        const signedIn = Boolean(result.authenticated);
        setAuthenticated(signedIn);
        if (signedIn) void loadData();
      })
      .catch(() => setAuthenticated(false));
  }, [loadData]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(result.message || "로그인하지 못했습니다.");
      setPassword("");
      setAuthenticated(true);
      await loadData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "로그인하지 못했습니다.");
    } finally {
      setLoading(false);
    }
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
    if (!response.ok) {
      setMessage(result.message || "공개 상태를 바꾸지 못했습니다.");
      return;
    }
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status } : entry));
  }

  async function remove(item: Observation) {
    if (!window.confirm(`${item.studentNumber}번 ${item.studentName} 학생의 기록을 완전히 삭제할까요?`)) return;
    const response = await fetch(`/api/admin/observations/${item.id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    const result = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      setMessage(result.message || "기록을 삭제하지 못했습니다.");
      return;
    }
    setItems((current) => current.filter((entry) => entry.id !== item.id));
  }

  async function signOut() {
    await fetch("/api/admin/session", { method: "DELETE", credentials: "same-origin" });
    setAuthenticated(false);
    setItems([]);
    setJoinUrl("");
  }

  if (authenticated === null) {
    return <main className="grid min-h-screen place-items-center bg-space-950 text-amber-300">관리 화면을 준비하고 있어요…</main>;
  }

  if (!authenticated) {
    return (
      <main className="grid min-h-screen place-items-center bg-space-950 px-5 text-slate-100">
        <form onSubmit={signIn} className="w-full max-w-md rounded-3xl border border-space-700 bg-space-800 p-7 shadow-card">
          <p className="text-xs font-bold text-amber-300">교사용 관리</p>
          <h1 className="mt-1 text-2xl font-black">관찰 기록 관리</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">학생 전체 이름과 사진은 교사 로그인 후에만 표시됩니다.</p>
          <label className="mt-6 block text-sm font-bold">관리 비밀번호
            <input
              type="password"
              autoComplete="current-password"
              required
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-xl border border-space-600 bg-space-900 px-4 py-3 text-white"
            />
          </label>
          {message ? <p className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-200" role="alert">{message}</p> : null}
          <button disabled={loading} className="mt-5 w-full rounded-xl bg-amber-500 px-5 py-3 font-black text-space-950 disabled:opacity-60">
            {loading ? "확인 중…" : "교사 로그인"}
          </button>
          <Link href="/" className="mt-4 block text-center text-sm font-bold text-slate-400 hover:text-amber-300">학생 화면으로 돌아가기</Link>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-space-950 px-4 py-7 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-amber-300">교사용 관리 · {classLabel}</p>
            <h1 className="mt-1 text-2xl font-black">달 관찰 기록</h1>
          </div>
          <div className="flex gap-2">
            <Link href="/" className="rounded-xl border border-space-600 bg-space-800 px-4 py-2 text-sm font-bold">학생 화면</Link>
            <button onClick={signOut} className="rounded-xl border border-space-600 bg-space-800 px-4 py-2 text-sm font-bold">로그아웃</button>
          </div>
        </header>

        {joinUrl ? (
          <section className="grid gap-5 rounded-3xl border border-blue-400/20 bg-space-800 p-5 shadow-card sm:grid-cols-[180px_1fr] sm:p-6">
            <div className="mx-auto rounded-2xl bg-white p-3">
              <QRCodeSVG value={joinUrl} size={156} level="M" title={`${classLabel} 수업 참여 QR`} />
            </div>
            <div className="min-w-0 self-center">
              <p className="text-xs font-bold text-blue-300">학생 수업 참여 QR</p>
              <h2 className="mt-1 text-xl font-black">학생에게 이 QR만 안내하세요</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">QR을 촬영하면 계정 로그인 없이 이 기기에서 7일 동안 제출과 갤러리를 이용할 수 있습니다.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => navigator.clipboard.writeText(joinUrl)} className="rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-black text-white">참여 링크 복사</button>
                <a href={joinUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-space-600 px-4 py-2.5 text-sm font-bold">링크 확인</a>
              </div>
            </div>
          </section>
        ) : null}

        <section className="rounded-3xl border border-space-700 bg-space-800 p-5 shadow-card sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-amber-300">전체 이름은 이 화면에서만 확인됩니다</p>
              <h2 className="mt-1 text-xl font-black">제출된 기록 {items.length}건</h2>
            </div>
            <button onClick={() => loadData()} disabled={loading} className="rounded-xl border border-space-600 px-4 py-2 text-sm font-bold disabled:opacity-60">↻ 새로고침</button>
          </div>
          {message ? <p className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-200" role="alert">{message}</p> : null}
          {items.length === 0 && !loading ? <p className="mt-8 text-center text-sm text-slate-400">아직 제출된 기록이 없습니다.</p> : null}
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <article key={item.id} className={`overflow-hidden rounded-2xl border bg-space-900 ${item.status === "visible" ? "border-space-600" : "border-red-400/30 opacity-70"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.imageUrl} alt={`${item.studentNumber}번 ${item.studentName} 학생의 달 관찰 사진`} className="h-48 w-full object-cover" loading="lazy" />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-black">{item.studentNumber}번 {item.studentName}</h3>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${item.status === "visible" ? "bg-emerald-400/10 text-emerald-300" : "bg-red-400/10 text-red-300"}`}>
                      {item.status === "visible" ? "공개" : "숨김"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">관찰 {item.observedAt.replace("T", " ")}</p>
                  {item.memo ? <p className="mt-3 rounded-xl bg-space-800 p-3 text-sm leading-6 text-slate-300">{item.memo}</p> : null}
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button onClick={() => updateStatus(item)} className="rounded-xl border border-space-600 px-3 py-2 text-sm font-bold">
                      {item.status === "visible" ? "갤러리에서 숨김" : "다시 공개"}
                    </button>
                    <button onClick={() => remove(item)} className="rounded-xl border border-red-400/30 px-3 py-2 text-sm font-bold text-red-300">완전 삭제</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          {hasMore && cursor ? (
            <div className="mt-6 text-center">
              <button onClick={() => loadData(cursor, true)} disabled={loading} className="rounded-xl bg-amber-500 px-5 py-3 font-black text-space-950 disabled:opacity-60">기록 더 보기</button>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
