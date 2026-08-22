async function main(): Promise<void> {
  const bonk = "8yrz49cncgqoCCKfi4fmH9h6sFy3ikjrm2DiDMaJf5xw";
  const ethUsdc = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";

  const tests = [
    { label: "bonk no-params", url: `https://api.geckoterminal.com/api/v2/networks/solana/pools/${bonk}/trades` },
    { label: "eth usdc no-params", url: `https://api.geckoterminal.com/api/v2/networks/eth/pools/${ethUsdc}/trades` },
    { label: "eth usdc filtered", url: `https://api.geckoterminal.com/api/v2/networks/eth/pools/${ethUsdc}/trades?trade_volume_in_usd_greater_than=500` },
  ];

  for (const t of tests) {
    try {
      const res = await fetch(t.url, { signal: AbortSignal.timeout(15000) });
      const j = await res.json().catch(() => null);
      const rows = j?.data?.length ?? -1;
      console.log(`${t.label}: HTTP ${res.status} rows=${rows}`);
      if (rows > 0 && j?.data?.[0]) console.log(`  kind=${j.data[0].attributes.kind} usd=${j.data[0].attributes.volume_in_usd}`);
    } catch (e) {
      console.log(`${t.label}: THREW ${(e as Error).message.slice(0, 60)}`);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
}

main();
