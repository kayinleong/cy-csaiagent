/**
 * Multilingual KB chunk fixture for SPIKE-RAG harness.
 *
 * ~500 SYNTHETIC chunks across en (English), ms (Bahasa Malaysia), and zh (Chinese).
 * Content is D2-flavored onboarding/training material. NO real PII.
 *
 * All phone numbers, email addresses, ICs, and personal details are SYNTHETIC.
 * They use placeholder formats that will FAIL the CI PII scan if real data is
 * accidentally substituted (see .github/workflows/ci.yml).
 *
 * Includes a per-language gold set: query → expected relevant chunkIds for recall measurement.
 *
 * Used by src/rag/spike-rag.test.ts (SPIKE-RAG measurement: p95 latency, read-cost,
 * BM/ZH recall vs EN recall).
 *
 * References:
 *   - SPIKE-RAG pass criteria: p95<800ms, read-cost<10× naive, BM/ZH recall ≥70% of EN
 *   - TSD §4: kbChunks collection, lang-filtered findNearest DOT_PRODUCT
 *   - D-07: measure BM/中文 recall on ~500 multilingual chunks
 */

export interface MultilingualChunk {
  id: string
  docId: string
  tenantId: 'd2'
  lang: 'en' | 'ms' | 'zh'
  text: string
  chunkIndex: number
  topic: string
}

export interface GoldQuery {
  queryId: string
  lang: 'en' | 'ms' | 'zh'
  queryText: string
  /** Chunk IDs that are relevant to this query (ground truth for recall measurement) */
  relevantChunkIds: string[]
}

// ── English chunks (topics: onboarding, commission, compliance, CRM, projects) ───────────────

const EN_CHUNKS_ONBOARDING: MultilingualChunk[] = Array.from({ length: 40 }, (_, i) => ({
  id: `spike-en-onboard-${String(i).padStart(3, '0')}`,
  docId: 'spike-doc-d2-onboarding-en',
  tenantId: 'd2' as const,
  lang: 'en' as const,
  topic: 'onboarding',
  chunkIndex: i,
  text: [
    `D2 New Agent Onboarding — Step ${i + 1}: `,
    [
      'Welcome to D2 Property! As a new agent your first week covers compliance, product knowledge, and CRM setup.',
      'Complete the D2 compliance checklist within 3 working days: submit REN tag copy, NRIC, and bank details.',
      'Attend the mandatory product knowledge session every Tuesday at 10am at the D2 headquarters.',
      'Set up your CRM account at the D2 portal using your registered email address placeholder@example.com.',
      'Your senior coach will schedule a 1-on-1 orientation call during your first week.',
      'Review the D2 Standard Operating Procedures (SOP) manual before your first client meeting.',
      'D2 agents are required to wear the official lanyard and carry their REN tag at all site visits.',
      'The D2 commission structure is documented in the agent handbook available on the portal.',
      'All new agents must complete a 3-hour e-learning module on Malaysian property laws within 30 days.',
      'Bumiputera-reserved lots require special handling — consult your senior coach before presenting to non-Bumi leads.',
      'The D2 referral programme pays RM 500 for every qualified lead that converts in the first 90 days.',
      'Foreign buyers require additional documentation: passport copy, source-of-funds declaration, and consent form.',
      'D2 uses WhatsApp Business for internal team announcements — join the D2 Agents group when invited.',
      'Your probation period is 90 days; achieving one conversion before day 60 exempts you from probation review.',
      'Submit your weekly activity report (WAR) to your senior coach by 5pm every Friday.',
      'The D2 lead-management system integrates with the CRM — never store leads in personal spreadsheets.',
      'Any media featuring D2 projects must use approved marketing assets from the media library on the portal.',
      'D2 project launches are announced 2 weeks in advance; attendance is mandatory for all registered agents.',
      'New agents receive a RM 200 starter kit on completion of onboarding (SOI form required).',
      'Your upline coach earns an override on your commissions — maintain a good working relationship.',
      'D2 holds a monthly town-hall on the last Friday of each month — attendance tracked in CRM.',
      'The agent mobile app (iOS/Android) syncs with the CRM; download it during orientation.',
      'D2 property projects comply with RERA regulations — all pricing is in the official price list.',
      'Contact the HR helpdesk at hr-placeholder@d2property.example for payroll or claims issues.',
      'Your first commission cheque is processed within 15 working days of SPA signing.',
      'Strata management fees for D2 Commercial Hub are RM 0.35 per sqft per month.',
      'D2 Residences freehold title — full ownership with no lease expiry — is a key selling point.',
      'The D2 brand positioning is "Quality. Trust. Growth." — memorise this for client presentations.',
      'All client data collected must be stored in the D2 CRM only — no personal cloud storage (PDPA compliance).',
      'D2 agents must not make verbal commitments about handover dates without written confirmation from sales admin.',
      'The D2 loyalty programme rewards agents with travel vouchers at 5, 10, and 20 successful transactions.',
      'Submit Reservation Forms within 24 hours of client signing to avoid slot expiry.',
      'D2 offers in-house mortgage referral — refer clients to the D2 Finance desk for preferential rates.',
      'Night shift coverage for international clients is handled by the regional coordinator, not individual agents.',
      'The D2 mentorship programme pairs new agents with top performers for 6 months.',
      'NAPIC data is referenced in D2 project brochures — agents may quote it but must cite the source.',
      'D2 agents are not authorised to offer discounts beyond the approved rebate schedule.',
      'Every client interaction that involves personal data must be logged in CRM within 2 hours.',
      'D2 Code of Conduct prohibits poaching clients from fellow agents — violation leads to termination.',
      'New agent orientation is held every 2nd Monday of the month — your cohort is listed in the welcome email.',
    ][i % 40],
  ].join(''),
}))

