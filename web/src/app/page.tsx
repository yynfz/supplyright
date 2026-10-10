import Link from "next/link";
import Image from "next/image";
import { ArrowRight, BadgeCheck, Check, Factory, FileCheck2, Landmark, LayoutDashboard, LockKeyhole, Scale, ShieldCheck, Wallet } from "lucide-react";

const journey = [
  { number: "01", icon: FileCheck2, title: "Hak pasokan terdaftar", description: "Registrar memeriksa PO dan perjanjian bertanda tangan, lalu mencetak Supply Right NFT dengan hash dokumen dan ketentuan ekonomi." },
  { number: "02", icon: ShieldCheck, title: "Proteksi didanai", description: "Provider menilai permintaan proteksi dan mengunci kolateral mETH di vault. Coverage berlaku setelah dana benar-benar tersedia." },
  { number: "03", icon: Scale, title: "Keputusan independen", description: "Pembeli mengajukan bukti. Verifikator menilai default, pengiriman, dan kerugian; keputusan dapat melalui proses keberatan." },
  { number: "04", icon: BadgeCheck, title: "Payout & catatan recovery", description: "Settlement membayar kompensasi dari kolateral dan mencetak Recovery Claim NFT untuk provider dalam satu transaksi atomik." },
];

const workspaces = [
  { href: "/dashboard", icon: LayoutDashboard, title: "Dashboard Eksekutif", description: "Pantau hak pasokan, proteksi, dan klaim dari data protokol." },
  { href: "/registry", icon: FileCheck2, title: "Supply Registry", description: "Ajukan perjanjian, verifikasi dokumen, dan kelola lifecycle pasokan." },
  { href: "/protection", icon: ShieldCheck, title: "Protection Center", description: "Minta coverage dan ikuti keputusan pendanaan provider." },
  { href: "/production", icon: Factory, title: "Production Risk", description: "Hubungkan material dengan produk dan petakan eksposur operasional." },
  { href: "/claims", icon: Scale, title: "Claims Center", description: "Ajukan bukti, tinjau keputusan, dan jalankan settlement." },
  { href: "/provider", icon: Landmark, title: "Provider Dashboard", description: "Kelola kolateral, underwriting, dan catatan pemulihan." },
  { href: "/verify", icon: BadgeCheck, title: "Verifikasi Publik", description: "Periksa token, transaksi, dan hash tanpa membuka dokumen privat." },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-navy">
      <a href="#main" className="sr-only rounded-md bg-white p-3 text-navy focus:not-sr-only focus:absolute focus:z-50">Lewati ke konten</a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="SupplyRight — beranda">
            <span className="flex size-9 items-center justify-center rounded-lg bg-navy">
              <Image src="/supplyright-logo.png" alt="" width={28} height={28} className="size-7 object-contain" priority />
            </span>
            <span className="text-lg font-semibold tracking-tight">SupplyRight<span className="text-teal-600">.</span></span>
          </Link>
          <nav aria-label="Navigasi utama" className="flex items-center gap-5 text-sm">
            <a href="#workflow" className="hidden text-slate-600 hover:text-navy md:block">Cara kerja</a>
            <Link href="/verify" className="hidden text-slate-600 hover:text-navy sm:block">Verifikasi Publik</Link>
            <Link href="/dashboard" className="inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-navy px-4 py-2.5 font-medium text-white transition hover:bg-navy-soft"><span className="hidden sm:inline">Buka platform</span><span className="sm:hidden">Buka app</span><ArrowRight className="size-4" /></Link>
          </nav>
        </div>
      </header>
      <main id="main">
        <section className="relative overflow-hidden bg-navy text-white">
          <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0 opacity-50" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:py-24">
            <div>
              <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-teal-300/25 bg-teal-300/5 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-teal-200"><span className="size-1.5 rounded-full bg-teal-300" />Supply assurance · prototipe testnet</p>
              <h1 className="max-w-xl text-balance text-4xl font-semibold leading-[1.12] tracking-tight sm:text-5xl lg:text-[3.6rem]">Hak pasokan yang jelas.<br /><span className="text-teal-300">Proteksi yang didanai.</span></h1>
              <p className="mt-6 max-w-lg text-base leading-relaxed text-slate-300 sm:text-lg">Dari perjanjian komersial hingga kompensasi terverifikasi. Satu alur untuk mencatat pasokan, menjaga kolateral, dan menelusuri keputusan.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/registry" className="inline-flex items-center gap-2 rounded-md bg-teal-300 px-5 py-3 text-sm font-semibold text-navy transition hover:bg-teal-200">Mulai dari Supply Registry<ArrowRight className="size-4" /></Link>
                <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-md border border-white/25 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/5">Lihat dashboard</Link>
              </div>
              <div className="mt-9 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-300"><span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-teal-300" />Dokumen komersial privat</span><span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-teal-300" />Jejak audit publik</span><span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-teal-300" />Keputusan berbasis bukti</span></div>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/5 p-4 shadow-2xl shadow-black/10 sm:p-6">
              {/* <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium text-slate-200">Alur kompensasi pasokan</span><span className="rounded-full bg-amber-200/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200">Ilustrasi · bukan data live</span></div> */}
              <div className="rounded-lg bg-white p-5 text-navy">
                <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-md bg-slate-100"><FileCheck2 className="size-5" /></span><div><p className="text-sm font-semibold">Supply Right NFT</p><p className="text-[11px] text-slate-500">Hak atas pengiriman material berdasarkan perjanjian</p></div></div>
                <div className="mt-5 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4"><div><p className="text-[10px] text-slate-500">Pesanan</p><p className="mt-1 text-lg font-semibold tabular-nums">50 <span className="text-xs font-normal">MT</span></p></div><div><p className="text-[10px] text-slate-500">Diterima</p><p className="mt-1 text-lg font-semibold tabular-nums">10 <span className="text-xs font-normal">MT</span></p></div><div><p className="text-[10px] text-slate-500">Nilai kontrak</p><p className="mt-1 text-lg font-semibold tabular-nums">100 <span className="text-xs font-normal">mETH</span></p></div></div>
              </div>
              <div aria-hidden="true" className="mx-auto h-5 w-px bg-teal-300/50" />
              <div className="rounded-lg border border-teal-300/25 bg-teal-300/10 p-4"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-teal-200" /><span className="text-sm font-medium">Proteksi didanai</span></div><span className="font-mono text-sm text-teal-200">20 mETH</span></div><p className="mt-2 text-xs text-slate-300">Coverage 20% · kerugian terverifikasi 80 mETH</p></div>
              <div aria-hidden="true" className="mx-auto h-5 w-px bg-teal-300/50" />
              <div className="grid grid-cols-2 gap-3"><div className="rounded-lg border border-teal-300/30 bg-teal-300/15 p-4"><p className="text-[11px] text-teal-100">Payout ke pembeli</p><p className="mt-1 text-2xl font-semibold tabular-nums">16 <span className="text-sm font-normal text-teal-100">mETH</span></p></div><div className="rounded-lg border border-white/15 bg-white/5 p-4"><p className="text-[11px] text-slate-300">Sisa kolateral proteksi</p><p className="mt-1 text-2xl font-semibold tabular-nums">4 <span className="text-sm font-normal text-slate-300">mETH</span></p></div></div>
              <div className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-slate-300"><BadgeCheck className="mt-0.5 size-4 shrink-0 text-teal-300" /><p>Recovery Claim NFT untuk provider diterbitkan saat settlement. Perhitungan ini contoh fiktif, bukan saldo, klaim, atau transaksi yang sedang berjalan.</p></div>
            </div>
          </div>
        </section>
        <section id="workflow" className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
          <div className="max-w-2xl"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">Alur protokol</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">Setiap tahap punya bukti.<br className="hidden sm:block" /> Setiap keputusan punya jejak.</h2><p className="mt-4 text-sm leading-relaxed text-slate-600">Pendaftaran, underwriting, penilaian default, dan payout memiliki kewenangan yang berbeda. Dokumen privat terhubung ke catatan publik melalui hash.</p></div>
          <ol className="mt-10 grid gap-7 sm:grid-cols-2 lg:grid-cols-4">{journey.map((step) => <li key={step.number} className="border-t border-slate-200 pt-5"><div className="mb-5 flex items-center justify-between"><span className="font-mono text-xs text-slate-400">{step.number}</span><step.icon className="size-5 text-teal-700" /></div><h3 className="text-base font-semibold">{step.title}</h3><p className="mt-2 text-sm leading-relaxed text-slate-600">{step.description}</p></li>)}</ol>
        </section>
        <section className="border-y border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">Ruang kerja</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">Dari kontrak ke kendali produksi.</h2></div><p className="max-w-sm text-sm leading-relaxed text-slate-600">Buka modul sesuai tugas Anda. Pembacaan onchain bersifat publik; tindakan dan data privat mengikuti peran wallet.</p></div>
            <div className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-3">{workspaces.map((workspace) => <Link key={workspace.href} href={workspace.href} className="group flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-5 transition hover:border-teal-400 hover:shadow-sm"><span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700"><workspace.icon className="size-5" /></span><div className="min-w-0 flex-1"><h3 className="flex items-center justify-between gap-2 text-sm font-semibold">{workspace.title}<ArrowRight className="size-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-teal-700" /></h3><p className="mt-1.5 text-xs leading-relaxed text-slate-500">{workspace.description}</p></div></Link>)}</div>
          </div>
        </section>
        <section className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
          <div><LockKeyhole className="mb-5 size-7 text-teal-700" /><h2 className="text-3xl font-semibold tracking-tight">Dokumen privat.<br />Audit publik.</h2><p className="mt-4 max-w-md text-sm leading-relaxed text-slate-600">Isi dokumen disimpan privat di Supabase. API memeriksa tanda tangan wallet dan izin peran sebelum membuka data komersial.</p><Link href="/verify" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-teal-700 hover:underline">Periksa catatan publik<ArrowRight className="size-4" /></Link></div>
          <div className="space-y-5"><dl className="grid gap-5 sm:grid-cols-2"><div className="rounded-lg border border-slate-200 p-5"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Privat di Supabase</dt><dd className="mt-3 text-sm leading-relaxed text-slate-600">PO, perjanjian bertanda tangan, nama pemasok, bukti klaim, dan laporan verifikator.</dd></div><div className="rounded-lg border border-slate-200 p-5"><dt className="text-xs font-semibold uppercase tracking-wide text-teal-700">Publik onchain</dt><dd className="mt-3 text-sm leading-relaxed text-slate-600">Wallet para pihak, nilai kontrak, kuantitas, tenggat, kolateral, status, dan hash dokumen.</dd></div></dl><div className="flex items-start gap-3 rounded-lg bg-navy p-5 text-white"><Wallet className="mt-0.5 size-5 shrink-0 text-teal-300" /><div><p className="text-sm font-medium">mETH untuk demo. ETH untuk gas.</p><p className="mt-2 text-xs leading-relaxed text-slate-300">MockETH (mETH) adalah token ERC-20 demo dengan 18 desimal untuk kolateral dan payout. ETH native digunakan untuk biaya transaksi. mETH tidak mewakili dana atau aset mainnet.</p></div></div></div>
        </section>
        <section className="border-t border-slate-200 bg-teal-50/50 px-5 py-10 sm:px-8"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-5 sm:flex-row sm:items-center"><div><h2 className="text-xl font-semibold tracking-tight">Mulai dengan perjanjian yang bisa diperiksa.</h2><p className="mt-2 text-sm text-slate-600">Hubungkan wallet di platform untuk mengajukan PO dan dokumen pasokan.</p></div><Link href="/registry" className="inline-flex w-fit items-center gap-2 rounded-md bg-navy px-5 py-3 text-sm font-medium text-white transition hover:bg-navy-soft">Buka Supply Registry<ArrowRight className="size-4" /></Link></div></section>
      </main>
      <footer className="border-t border-slate-200 px-5 py-8 sm:px-8"><div className="mx-auto max-w-7xl"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold">SupplyRight<span className="text-teal-600">.</span></p><p className="text-[11px] text-slate-500">Prototipe hackathon · testnet · belum diaudit</p></div><p className="mt-4 max-w-5xl text-xs leading-relaxed text-slate-500">NFT mencatat representasi digital hak pasokan dan recovery. Keberlakuan hukum, hak penagihan, dan kewajiban para pihak bergantung pada perjanjian bertanda tangan serta ketentuan yang berlaku. Prototipe ini belum diaudit dan bukan produk asuransi atau jaminan pengembalian dana.</p></div></footer>
    </div>
  );
}
