import { auditEvmViaHoneypot } from "../src/sources/honeypot.js";

const r = await auditEvmViaHoneypot("0x6982508145454ce325ddbe47a25d4ec3d2311933");
if (!r) {
  console.log("RESULT: null");
} else {
  console.log(`RESULT: chain=${r.chainName} symbol=${r.result.token?.symbol} sim=${r.result.simulationSuccess} hp=${r.result.honeypotResult?.isHoneypot}`);
}