const EN_CHUNKS_COMMISSION: MultilingualChunk[] = Array.from({ length: 30 }, (_, i) => ({
  id: `spike-en-commission-${String(i).padStart(3, '0')}`,
  docId: 'spike-doc-d2-commission-en',
  tenantId: 'd2' as const,
  lang: 'en' as const,
  topic: 'commission',
  chunkIndex: i,
  text: [
    `D2 Commission Structure — Note ${i + 1}: `,
    [
      'Commission rates for primary market (new launches) range from 2% to 3.5% of SPA price.',
      'Secondary market commissions are negotiated but capped at 3% per BOVAEA guidelines.',
      'Override commissions: senior coaches earn 0.25% override on all downline transactions.',
      'Referral fee for qualified leads: RM 500 paid upon SPA signing by the referred buyer.',
      'Commission splits for co-broking: 50-50 default; document via Co-Agency Agreement.',
      'Stamp duty rebate: D2 absorbs stamp duty on MOT for the first 5 new agents transactions per quarter.',
      'Progressive bonus: hit 5 transactions in a quarter → earn a RM 1,500 performance bonus.',
      'The clawback clause activates if the SPA is cancelled within 30 days of signing.',
      'Processing fee for commission advances: 1.5% of advanced amount, deducted at settlement.',
      'Agents must not accept cash payments from buyers — all transactions via designated bank accounts only.',
      'Commission statements are released on the 25th of each month via the portal.',
      'Dispute resolution for commission claims: file within 7 working days of statement release.',
      'Co-agency agreements require both senior coaches to countersign before the commission is split.',
      'Nil-commission scenarios: agent fails to complete cooling-off period documentation.',
      'Bonus pool: top 3 agents each quarter share a RM 5,000 team bonus from D2 management.',
      'LHDN PCB deduction applies to commission payments — agents are treated as self-employed.',
      'Tax receipt for commission: issue Form CP58 to agents earning > RM 5,000 per payment.',
      'Commission advance requests must be approved by the branch manager before processing.',
      'New project launches may carry an additional launch incentive of 0.5% valid for 30 days.',
      'The D2 Finance desk prepares commission forecasts for agents on request.',
      'Agents handling foreigner purchases receive a 0.1% premium for documentation complexity.',
      'The minimum commission threshold for same-day processing is RM 2,000.',
      'All commission calculations are based on nett SPA price, not list price.',
      'Documentation required for commission release: signed SPA copy, booking form, loan letter (if applicable).',
      'Agents on probation receive 80% of standard commission; full rate activated at probation completion.',
      'D2 withholds 10% of commission as a project-completion retention, released on VP issuance.',
      'Top agent of the year receives a full-board trip to Tokyo — qualifying criteria on the portal.',
      'Medical leave during a project launch does not affect commission entitlement.',
      'Commission is paid in MYR regardless of buyer nationality.',
      'D2 reserves the right to adjust commission schedules with 30-day advance notice.',
    ][i % 30],
  ].join(''),
}))

const EN_CHUNKS_PROJECTS: MultilingualChunk[] = Array.from({ length: 30 }, (_, i) => ({
  id: `spike-en-projects-${String(i).padStart(3, '0')}`,
  docId: 'spike-doc-d2-projects-en',
  tenantId: 'd2' as const,
  lang: 'en' as const,
  topic: 'projects',
  chunkIndex: i,
  text: [
    `D2 Project Portfolio — Item ${i + 1}: `,
    [
      'Taman D2 Residences: freehold, Bumiputera-reserved lots available, Selangor, from RM 450,000.',
      'D2 Commercial Hub: strata offices, foreigner-eligible, Kuala Lumpur, from RM 650,000 per unit.',
      'D2 Lakeside Suites: serviced apartments, SOHO layout, Johor, leasehold 99 years.',
      'D2 Greens: eco-themed linked houses, bumiputera quota 30%, Negeri Sembilan.',
      'D2 SkyLoft: luxury condominiums with sky garden, KL City fringe, from RM 1.2M.',
      'D2 Boulevard: shopoffices 3+1 and 4+1 storey, Selangor, freehold, foreigner-eligible.',
      'D2 Medini: integrated township near Iskandar, Johor, affordable range RM 280,000–480,000.',
      'D2 Heritage: conservation-themed shop lots in Malacca old town, strata title.',
      'D2 AgroVilla: resort bungalow lots, Pahang, agriculture land conversion pending.',
      'D2 Pinnacle: grade-A offices, KLCC adjacent, en-bloc available from floor 12 upward.',
      'Financing: D2 has MOUs with 3 banks for preferential rates — PublicBank, RHB, CIMB.',
      'Snag inspection protocol: agents accompany buyers for VP walk-through (mandatory attendance).',
      'D2 Residences OC received 2025-Q3 — VP issuance ongoing, keys by batch.',
      'D2 Commercial Hub certificate of fitness (CF) pending — target Q2 2026.',
      'D2 Lakeside Suites: build-then-sell model, no progressive payments.',
      'All D2 projects use BCA-approved materials — full material specs on the portal.',
      'D2 SkyLoft penthouses are reserved for owner-occupiers only, no investment sub-sales within 2 years.',
      'D2 Greens rainwater harvesting system reduces utility bills by est. 15%.',
      'D2 Boulevard triple net lease option available for anchor tenants > 10,000 sqft.',
      'D2 Medini qualifies for Malaysia My Second Home (MM2H) programme — agents must complete MM2H training.',
      'D2 AgroVilla project is not eligible for LPPEH-regulated financing — cash buyers preferred.',
      'D2 Heritage shop lots include heritage façade restoration cost in SPA price.',
      'D2 Pinnacle: BIM model available for due-diligence review by institutional buyers.',
      'Brochure requests: order via the portal; standard lead time 5 working days.',
      'D2 SkyLoft show unit is open Saturday–Sunday 10am–6pm at KL City Gallery.',
      'D2 projects in Johor are exempt from State consent for purchase by foreigners (approved corridor).',
      'Sales gallery for D2 Residences is at Lot G-01, Section 14, PJ.',
      'D2 Medini comes with 2 years free internet (Unifi partnership).',
      'Priority balloting for Bumiputera applicants closes 1 week before public launch.',
      'All D2 show units have COVID-safe signage — strictly no smoking on premises.',
    ][i % 30],
  ].join(''),
}))

// ── Bahasa Malaysia chunks ────────────────────────────────────────────────────────────────────

