const url = "https://api.honeypot.is/v2/IsHoneypot?address=0x6982508145454ce325ddbe47a25d4ec3d2311933&chainID=1";

for (const label of ["bare", "ua"]) {
  try {
    const headers = label === "ua" ? { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", accept: "application/json" } : {};
    const t0 = Date.now();
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    console.log(`${label}: HTTP ${res.status} in ${Date.now() - t0}ms ct=${res.headers.get("content-type")} len=${text.length}`);
    console.log(`  head: ${text.slice(0, 160).replace(/\s+/g, " ")}`);
  } catch (e) {
    console.log(`${label}: THREW ${e.message}`);
  }
}
