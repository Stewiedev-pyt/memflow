import http from "node:http";
import crypto from "node:crypto";

// ─── JOB STORE ───────────────────────────────────────────
interface Job {
  id: string;
  blockchainIdentifier: string;
  status: "awaiting_payment" | "running" | "completed" | "failed";
  input: Record<string, any>;
  result: any;
  resultHash?: string;
  error?: string;
  createdAt: number;
  unlockTime: number;
  submitResultTime: number;
  externalDisputeUnlockTime: number;
}

const jobs = new Map<string, Job>();

function generateBlockchainId(): string {
  return crypto.randomBytes(32).toString("hex");
}

function computeResultHash(result: any): string {
  const canonical = JSON.stringify(result, Object.keys(result).sort());
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function generateJobId(): string {
  return `memflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Lazy-load agent to avoid circular deps
let agentProcess: ((text: string) => Promise<any>) | null = null;
async function getAgentProcess() {
  if (!agentProcess) {
    const { MemflowAgent } = await import("./agent/index.js");
    const agent = new MemflowAgent({ autoRun: false, onCall: () => {} });
    agentProcess = (text: string) => agent.process(text);
  }
  return agentProcess;
}

// ─── INPUT SCHEMA ───────────────────────────────────────
const INPUT_SCHEMA = {
  input_data: [
    { id: "text", type: "string", name: "Natural language command" },
  ],
};

const DEMO = {
  input_data: { text: "scan PEPE" },
  output_data: {
    agent: "stewie",
    action: "scan",
    data: {
      symbol: "PEPE",
      chain: "ethereum",
      price: "$0.00001234",
      mcap: "$5.12B",
      liquidity: "$89.2M",
      riskLevel: "LOW",
    },
  },
};

// ─── ROUTING ─────────────────────────────────────────────
function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

export function startHealthServer(port = Number(process.env.PORT ?? 3000)): void {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    console.log(`[http] ${new Date().toISOString()} ${method} ${path}`);

    // ─── LEGACY HEALTH ───
    if (path === "/" && method === "GET") {
      return json(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
    }

    // ─── MASUMI MIP-003 ───
    if (path === "/availability" && method === "GET") {
      return json(res, 200, { status: "ok" });
    }

    if (path === "/input_schema" && method === "GET") {
      return json(res, 200, INPUT_SCHEMA);
    }

    if (path === "/demo" && method === "GET") {
      return json(res, 200, DEMO);
    }

    if (path === "/info" && method === "GET") {
      return json(res, 200, {
        name: "stewie",
        description: "Meme token intelligence agent — scan, audit, track, and find trading signals on Solana, ETH, BNB, and Base.",
        version: "1.0.0",
        capabilities: ["token scanning", "security audit", "holder analysis", "trading calls", "gem finder", "market overview", "news"],
        chains: ["solana", "ethereum", "bsc", "base"],
      });
    }

    if (path === "/start_job" && method === "POST") {
      const body = await parseBody(req);
      const text = body.input_data?.text;
      if (!text || typeof text !== "string") {
        return json(res, 400, { error: "input_data.text is required" });
      }

      const blockchainIdentifier = generateBlockchainId();
      const job: Job = {
        id: generateJobId(),
        blockchainIdentifier,
        status: "awaiting_payment",
        input: { text, purchaser: body.identifier_from_purchaser },
        result: null,
        createdAt: Date.now(),
        unlockTime: 300,
        submitResultTime: 120,
        externalDisputeUnlockTime: 600,
      };
      jobs.set(job.id, job);

      console.log(`[masumi] 📥 NEW JOB: ${job.id} — "${text}"`);

      // Free mode: auto-process
      if (process.env.MASUMI_FREE === "true") {
        job.status = "running";
        processJob(job);
      }

      return json(res, 200, {
        job_id: job.id,
        blockchain_identifier: blockchainIdentifier,
        unlock_time: job.unlockTime,
        submit_result_time: job.submitResultTime,
        external_dispute_unlock_time: job.externalDisputeUnlockTime,
      });
    }

    if (path === "/status" && method === "GET") {
      const jobId = url.searchParams.get("job_id");
      if (!jobId) return json(res, 400, { error: "job_id query param required" });
      const job = jobs.get(jobId);
      if (!job) return json(res, 404, { error: "job not found" });

      const resp: any = { status: job.status };
      if (job.status === "completed") { resp.result = job.result; resp.result_hash = job.resultHash; }
      if (job.status === "failed") { resp.error = job.error; }
      return json(res, 200, resp);
    }

    if (path === "/payment_notification" && method === "POST") {
      const body = await parseBody(req);
      const job = jobs.get(body.job_id);
      if (!job) return json(res, 404, { error: "job not found" });
      if (job.status !== "awaiting_payment") return json(res, 400, { error: `job is ${job.status}` });
      job.status = "running";
      processJob(job);
      return json(res, 200, { status: "ok" });
    }

    if (path === "/provide_input" && method === "POST") {
      const body = await parseBody(req);
      const job = jobs.get(body.job_id);
      if (!job) return json(res, 404, { error: "job not found" });
      if (job.status !== "awaiting_input") return json(res, 400, { error: `job is ${job.status}` });
      job.status = "running";
      job.input = { ...job.input, additional: body.input_data };
      processJob(job, `${job.input.text} ${JSON.stringify(body.input_data)}`);
      return json(res, 200, { job_id: job.id });
    }

    // ─── 404 ───
    json(res, 404, { error: "not found" });
  });

  server.listen(port, () => console.log(`💚 health + masumi agent on :${port}`));

  // Cleanup old jobs every 10 min
  setInterval(() => {
    const cutoff = Date.now() - 3_600_000;
    for (const [id, job] of jobs) {
      if (job.createdAt < cutoff) jobs.delete(id);
    }
  }, 600_000);
}

async function processJob(job: Job, text?: string) {
  console.log(`[masumi] ⏳ Processing job ${job.id}`);
  try {
    const process = await getAgentProcess();
    const response = await process(text ?? job.input.text);
    if (response.success) {
      job.result = { action: response.action, data: response.data, timestamp: response.timestamp };
      job.resultHash = computeResultHash(job.result);
      job.status = "completed";
      console.log(`[masumi] ✅ Job ${job.id} completed — action: ${response.action}`);
    } else {
      job.status = "failed";
      job.error = response.error;
      console.log(`[masumi] ❌ Job ${job.id} failed: ${response.error}`);
    }
  } catch (err) {
    job.status = "failed";
    job.error = (err as Error).message;
    console.log(`[masumi] ❌ Job ${job.id} error: ${(err as Error).message}`);
  }
}