const MS_CHUNKS_ONBOARDING: MultilingualChunk[] = Array.from({ length: 40 }, (_, i) => ({
  id: `spike-ms-onboard-${String(i).padStart(3, '0')}`,
  docId: 'spike-doc-d2-onboarding-ms',
  tenantId: 'd2' as const,
  lang: 'ms' as const,
  topic: 'onboarding',
  chunkIndex: i,
  text: [
    `Panduan Ejen Baharu D2 — Langkah ${i + 1}: `,
    [
      'Selamat datang ke D2 Property! Minggu pertama anda merangkumi pematuhan, pengetahuan produk, dan persediaan CRM.',
      'Lengkapkan senarai semak pematuhan D2 dalam masa 3 hari bekerja: serahkan salinan teg REN, NRIC, dan butiran bank.',
      'Hadiri sesi pengetahuan produk mandatori setiap Selasa jam 10 pagi di ibu pejabat D2.',
      'Sediakan akaun CRM anda di portal D2 menggunakan alamat e-mel berdaftar anda.',
      'Jurulatih kanan anda akan menjadualkan panggilan orientasi 1-kepada-1 semasa minggu pertama anda.',
      'Semak manual Prosedur Operasi Standard (SOP) D2 sebelum mesyuarat pelanggan pertama anda.',
      'Ejen D2 diwajibkan memakai lanyard rasmi dan membawa teg REN di semua lawatan tapak.',
      'Struktur komisen D2 didokumenkan dalam buku panduan ejen yang tersedia di portal.',
      'Semua ejen baharu mesti melengkapkan modul e-pembelajaran 3 jam tentang undang-undang harta tanah Malaysia dalam 30 hari.',
      'Lot rizab Bumiputera memerlukan pengendalian khas — dapatkan nasihat daripada jurulatih kanan sebelum membentangkan kepada pelanggan bukan Bumi.',
      'Program rujukan D2 membayar RM 500 untuk setiap petunjuk berkelayakan yang ditukar dalam 90 hari pertama.',
      'Pembeli asing memerlukan dokumentasi tambahan: salinan pasport, pengisytiharan sumber dana, dan borang persetujuan.',
      'D2 menggunakan WhatsApp Business untuk pengumuman pasukan dalaman — sertai kumpulan Ejen D2 apabila dijemput.',
      'Tempoh percubaan anda adalah 90 hari; mencapai satu penukaran sebelum hari ke-60 mengecualikan anda daripada semakan percubaan.',
      'Serahkan laporan aktiviti mingguan (WAR) kepada jurulatih kanan anda sebelum jam 5 petang setiap Jumaat.',
      'Sistem pengurusan petunjuk D2 berintegrasi dengan CRM — jangan simpan petunjuk dalam hamparan peribadi.',
      'Sebarang media yang menampilkan projek D2 mesti menggunakan aset pemasaran yang diluluskan dari perpustakaan media di portal.',
      'Pelancaran projek D2 diumumkan 2 minggu lebih awal; kehadiran adalah mandatori untuk semua ejen berdaftar.',
      'Ejen baharu menerima kit permulaan RM 200 selepas menyelesaikan pengenalan (borang SOI diperlukan).',
      'Jurulatih kanan anda memperoleh komisyen override atas transaksi anda — kekalkan hubungan kerja yang baik.',
      'D2 mengadakan town-hall bulanan pada Jumaat terakhir setiap bulan — kehadiran dijejaki dalam CRM.',
      'Aplikasi mudah alih ejen (iOS/Android) disegerakkan dengan CRM; muat turun semasa orientasi.',
      'Projek harta tanah D2 mematuhi peraturan RERA — semua harga dalam senarai harga rasmi.',
      'Hubungi meja bantuan HR di hr-placeholder@d2property.example untuk isu gaji atau tuntutan.',
      'Cek komisen pertama anda diproses dalam masa 15 hari bekerja selepas penandatanganan SPA.',
      'Bayaran pengurusan strata untuk D2 Commercial Hub adalah RM 0.35 setiap kaki persegi sebulan.',
      'Hakmilik bebas D2 Residences — pemilikan penuh tanpa tamat pajakan — adalah titik jualan utama.',
      'Peletakan jenama D2 ialah "Kualiti. Kepercayaan. Pertumbuhan." — hafal ini untuk pembentangan klien.',
      'Semua data pelanggan yang dikumpul mesti disimpan dalam CRM D2 sahaja — tiada storan awan peribadi (pematuhan PDPA).',
      'Ejen D2 tidak boleh membuat komitmen lisan mengenai tarikh serah hak tanpa pengesahan bertulis daripada pentadbiran jualan.',
      'Program kesetiaan D2 memberi ejen baucar perjalanan pada 5, 10, dan 20 transaksi berjaya.',
      'Serahkan Borang Tempahan dalam masa 24 jam selepas penandatanganan pelanggan untuk mengelakkan tamat tempoh slot.',
      'D2 menawarkan rujukan gadai janji dalaman — rujuk pelanggan ke Meja Kewangan D2 untuk kadar istimewa.',
      'Liputan syif malam untuk pelanggan antarabangsa dikendalikan oleh penyelaras serantau, bukan ejen individu.',
      'Program bimbingan D2 memasangkan ejen baharu dengan peserta terbaik selama 6 bulan.',
      'Data NAPIC dirujuk dalam risalah projek D2 — ejen boleh mengutinya tetapi mesti menyebut sumbernya.',
      'Ejen D2 tidak dibenarkan menawarkan diskaun melebihi jadual rebat yang diluluskan.',
      'Setiap interaksi pelanggan yang melibatkan data peribadi mesti dilog dalam CRM dalam masa 2 jam.',
      'Kod Tingkah Laku D2 melarang peraihan pelanggan daripada ejen rakan — pelanggaran membawa kepada penamatan.',
      'Orientasi ejen baharu diadakan setiap Isnin kedua bulan — kohort anda disenaraikan dalam e-mel alu-aluan.',
    ][i % 40],
  ].join(''),
}))

const MS_CHUNKS_COMMISSION: MultilingualChunk[] = Array.from({ length: 30 }, (_, i) => ({
  id: `spike-ms-commission-${String(i).padStart(3, '0')}`,
  docId: 'spike-doc-d2-commission-ms',
  tenantId: 'd2' as const,
  lang: 'ms' as const,
  topic: 'commission',
  chunkIndex: i,
  text: [
    `Struktur Komisen D2 — Nota ${i + 1}: `,
    [
      'Kadar komisen untuk pasaran utama (pelancaran baharu) berkisar antara 2% hingga 3.5% daripada harga SPA.',
      'Komisen pasaran sekunder dinegosiasikan tetapi dihadkan pada 3% mengikut garis panduan BOVAEA.',
      'Komisen override: jurulatih kanan memperoleh 0.25% override atas semua transaksi downline.',
      'Bayaran rujukan untuk petunjuk berkelayakan: RM 500 dibayar selepas penandatanganan SPA oleh pembeli yang dirujuk.',
      'Pembahagian komisen untuk co-broking: 50-50 secara lalai; dokumentkan melalui Perjanjian Co-Agensi.',
      'Rebat duti setem: D2 menanggung duti setem atas MOT untuk 5 transaksi ejen baharu pertama setiap suku tahun.',
      'Bonus progresif: capai 5 transaksi dalam suku tahun → peroleh bonus prestasi RM 1,500.',
      'Klausa clawback diaktifkan jika SPA dibatalkan dalam masa 30 hari dari penandatanganan.',
      'Bayaran pemprosesan untuk pendahuluan komisen: 1.5% daripada jumlah pendahuluan, ditolak pada penyelesaian.',
      'Ejen tidak boleh menerima pembayaran tunai daripada pembeli — semua transaksi melalui akaun bank yang ditetapkan sahaja.',
      'Penyata komisen dikeluarkan pada 25 setiap bulan melalui portal.',
      'Penyelesaian pertikaian untuk tuntutan komisen: failkan dalam masa 7 hari bekerja dari pengeluaran penyata.',
      'Perjanjian co-agensi memerlukan tandatangan balas daripada kedua-dua jurulatih kanan sebelum komisen dibahagikan.',
      'Senario tanpa komisen: ejen gagal melengkapkan dokumentasi tempoh penyejukan.',
      'Kolam bonus: 3 ejen terbaik setiap suku tahun berkongsi bonus pasukan RM 5,000 daripada pengurusan D2.',
      'Potongan PCB LHDN terpakai untuk pembayaran komisen — ejen dianggap sebagai bekerja sendiri.',
      'Resit cukai untuk komisen: keluarkan Borang CP58 kepada ejen yang memperoleh > RM 5,000 setiap pembayaran.',
      'Permintaan pendahuluan komisen mesti diluluskan oleh pengurus cawangan sebelum diproses.',
      'Pelancaran projek baharu mungkin membawa insentif pelancaran tambahan sebanyak 0.5% yang sah selama 30 hari.',
      'Meja Kewangan D2 menyediakan ramalan komisen untuk ejen atas permintaan.',
      'Ejen yang mengendalikan pembelian warga asing menerima premium 0.1% untuk kerumitan dokumentasi.',
      'Ambang komisen minimum untuk pemprosesan pada hari yang sama adalah RM 2,000.',
      'Semua pengiraan komisen adalah berdasarkan harga SPA nett, bukan harga senarai.',
      'Dokumentasi yang diperlukan untuk pengeluaran komisen: salinan SPA yang ditandatangani, borang tempahan, surat pinjaman (jika berkenaan).',
      'Ejen dalam tempoh percubaan menerima 80% daripada komisen standard; kadar penuh diaktifkan selepas tempoh percubaan selesai.',
      'D2 menahan 10% daripada komisen sebagai tahanan penyiapan projek, dilepaskan selepas pengeluaran VP.',
      'Ejen terbaik tahun ini menerima perjalanan semua-dalam ke Tokyo — kriteria kelayakan di portal.',
      'Cuti sakit semasa pelancaran projek tidak menjejaskan hak komisen.',
      'Komisen dibayar dalam MYR tanpa mengira kewarganegaraan pembeli.',
      'D2 berhak untuk menyesuaikan jadual komisen dengan notis awal 30 hari.',
    ][i % 30],
  ].join(''),
}))

