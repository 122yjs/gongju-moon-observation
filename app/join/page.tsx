"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function JoinPage() {
  const [message, setMessage] = useState("수업 참여 링크를 확인하고 있어요…");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("t");
    window.history.replaceState({}, "", "/join");
    if (!token) {
      window.setTimeout(() => {
        setFailed(true);
        setMessage("수업 참여 정보가 없습니다. 선생님이 안내한 QR을 다시 촬영해 주세요.");
      }, 0);
      return;
    }

    fetch("/api/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const result = (await response.json().catch(() => ({}))) as { message?: string };
        if (!response.ok) throw new Error(result.message || "수업 참여 링크를 확인하지 못했습니다.");
        setMessage("수업 참여가 확인되었습니다. 탐험대로 이동할게요!");
        window.setTimeout(() => window.location.replace("/"), 500);
      })
      .catch((error: unknown) => {
        setFailed(true);
        setMessage(error instanceof Error ? error.message : "수업 참여 링크를 확인하지 못했습니다.");
      });
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-space-950 px-5 text-slate-100">
      <section className="w-full max-w-md rounded-3xl border border-space-700 bg-space-800 p-7 text-center shadow-card">
        <div className="text-6xl" aria-hidden="true">{failed ? "🌑" : "🌙"}</div>
        <h1 className="mt-5 text-2xl font-black">공주 달 관찰 탐험대</h1>
        <p className={`mt-4 text-sm leading-7 ${failed ? "text-red-200" : "text-slate-300"}`} role="status">
          {message}
        </p>
        {failed ? (
          <Link href="/" className="mt-6 inline-flex rounded-xl bg-amber-500 px-5 py-3 font-black text-space-950 hover:bg-amber-400">
            달 정보 먼저 보기
          </Link>
        ) : (
          <span className="spinner mx-auto mt-6 block text-amber-300" aria-hidden="true" />
        )}
      </section>
    </main>
  );
}
