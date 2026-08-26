import Link from "next/link";

export default function Home() {
  return (
    <main className="grid min-h-screen place-items-center bg-space-950 px-5 text-slate-100">
      <Link className="rounded-xl bg-amber-500 px-5 py-3 font-black text-space-950" href="/index.html">
        달 관찰 탐험대 시작하기
      </Link>
    </main>
  );
}