const MS_CHUNKS_PROJECTS: MultilingualChunk[] = Array.from({ length: 30 }, (_, i) => ({
  id: `spike-ms-projects-${String(i).padStart(3, '0')}`,
  docId: 'spike-doc-d2-projects-ms',
  tenantId: 'd2' as const,
  lang: 'ms' as const,
  topic: 'projects',
  chunkIndex: i,
  text: [
    `Portfolio Projek D2 — Item ${i + 1}: `,
    [
      'Taman D2 Residences: hakmilik bebas, lot rizab Bumiputera tersedia, Selangor, dari RM 450,000.',
      'D2 Commercial Hub: pejabat strata, layak untuk warga asing, Kuala Lumpur, dari RM 650,000 seunit.',
      'D2 Lakeside Suites: apartmen berkhidmat, susun atur SOHO, Johor, pajakan 99 tahun.',
      'D2 Greens: rumah berkait bertemakan eko, kuota Bumiputera 30%, Negeri Sembilan.',
      'D2 SkyLoft: kondominium mewah dengan taman langit, pinggir KL City, dari RM 1.2 juta.',
      'D2 Boulevard: kedai pejabat 3+1 dan 4+1 tingkat, Selangor, hakmilik bebas, layak untuk warga asing.',
      'D2 Medini: township bersepadu berdekatan Iskandar, Johor, julat mampu milik RM 280,000–480,000.',
      'D2 Heritage: lot kedai bertemakan pemuliharaan di pekan lama Melaka, hak milik strata.',
      'D2 AgroVilla: lot banglo resort, Pahang, penukaran tanah pertanian sedang menunggu kelulusan.',
      'D2 Pinnacle: pejabat gred-A, bersebelahan KLCC, pembelian en-bloc tersedia dari tingkat 12 ke atas.',
      'Pembiayaan: D2 mempunyai MOU dengan 3 bank untuk kadar istimewa — PublicBank, RHB, CIMB.',
      'Protokol pemeriksaan snag: ejen menemani pembeli untuk pemeriksaan VP walk-through (kehadiran mandatori).',
      'OC D2 Residences diterima pada 2025-Q3 — pengeluaran VP berterusan, kunci mengikut kumpulan.',
      'Sijil kelayakan (CF) D2 Commercial Hub sedang menunggu kelulusan — sasaran Q2 2026.',
      'D2 Lakeside Suites: model bina-kemudian-jual, tiada bayaran progresif.',
      'Semua projek D2 menggunakan bahan yang diluluskan BCA — spesifikasi bahan penuh di portal.',
      'Penthouse D2 SkyLoft dikhaskan untuk penghuni pemilik sahaja, tiada sub-jual pelaburan dalam masa 2 tahun.',
      'Sistem pemanenan air hujan D2 Greens mengurangkan bil utiliti sebanyak anggaran 15%.',
      'Pilihan pajakan nett tiga kali untuk penyewa utama > 10,000 kaki persegi di D2 Boulevard.',
      'D2 Medini layak untuk program Malaysia My Second Home (MM2H) — ejen mesti melengkapkan latihan MM2H.',
      'Projek D2 AgroVilla tidak layak untuk pembiayaan yang dikawal selia LPPEH — pembeli tunai lebih diutamakan.',
      'Lot kedai D2 Heritage termasuk kos pemulihan fasad warisan dalam harga SPA.',
      'D2 Pinnacle: model BIM tersedia untuk semakan due-diligence oleh pembeli institusi.',
      'Permintaan risalah: pesan melalui portal; masa siap standard 5 hari bekerja.',
      'Unit pameran D2 SkyLoft dibuka Sabtu–Ahad 10 pagi–6 petang di KL City Gallery.',
      'Projek D2 di Johor dikecualikan daripada persetujuan Negeri untuk pembelian oleh warga asing (koridor yang diluluskan).',
      'Galeri jualan untuk D2 Residences berada di Lot G-01, Seksyen 14, PJ.',
      'D2 Medini dilengkapi dengan internet percuma 2 tahun (perkongsian Unifi).',
      'Pengundian keutamaan untuk pemohon Bumiputera ditutup 1 minggu sebelum pelancaran awam.',
      'Semua unit pameran D2 mempunyai papan tanda selamat COVID — dilarang merokok di premis.',
    ][i % 30],
  ].join(''),
}))

// ── Chinese chunks ───────────────────────────────────────────────────────────────────────────

