"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";

interface GoogleConfig {
  configured: boolean;
  clientId: string;
  updatedAt: string | null;
  redirectUri: string;
  scope: string;
}

interface LegacySummary {
  databaseRows: number;
  r2ObjectsPresent: boolean;
}

export default function OperatorPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [config, setConfig] = useState<GoogleConfig | null>(null);
  const [legacy, setLegacy] = useState<LegacySummary | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [configResponse, legacyResponse] = await Promise.all([
      fetch("/api/operator/google-config", { credentials: "same-origin" }),
      fetch("/api/operator/legacy-data", { credentials: "same-origin" }),
    ]);
    if (configResponse.status === 401 || legacyResponse.status === 401) {
      setAuthenticated(false);
      return;
    }
    const configResult = (await configResponse.json().catch(() => ({}))) as GoogleConfig & { message?: string };
    const legacyResult = (await legacyResponse.json().catch(() => ({}))) as LegacySummary & { message?: string };
    if (!configResponse.ok) throw new Error(configResult.message || "OAuth 설정을 불러오지 못했습니다.");
    if (!legacyResponse.ok) throw new Error(legacyResult.message || "기존 자료 상태를 확인하지 못했습니다.");
    setConfig(configResult);
    setClientId(configResult.clientId);
    setLegacy(legacyResult);
    setAuthenticated(true);
  }, []);

  useEffect(() => {
    fetch("/api/operator/session", { credentials: "same-origin" })
      .then((response) => response.json())
      .then(async (result: { authenticated?: boolean }) => {
        const signedIn = Boolean(result.authenticated);
        setAuthenticated(signedIn);
        if (signedIn) await load();
      })
      .catch(() => setAuthenticated(false));
  }, [load]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/operator/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(result.message || "로그인하지 못했습니다.");
      setPassword("");
      setAuthenticated(true);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "로그인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/operator/google-config", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret }),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(result.message || "OAuth 설정을 저장하지 못했습니다.");
      setClientSecret("");
      setMessage(result.message || "OAuth 설정을 저장했습니다.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "OAuth 설정을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function purgeLegacy() {
    if (!window.confirm("기존 중앙 D1 학생 기록과 R2 사진을 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
    setBusy(true);
    try {
      let complete = false;
      let deletedRows = 0;
      let deletedObjects = 0;
      for (let attempt = 0; attempt < 100 && !complete; attempt += 1) {
        const response = await fetch("/api/operator/legacy-data", { method: "DELETE", credentials: "same-origin" });
        const result = (await response.json().catch(() => ({}))) as {
          complete?: boolean;
          deletedRows?: number;
          deletedObjects?: number;
          remaining?: LegacySummary;
          message?: string;
        };
        if (!response.ok) throw new Error(result.message || "기존 자료를 삭제하지 못했습니다.");
        deletedRows += Number(result.deletedRows || 0);
        deletedObjects += Number(result.deletedObjects || 0);
        complete = Boolean(result.complete);
        if (result.remaining) setLegacy(result.remaining);
      }
      setMessage(`기존 중앙 자료 삭제 완료: D1 ${deletedRows}건, R2 ${deletedObjects}개`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "기존 자료를 삭제하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/operator/session", { method: "DELETE", credentials: "same-origin" });
    setAuthenticated(false);
    setConfig(null);
  }

  if (authenticated === null) return <main className="grid min-h-screen place-items-center bg-space-950 text-amber-300">운영 설정을 준비하고 있어요…</main>;

  if (!authenticated) {
    return (
      <main className="grid min-h-screen place-items-center bg-space-950 px-5 text-slate-100">
        <form onSubmit={signIn} className="w-full max-w-md rounded-3xl border border-space-700 bg-space-800 p-7 shadow-card">
          <p className="text-xs font-bold text-amber-300">서비스 운영자 전용</p>
          <h1 className="mt-1 text-2xl font-black">Drive OAuth 설정</h1>
          <label className="mt-6 block text-sm font-bold">기존 운영자 비밀번호
            <input type="password" autoComplete="current-password" required minLength={12} value={password} onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-space-600 bg-space-900 px-4 py-3" />
          </label>
          {message ? <p className="mt-4 rounded-xl border border-red-400/25 bg-red-400/10 p-3 text-sm text-red-200">{message}</p> : null}
          <button disabled={busy} className="mt-5 w-full rounded-xl bg-amber-500 px-5 py-3 font-black text-space-950 disabled:opacity-60">{busy ? "확인 중…" : "운영자 로그인"}</button>
          <Link href="/admin" className="mt-4 block text-center text-sm text-slate-400">교사 화면으로 돌아가기</Link>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-space-950 px-4 py-8 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold text-amber-300">중앙 서비스 운영</p><h1 className="mt-1 text-2xl font-black">Google Drive OAuth</h1></div><button onClick={signOut} className="rounded-xl border border-space-600 bg-space-800 px-4 py-2 text-sm font-bold">로그아웃</button></header>
        {message ? <p className="rounded-xl border border-blue-400/25 bg-blue-400/10 p-3 text-sm text-blue-100">{message}</p> : null}

        <section className="rounded-3xl border border-space-700 bg-space-800 p-6 shadow-card">
          <h2 className="text-lg font-black">1. Google Cloud OAuth 웹 클라이언트</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">Google Cloud에서 Drive API와 Sheets API를 활성화하고 웹 애플리케이션 OAuth 클라이언트를 만든 뒤 아래 리디렉션 URI를 등록합니다.</p>
          <div className="mt-4 rounded-xl bg-space-900 p-4 text-sm break-all"><strong>승인된 리디렉션 URI</strong><br />{config?.redirectUri}</div>
          <div className="mt-3 rounded-xl bg-space-900 p-4 text-sm break-all"><strong>요청 권한</strong><br />{config?.scope}</div>
          <form onSubmit={saveConfig} className="mt-5 space-y-4">
            <label className="block text-sm font-bold">OAuth 클라이언트 ID<input required value={clientId} onChange={(event: ChangeEvent<HTMLInputElement>) => setClientId(event.target.value)} placeholder="...apps.googleusercontent.com" className="mt-2 w-full rounded-xl border border-space-600 bg-space-900 px-4 py-3" /></label>
            <label className="block text-sm font-bold">OAuth 클라이언트 보안 비밀번호<input required type="password" value={clientSecret} onChange={(event: ChangeEvent<HTMLInputElement>) => setClientSecret(event.target.value)} placeholder={config?.configured ? "변경하려면 다시 입력" : "GOCSPX-..."} className="mt-2 w-full rounded-xl border border-space-600 bg-space-900 px-4 py-3" /></label>
            <button disabled={busy} className="w-full rounded-xl bg-amber-500 px-5 py-3 font-black text-space-950 disabled:opacity-60">암호화해 저장</button>
          </form>
          <p className="mt-3 text-xs text-slate-500">현재 상태: {config?.configured ? `설정됨 · ${config.updatedAt || ""}` : "설정 필요"}</p>
        </section>

        <section className="rounded-3xl border border-space-700 bg-space-800 p-6 shadow-card">
          <h2 className="text-lg font-black">2. 이전 중앙 학생자료 정리</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">새 Drive형은 학생 사진·이름·메모를 중앙 저장소에 기록하지 않습니다. 전환 전 D1/R2 자료가 있다면 한 번 삭제합니다.</p>
          <div className="mt-4 rounded-xl bg-space-900 p-4 text-sm">D1 관찰 행: <strong>{legacy?.databaseRows ?? "-"}</strong> · R2 사진: <strong>{legacy?.r2ObjectsPresent ? "있음" : "없음"}</strong></div>
          <button onClick={purgeLegacy} disabled={busy || (!legacy?.databaseRows && !legacy?.r2ObjectsPresent)} className="mt-4 w-full rounded-xl border border-red-400/30 bg-red-400/10 px-5 py-3 font-black text-red-200 disabled:opacity-40">기존 중앙 학생자료 영구 삭제</button>
        </section>

        <div className="flex justify-center gap-3"><Link href="/admin" className="rounded-xl border border-space-600 bg-space-800 px-5 py-3 font-bold">교사 화면 확인</Link><Link href="/" className="rounded-xl border border-space-600 bg-space-800 px-5 py-3 font-bold">학생 화면 확인</Link></div>
      </div>
    </main>
  );
}