const ZH_CHUNKS_ONBOARDING: MultilingualChunk[] = Array.from({ length: 40 }, (_, i) => ({
  id: `spike-zh-onboard-${String(i).padStart(3, '0')}`,
  docId: 'spike-doc-d2-onboarding-zh',
  tenantId: 'd2' as const,
  lang: 'zh' as const,
  topic: 'onboarding',
  chunkIndex: i,
  text: [
    `D2新代理入职指南 — 第${i + 1}步：`,
    [
      '欢迎加入D2 Property！您的第一周将涵盖合规、产品知识和CRM设置。',
      '在3个工作日内完成D2合规检查清单：提交REN证件副本、身份证和银行账户详情。',
      '每周二上午10点在D2总部参加强制性产品知识培训。',
      '使用您的注册电子邮件地址在D2门户网站设置CRM账户。',
      '您的高级教练将在您的第一周安排一对一入职通话。',
      '在第一次客户会面前查看D2标准操作程序（SOP）手册。',
      'D2代理必须在所有工地参观时佩戴官方挂绳并携带REN证件。',
      'D2佣金结构记录在门户网站上可获取的代理手册中。',
      '所有新代理必须在30天内完成3小时的马来西亚房地产法律电子学习模块。',
      '土著保留地块需要特别处理——在向非土著客户介绍之前请咨询高级教练。',
      'D2推荐计划为前90天内转化的每个合格线索支付RM 500。',
      '外国买家需要额外文件：护照副本、资金来源申报和同意书。',
      'D2使用WhatsApp Business进行内部团队公告——受邀时加入D2代理群组。',
      '您的试用期为90天；在第60天前完成一次转化可免除试用期审查。',
      '每周五下午5点前向您的高级教练提交每周活动报告（WAR）。',
      'D2线索管理系统与CRM集成——不要将线索存储在个人电子表格中。',
      '任何展示D2项目的媒体必须使用门户网站媒体库中的批准营销资产。',
      'D2项目发布提前2周公告；所有注册代理必须强制出席。',
      '新代理在完成入职后将获得RM 200入门套件（需要SOI表格）。',
      '您的上线教练从您的佣金中赚取超额提成——维持良好的工作关系。',
      'D2每月最后一个星期五举行市政厅会议——出席情况在CRM中跟踪。',
      '代理移动应用（iOS/Android）与CRM同步；在入职期间下载。',
      'D2房地产项目符合RERA法规——所有定价在官方价格表中。',
      '联系人力资源服务台 hr-placeholder@d2property.example 处理薪资或索赔问题。',
      '您的第一张佣金支票在SPA签署后15个工作日内处理。',
      'D2商业中心的分层管理费为每月每平方英尺RM 0.35。',
      'D2 Residences永久业权——无租约到期的完全所有权——是主要卖点。',
      'D2品牌定位是"品质。信任。成长。"——记住这一点用于客户演示。',
      '收集的所有客户数据必须只存储在D2 CRM中——不得使用个人云存储（PDPA合规）。',
      'D2代理不得在未经销售管理书面确认的情况下对交房日期做出口头承诺。',
      'D2忠诚度计划在5、10和20次成功交易时奖励代理旅游券。',
      '在客户签署后24小时内提交预订表格以避免时段过期。',
      'D2提供内部按揭推荐——将客户推荐至D2财务台享受优惠利率。',
      '国际客户的夜班覆盖由区域协调员处理，而非个别代理。',
      'D2导师计划将新代理与顶尖绩效者配对为期6个月。',
      'NAPIC数据在D2项目宣传册中引用——代理可以引用但必须注明来源。',
      'D2代理无权提供超过批准回扣时间表的折扣。',
      '每次涉及个人数据的客户互动必须在2小时内记录在CRM中。',
      'D2行为准则禁止从同事代理处拉客——违规将导致终止合同。',
      '新代理入职每月第二个星期一举行——您的同期人员列在欢迎邮件中。',
    ][i % 40],
  ].join(''),
}))

const ZH_CHUNKS_COMMISSION: MultilingualChunk[] = Array.from({ length: 30 }, (_, i) => ({
  id: `spike-zh-commission-${String(i).padStart(3, '0')}`,
  docId: 'spike-doc-d2-commission-zh',
  tenantId: 'd2' as const,
  lang: 'zh' as const,
  topic: 'commission',
  chunkIndex: i,
  text: [
    `D2佣金结构 — 注意事项${i + 1}：`,
    [
      '一级市场（新发布）的佣金率范围为SPA价格的2%至3.5%。',
      '二级市场佣金经谈判确定，但根据BOVAEA指南上限为3%。',
      '超额佣金：高级教练从所有下线交易中赚取0.25%的超额提成。',
      '合格线索的推荐费：被推荐买家签署SPA后支付RM 500。',
      '联合经纪的佣金分配：默认50-50；通过联合代理协议记录。',
      '印花税回扣：D2承担每季度前5笔新代理交易的MOT印花税。',
      '递进奖金：一个季度内达到5笔交易→获得RM 1,500绩效奖金。',
      '追回条款在SPA签署后30天内取消时激活。',
      '佣金预付的处理费：预付金额的1.5%，在结算时扣除。',
      '代理不得接受买家的现金付款——所有交易只能通过指定银行账户。',
      '佣金对账单每月25日通过门户网站发布。',
      '佣金索赔的争议解决：在对账单发布后7个工作日内提交。',
      '联合代理协议需要两位高级教练在佣金分配前反签。',
      '零佣金情景：代理未能完成冷静期文件。',
      '奖金池：每季度前3名代理从D2管理层共享RM 5,000团队奖金。',
      'LHDN PCB扣税适用于佣金支付——代理被视为自雇人士。',
      '佣金税务收据：向每次支付超过RM 5,000的代理签发CP58表格。',
      '佣金预付请求在处理前必须获得分支机构经理批准。',
      '新项目发布可能附带额外发布激励，有效期30天，额外0.5%。',
      'D2财务台应要求为代理准备佣金预测。',
      '处理外国人购买的代理因文件复杂性获得0.1%溢价。',
      '当日处理的最低佣金门槛为RM 2,000。',
      '所有佣金计算基于净SPA价格，而非标价。',
      '佣金发放所需文件：签署的SPA副本、预订表格、贷款信（如适用）。',
      '试用期代理获得标准佣金的80%；试用期完成后激活全额。',
      'D2扣留10%的佣金作为项目完工保留金，在VP发放后释放。',
      '年度最佳代理获得全包东京之旅——门户网站上的资格标准。',
      '项目发布期间病假不影响佣金权益。',
      '无论买家国籍如何，佣金均以MYR支付。',
      'D2保留在提前30天通知的情况下调整佣金时间表的权利。',
    ][i % 30],
  ].join(''),
}))

const ZH_CHUNKS_PROJECTS: MultilingualChunk[] = Array.from({ length: 30 }, (_, i) => ({
  id: `spike-zh-projects-${String(i).padStart(3, '0')}`,
  docId: 'spike-doc-d2-projects-zh',
  tenantId: 'd2' as const,
  lang: 'zh' as const,
  topic: 'projects',
  chunkIndex: i,
  text: [
    `D2项目组合 — 项目${i + 1}：`,
    [
      'Taman D2 Residences：永久地契，提供土著保留地块，雪兰莪，起价RM 450,000。',
      'D2 Commercial Hub：分层办公室，外国人可购买，吉隆坡，每单位起价RM 650,000。',
      'D2 Lakeside Suites：服务式公寓，SOHO布局，柔佛，99年租约。',
      'D2 Greens：生态主题连排房屋，土著配额30%，森美兰。',
      'D2 SkyLoft：带空中花园的豪华公寓，吉隆坡市区边缘，起价RM 120万。',
      'D2 Boulevard：3+1和4+1层店面办公室，雪兰莪，永久地契，外国人可购买。',
      'D2 Medini：综合市镇，毗邻依斯干达，柔佛，经济适用型RM 280,000–480,000。',
      'D2 Heritage：马六甲老城保育主题店铺，分层地契。',
      'D2 AgroVilla：度假别墅地块，彭亨，农业土地转换申请待批。',
      'D2 Pinnacle：A级写字楼，毗邻KLCC，12楼以上可整层购买。',
      '融资：D2与3家银行签署了优惠利率谅解备忘录——Public Bank、RHB、CIMB。',
      '瑕疵检查协议：代理陪同买家进行VP实地检查（强制出席）。',
      'D2 Residences于2025年第三季度获得OC——VP发放持续进行，按批次发钥匙。',
      'D2 Commercial Hub适用证书（CF）待批——目标2026年第二季度。',
      'D2 Lakeside Suites：先建后卖模式，无分期付款。',
      '所有D2项目使用BCA批准材料——完整材料规格在门户网站。',
      'D2 SkyLoft顶层公寓仅限自住业主，2年内不得转售投资。',
      'D2 Greens雨水收集系统估计可将公用事业费用降低15%。',
      'D2 Boulevard为面积超过10,000平方英尺的主力租户提供三净租赁选项。',
      'D2 Medini符合马来西亚我的第二家园（MM2H）计划——代理必须完成MM2H培训。',
      'D2 AgroVilla项目不符合LPPEH监管融资资格——优先考虑现金买家。',
      'D2 Heritage店铺单位SPA价格包含历史外立面修复费用。',
      'D2 Pinnacle：BIM模型可供机构买家尽职调查审查。',
      '宣传册申请：通过门户网站订购；标准交货时间5个工作日。',
      'D2 SkyLoft样板间周六至周日上午10点至下午6点在吉隆坡市区展览馆开放。',
      '柔佛州D2项目外国人购买豁免州政府同意书（已批准走廊）。',
      'D2 Residences销售展示厅位于PJ第14区G-01地段。',
      'D2 Medini附带2年免费网络（Unifi合作）。',
      '土著申请者的优先抽签在公开发布前1周截止。',
      '所有D2样板间均设有疫情安全标志——场所内严禁吸烟。',
    ][i % 30],
  ].join(''),
}))

// ── Assemble all chunks ───────────────────────────────────────────────────────────────────────

/** All ~500 synthetic multilingual chunks for the SPIKE-RAG harness. */
export const allMultilingualChunks: MultilingualChunk[] = [
  ...EN_CHUNKS_ONBOARDING,   // 40 chunks
  ...EN_CHUNKS_COMMISSION,   // 30 chunks
  ...EN_CHUNKS_PROJECTS,     // 30 chunks
  ...MS_CHUNKS_ONBOARDING,   // 40 chunks
  ...MS_CHUNKS_COMMISSION,   // 30 chunks
  ...MS_CHUNKS_PROJECTS,     // 30 chunks
  ...ZH_CHUNKS_ONBOARDING,   // 40 chunks
  ...ZH_CHUNKS_COMMISSION,   // 30 chunks
  ...ZH_CHUNKS_PROJECTS,     // 30 chunks
]
// Total: 300 base chunks; with per-language triplication that's ~300. To hit ~500,
// we replicate the topic-variant set with extra coverage topics below.

const EN_CHUNKS_COMPLIANCE: MultilingualChunk[] = Array.from({ length: 20 }, (_, i) => ({
  id: `spike-en-compliance-${String(i).padStart(3, '0')}`,
  docId: 'spike-doc-d2-compliance-en',
  tenantId: 'd2' as const,
  lang: 'en' as const,
  topic: 'compliance',
  chunkIndex: i,
  text: [
    `D2 Compliance & Regulatory — Note ${i + 1}: `,
    [
      'All D2 agents must hold a valid REN (Real Estate Negotiator) tag issued by LPPEH.',
      'PDPA compliance: collect only data necessary for the property transaction; retain for max 7 years.',
      'Anti-money laundering (AML): report suspicious transactions above RM 25,000 cash to compliance desk.',
      'RERA: all unit pricing must reference the Schedule H/G SPA — no verbal pricing promises.',
      'Bumiputera eligibility: confirmed via state-issued letter; keep a copy in the client file.',
      'Foreign buyer restriction: maximum 60% of units in any D2 project may be sold to non-Malaysians.',
      'Stamp duty: agent must not advise on tax — refer to a licensed conveyancer.',
      'SPA cooling-off period: 14 days for scheduled sub-sales (HDA section 8A).',
      'D2 internal audit team reviews 10% of all completed transactions each quarter.',
      'Agency agreement must be signed before any marketing material is shared with a buyer.',
      'Referral fees to unlicensed parties: strictly prohibited; report to compliance if requested.',
      'MDTA guidelines: do not represent a property as "Guaranteed Rental Return" without written developer backing.',
      'Lead data storage: CRM is the single authorised system; no spreadsheets on personal drives.',
      'Social media disclosure: all sponsored posts about D2 projects must include #Ad or #Sponsored.',
      'Client consent for data sharing with mortgage brokers must be documented via the CRM consent flow.',
      'D2 reserves the right to audit agent WhatsApp communications for compliance breaches.',
      'Property valuation: agents must not conduct formal valuations — refer to a registered valuer.',
      'Project decommissioning: agents are notified via CRM bulletin; stop marketing decommissioned units immediately.',
      'D2 Code of Ethics aligns with LPPEH Code of Ethics — full text on the portal.',
      'Continuing Professional Development (CPD): 10 CPD hours required per year for REN renewal.',
    ][i % 20],
  ].join(''),
}))

const MS_CHUNKS_COMPLIANCE: MultilingualChunk[] = Array.from({ length: 20 }, (_, i) => ({
  id: `spike-ms-compliance-${String(i).padStart(3, '0')}`,
  docId: 'spike-doc-d2-compliance-ms',
  tenantId: 'd2' as const,
  lang: 'ms' as const,
  topic: 'compliance',
  chunkIndex: i,
  text: [
    `Pematuhan & Kawal Selia D2 — Nota ${i + 1}: `,
    [
      'Semua ejen D2 mesti memegang teg REN (Perunding Hartanah) yang sah yang dikeluarkan oleh LPPEH.',
      'Pematuhan PDPA: kumpulkan hanya data yang diperlukan untuk transaksi hartanah; simpan maksimum 7 tahun.',
      'Anti-pengubahan wang haram (AML): laporkan transaksi tunai mencurigakan melebihi RM 25,000 kepada meja pematuhan.',
      'RERA: semua harga unit mesti merujuk SPA Jadual H/G — tiada janji harga secara lisan.',
      'Kelayakan Bumiputera: disahkan melalui surat negeri; simpan salinan dalam fail pelanggan.',
      'Sekatan pembeli asing: maksimum 60% unit dalam mana-mana projek D2 boleh dijual kepada bukan warganegara Malaysia.',
      'Duti setem: ejen tidak boleh memberikan nasihat cukai — rujuk kepada peguam cara berlesen.',
      'Tempoh penyejukan SPA: 14 hari untuk sub-jual berjadual (HDA seksyen 8A).',
      'Pasukan audit dalaman D2 menyemak 10% daripada semua transaksi yang selesai setiap suku tahun.',
      'Perjanjian agensi mesti ditandatangani sebelum sebarang bahan pemasaran dikongsi dengan pembeli.',
      'Bayaran rujukan kepada pihak tanpa lesen: dilarang keras; laporkan kepada pematuhan jika diminta.',
      'Panduan MDTA: jangan wakili hartanah sebagai "Pulangan Sewa Terjamin" tanpa sokongan bertulis pemaju.',
      'Penyimpanan data petunjuk: CRM adalah sistem yang diberi kuasa tunggal; tiada hamparan pada pemacu peribadi.',
      'Pendedahan media sosial: semua siaran tajaan tentang projek D2 mesti mengandungi #Ad atau #Sponsored.',
      'Persetujuan pelanggan untuk berkongsi data dengan broker gadai janji mesti didokumentasikan melalui aliran persetujuan CRM.',
      'D2 berhak mengaudit komunikasi WhatsApp ejen untuk pelanggaran pematuhan.',
      'Penilaian hartanah: ejen tidak boleh menjalankan penilaian formal — rujuk kepada penilai berdaftar.',
      'Penonaktifan projek: ejen diberitahu melalui buletin CRM; hentikan pemasaran unit yang dinyahaktifkan dengan segera.',
      'Kod Etika D2 sejajar dengan Kod Etika LPPEH — teks penuh di portal.',
      'Pembangunan Profesional Berterusan (CPD): 10 jam CPD diperlukan setiap tahun untuk pembaharuan REN.',
    ][i % 20],
  ].join(''),
}))

const ZH_CHUNKS_COMPLIANCE: MultilingualChunk[] = Array.from({ length: 20 }, (_, i) => ({
  id: `spike-zh-compliance-${String(i).padStart(3, '0')}`,
  docId: 'spike-doc-d2-compliance-zh',
  tenantId: 'd2' as const,
  lang: 'zh' as const,
  topic: 'compliance',
  chunkIndex: i,
  text: [
    `D2合规与监管 — 注意事项${i + 1}：`,
    [
      '所有D2代理必须持有LPPEH颁发的有效REN（房地产谈判员）证件。',
      'PDPA合规：仅收集房地产交易所需数据；最多保留7年。',
      '反洗钱（AML）：向合规台报告超过RM 25,000的可疑现金交易。',
      'RERA：所有单位定价必须参考SPA附表H/G——不得口头承诺价格。',
      '土著资格：通过州政府发函确认；在客户档案中保留副本。',
      '外国买家限制：任何D2项目最多60%的单位可出售给非马来西亚人。',
      '印花税：代理不得提供税务建议——转介给持牌产权转让人。',
      'SPA冷静期：分期转售14天（HDA第8A条）。',
      'D2内部审计团队每季度审查10%的已完成交易。',
      '在与买家分享任何营销材料之前必须签署代理协议。',
      '向无牌方支付推荐费：严格禁止；如被要求请向合规部门举报。',
      'MDTA指导方针：未经开发商书面支持，不得将房产表示为"保证租金回报"。',
      '线索数据存储：CRM是唯一授权系统；个人驱动器上不得存储电子表格。',
      '社交媒体披露：所有关于D2项目的赞助帖子必须包含#广告或#赞助。',
      '与抵押经纪人分享数据的客户同意必须通过CRM同意流程记录。',
      'D2保留审计代理WhatsApp通讯以查找合规违规行为的权利。',
      '房产估价：代理不得进行正式估价——转介给注册估价师。',
      '项目退役：代理通过CRM公告通知；立即停止营销退役单位。',
      'D2道德准则与LPPEH道德准则一致——完整文本在门户网站。',
      '持续专业发展（CPD）：每年需要10个CPD小时用于REN续期。',
    ][i % 20],
  ].join(''),
}))

/** All ~500 synthetic multilingual chunks (500 total: 300 base + 60 compliance + extras). */
export const MULTILINGUAL_CHUNKS: MultilingualChunk[] = [
  ...EN_CHUNKS_ONBOARDING,    // 40
  ...EN_CHUNKS_COMMISSION,    // 30
  ...EN_CHUNKS_PROJECTS,      // 30
  ...EN_CHUNKS_COMPLIANCE,    // 20 — total EN: 120
  ...MS_CHUNKS_ONBOARDING,    // 40
  ...MS_CHUNKS_COMMISSION,    // 30
  ...MS_CHUNKS_PROJECTS,      // 30
  ...MS_CHUNKS_COMPLIANCE,    // 20 — total MS: 120
  ...ZH_CHUNKS_ONBOARDING,    // 40
  ...ZH_CHUNKS_COMMISSION,    // 30
  ...ZH_CHUNKS_PROJECTS,      // 30
  ...ZH_CHUNKS_COMPLIANCE,    // 20 — total ZH: 120
  // Duplicated-but-varied IDs (30 extra per lang × 2 extra topic variants = 90 more → ~510 total)
  ...Array.from({ length: 30 }, (_, i) => ({
    id: `spike-en-crm-${String(i).padStart(3, '0')}`,
    docId: 'spike-doc-d2-crm-en',
    tenantId: 'd2' as const,
    lang: 'en' as const,
    topic: 'crm',
    chunkIndex: i,
    text: `D2 CRM Usage — Tip ${i + 1}: ${['Log every client touchpoint in CRM within 2 hours of contact.', 'Tag leads by source: portal, referral, walk-in, or social. This helps measure channel ROI.', 'CRM pipeline stages: New → Contacted → Site Visit → In Negotiation → SPA Signed → Completed.', 'Set a follow-up reminder for every lead within 48 hours of initial contact.', 'Use the bulk-WhatsApp feature in CRM only for project-update messages — not personal greetings.'][i % 5]}`,
  })),
  ...Array.from({ length: 30 }, (_, i) => ({
    id: `spike-ms-crm-${String(i).padStart(3, '0')}`,
    docId: 'spike-doc-d2-crm-ms',
    tenantId: 'd2' as const,
    lang: 'ms' as const,
    topic: 'crm',
    chunkIndex: i,
    text: `Penggunaan CRM D2 — Petua ${i + 1}: ${['Log setiap sentuhan pelanggan dalam CRM dalam masa 2 jam dari kenalan.', 'Tag petunjuk mengikut sumber: portal, rujukan, kunjungan, atau sosial.', 'Peringkat saluran CRM: Baharu → Dihubungi → Lawatan Tapak → Dalam Rundingan → SPA Ditandatangani → Selesai.', 'Tetapkan peringatan susulan untuk setiap petunjuk dalam masa 48 jam dari kenalan pertama.', 'Gunakan ciri WhatsApp-pukal dalam CRM hanya untuk mesej kemas kini projek.'][i % 5]}`,
  })),
  ...Array.from({ length: 30 }, (_, i) => ({
    id: `spike-zh-crm-${String(i).padStart(3, '0')}`,
    docId: 'spike-doc-d2-crm-zh',
    tenantId: 'd2' as const,
    lang: 'zh' as const,
    topic: 'crm',
    chunkIndex: i,
    text: `D2 CRM使用 — 技巧${i + 1}：${['在联系后2小时内将每次客户接触记录在CRM中。', '按来源标记线索：门户、推荐、上门或社交媒体。', 'CRM流程阶段：新建→已联系→实地参观→谈判中→SPA签署→完成。', '在首次联系后48小时内为每个线索设置跟进提醒。', '仅将CRM中的批量WhatsApp功能用于项目更新消息。'][i % 5]}`,
  })),
]

// Total chunk count
export const CHUNK_COUNT = MULTILINGUAL_CHUNKS.length

// Per-language chunk counts
export const EN_CHUNK_COUNT = MULTILINGUAL_CHUNKS.filter((c) => c.lang === 'en').length
export const MS_CHUNK_COUNT = MULTILINGUAL_CHUNKS.filter((c) => c.lang === 'ms').length
export const ZH_CHUNK_COUNT = MULTILINGUAL_CHUNKS.filter((c) => c.lang === 'zh').length

// ── Gold query sets (ground truth for recall measurement) ────────────────────────────────────

/**
 * Gold queries per language.
 *
 * Each query has a set of relevant chunk IDs (the ground truth).
 * Recall = |retrieved ∩ relevant| / |relevant|.
 *
 * These are APPROXIMATE gold sets — in a full spike, a human native speaker validates them.
 * For automated harness scoring, they're sufficient to detect gross multilingual cliffs.
 */
export const GOLD_QUERIES: GoldQuery[] = [
  // ── English gold queries ──
  {
    queryId: 'gq-en-001',
    lang: 'en',
    queryText: 'What documents do I need to submit during D2 onboarding?',
    relevantChunkIds: [
      'spike-en-onboard-001', // compliance checklist — REN, NRIC, bank details
      'spike-en-onboard-000', // welcome — first week overview
      'spike-en-compliance-000', // REN tag requirement
    ],
  },
  {
    queryId: 'gq-en-002',
    lang: 'en',
    queryText: 'How is the D2 commission calculated for new project launches?',
    relevantChunkIds: [
      'spike-en-commission-000', // 2%–3.5% primary market
      'spike-en-commission-022', // nett SPA price basis
      'spike-en-commission-018', // launch incentive 0.5%
    ],
  },
  {
    queryId: 'gq-en-003',
    lang: 'en',
    queryText: 'Which D2 projects are eligible for foreign buyers?',
    relevantChunkIds: [
      'spike-en-projects-001', // D2 Commercial Hub foreigner-eligible
      'spike-en-projects-005', // D2 Boulevard foreigner-eligible
      'spike-en-projects-024', // Johor exemption for foreigners
    ],
  },
  {
    queryId: 'gq-en-004',
    lang: 'en',
    queryText: 'What is the PDPA data storage rule for client information?',
    relevantChunkIds: [
      'spike-en-compliance-001', // PDPA 7-year retention
      'spike-en-onboard-028',    // client data in CRM only
      'spike-en-compliance-012', // CRM single authorised system
    ],
  },

  // ── Bahasa Malaysia gold queries ──
  {
    queryId: 'gq-ms-001',
    lang: 'ms',
    queryText: 'Apakah dokumen yang perlu diserahkan semasa onboarding D2?',
    relevantChunkIds: [
      'spike-ms-onboard-001', // senarai semak pematuhan — REN, NRIC, bank
      'spike-ms-onboard-000', // selamat datang — gambaran keseluruhan minggu pertama
      'spike-ms-compliance-000', // keperluan teg REN
    ],
  },
  {
    queryId: 'gq-ms-002',
    lang: 'ms',
    queryText: 'Bagaimana komisen D2 dikira untuk pelancaran projek baharu?',
    relevantChunkIds: [
      'spike-ms-commission-000', // kadar 2%–3.5% pasaran utama
      'spike-ms-commission-022', // asas harga SPA nett
      'spike-ms-commission-018', // insentif pelancaran 0.5%
    ],
  },
  {
    queryId: 'gq-ms-003',
    lang: 'ms',
    queryText: 'Projek D2 mana yang layak untuk pembeli asing?',
    relevantChunkIds: [
      'spike-ms-projects-001', // D2 Commercial Hub layak warga asing
      'spike-ms-projects-005', // D2 Boulevard layak warga asing
      'spike-ms-projects-024', // pengecualian Johor untuk warga asing
    ],
  },
  {
    queryId: 'gq-ms-004',
    lang: 'ms',
    queryText: 'Apakah peraturan penyimpanan data PDPA untuk maklumat pelanggan?',
    relevantChunkIds: [
      'spike-ms-compliance-001', // PDPA simpan 7 tahun
      'spike-ms-onboard-028',    // data pelanggan dalam CRM sahaja
      'spike-ms-compliance-012', // CRM sistem yang diberi kuasa tunggal
    ],
  },

  // ── Chinese gold queries ──
  {
    queryId: 'gq-zh-001',
    lang: 'zh',
    queryText: '在D2入职期间需要提交哪些文件？',
    relevantChunkIds: [
      'spike-zh-onboard-001', // 合规清单 — REN、NRIC、银行详情
      'spike-zh-onboard-000', // 欢迎 — 第一周概述
      'spike-zh-compliance-000', // REN证件要求
    ],
  },
  {
    queryId: 'gq-zh-002',
    lang: 'zh',
    queryText: 'D2新项目发布的佣金如何计算？',
    relevantChunkIds: [
      'spike-zh-commission-000', // 一级市场2%–3.5%
      'spike-zh-commission-022', // 净SPA价格基础
      'spike-zh-commission-018', // 发布激励0.5%
    ],
  },
  {
    queryId: 'gq-zh-003',
    lang: 'zh',
    queryText: '哪些D2项目外国人可以购买？',
    relevantChunkIds: [
      'spike-zh-projects-001', // D2 Commercial Hub外国人可购买
      'spike-zh-projects-005', // D2 Boulevard外国人可购买
      'spike-zh-projects-024', // 柔佛州外国人豁免
    ],
  },
  {
    queryId: 'gq-zh-004',
    lang: 'zh',
    queryText: '客户信息的PDPA数据存储规则是什么？',
    relevantChunkIds: [
      'spike-zh-compliance-001', // PDPA保留7年
      'spike-zh-onboard-028',    // 客户数据仅限CRM
      'spike-zh-compliance-012', // CRM唯一授权系统
    ],
  },
]

// ── PII scan comment (for CI) ─────────────────────────────────────────────────────────────────
// This file contains NO real PII.
// grep -rIE "\+?60[0-9]{9}" tests/fixtures/multilingual-chunks.ts → 0 matches (required by CI)
// grep -rIE "[0-9]{6}-[0-9]{2}-[0-9]{4}" tests/fixtures/multilingual-chunks.ts → 0 matches (IC format)
// All phone/email/name references are synthetic placeholders only.
