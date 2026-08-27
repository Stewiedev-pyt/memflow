import express from "express";
import crypto from "crypto";
import { MemflowAgent } from "./index.js";

// ─── MASUMI MIP-003 PROTOCOL ADAPTER ──────────────────────
// Full implementation with payment escrow support
// Docs: https://www.masumi.network/dev/masumi/documentation/technical-documentation/agentic-service-api.md

interface Job {
  id: string;
  blockchainIdentifier: string;
  status: "awaiting_payment" | "running" | "awaiting_input" | "completed" | "failed";
  input: Record<string, any>;
  result: any;
  resultHash?: string;
  error?: string;
  createdAt: number;
  // Timing (in seconds from creation)
  unlockTime: number;
  submitResultTime: number;
  externalDisputeUnlockTime: number;
}

const jobs = new Map<string, Job>();

const agent = new MemflowAgent({
  autoRun: false,
  onCall: () => {},
});

// ─── CONFIG ─────────────────────────────────────────────────
const JOB_UNLOCK_SECONDS = 300;          // 5 min dispute window
const SUBMIT_RESULT_SECONDS = 120;        // 2 min to submit result
const EXTERNAL_DISPUTE_SECONDS = 600;     // 10 min external dispute

// ─── INPUT SCHEMA ──────────────────────────────────────────
const INPUT_SCHEMA = {
  input_data: [
    {
      id: "text",
      type: "string",
      name: "Natural language command",
      description: "e.g. 'scan PEPE', 'audit WIF', 'calls', 'gems'",
    },
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

// ─── HELPERS ────────────────────────────────────────────────
function generateBlockchainId(): string {
  return crypto.randomBytes(32).toString("hex");
}

function computeResultHash(result: any): string {
  const canonical = JSON.stringify(result, Object.keys(result).sort());
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

// ─── EXPRESS SERVER ─────────────────────────────────────────
export function createMasumiServer(port = 8080): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // ─── MIP-003 ENDPOINTS ─────────────────────────────────

  // Request logger
  app.use((req, _res, next) => {
    console.log(`[masumi] ${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
  });

  // Legacy health check (Railway compatibility)
  app.get("/", (_req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  });

  /**
   * GET /availability — Health check
   * Required by MIP-003. Must return { status: "ok" } when service is operational.
   */
  app.get("/availability", (_req, res) => {
    res.json({ status: "ok" });
  });

  /**
   * GET /input_schema — Expected input format
   * Tells buyers what input your agent accepts.
   */
  app.get("/input_schema", (_req, res) => {
    res.json(INPUT_SCHEMA);
  });

  /**
   * GET /demo — Example input/output
   * Used by Sokosumi marketplace to show what your agent does.
   */
  app.get("/demo", (_req, res) => {
    res.json(DEMO);
  });

  /**
   * POST /start_job — Initiate a new job
   *
   * MIP-003 flow:
   * 1. Buyer calls this endpoint
   * 2. Returns job_id + blockchainIdentifier + timing parameters
   * 3. Buyer uses blockchainIdentifier to lock funds via their Masumi Node
   * 4. Once funds locked, buyer calls /status to confirm payment received
   * 5. Agent begins processing
   *
   * For FREE agents: skip payment, go straight to running
   */
  app.post("/start_job", async (req, res) => {
    try {
      const { input_data, identifier_from_purchaser } = req.body;
      const text = input_data?.text;
      if (!text || typeof text !== "string") {
        res.status(400).json({ error: "input_data.text is required" });
        return;
      }

      const now = Date.now();
      const blockchainIdentifier = generateBlockchainId();

      const job: Job = {
        id: `memflow-${now}-${Math.random().toString(36).slice(2, 8)}`,
        blockchainIdentifier,
        status: "awaiting_payment",
        input: { text, purchaser: identifier_from_purchaser },
        result: null,
        createdAt: now,
        unlockTime: JOB_UNLOCK_SECONDS,
        submitResultTime: SUBMIT_RESULT_SECONDS,
        externalDisputeUnlockTime: EXTERNAL_DISPUTE_SECONDS,
      };

      jobs.set(job.id, job);

      console.log(`[masumi] 📥 NEW JOB: ${job.id}`);
      console.log(`[masumi]    Input: "${text}"`);
      console.log(`[masumi]    Purchaser: ${identifier_from_purchaser ?? "unknown"}`);
      console.log(`[masumi]    Blockchain ID: ${blockchainIdentifier}`);

      // MIP-003 response format
      res.json({
        job_id: job.id,
        blockchain_identifier: blockchainIdentifier,
        // Timing parameters (seconds)
        unlock_time: JOB_UNLOCK_SECONDS,
        submit_result_time: SUBMIT_RESULT_SECONDS,
        external_dispute_unlock_time: EXTERNAL_DISPUTE_SECONDS,
      });

      // For free agents or testing: auto-start after a short delay
      if (process.env.MASUMI_FREE === "true") {
        startJobProcessing(job.id);
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * GET /status?job_id=X — Get job status
   *
   * Returns:
   * - awaiting_payment: waiting for buyer to lock funds
   * - running: agent is processing
   * - awaiting_input: HITL — buyer needs to provide more input
   * - completed: result ready
   * - failed: error occurred
   */
  app.get("/status", (req, res) => {
    const jobId = req.query.job_id as string;
    if (!jobId) {
      res.status(400).json({ error: "job_id query param required" });
      return;
    }

    const job = jobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }

    const response: any = { status: job.status };

    if (job.status === "completed") {
      response.result = job.result;
      response.result_hash = job.resultHash;
    } else if (job.status === "failed") {
      response.error = job.error;
    }

    res.json(response);
  });

  /**
   * POST /payment_notification — Buyer's node notifies that payment is locked
   * This triggers the agent to start processing.
   */
  app.post("/payment_notification", (req, res) => {
    const { job_id } = req.body;
    const job = jobs.get(job_id);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }

    if (job.status !== "awaiting_payment") {
      res.status(400).json({ error: `job is ${job.status}, not awaiting_payment` });
      return;
    }

    // Start processing
    startJobProcessing(job_id);
    res.json({ status: "ok" });
  });

  /**
   * POST /provide_input — Human-in-the-loop input
   * Buyer provides additional input for jobs that require it.
   */
  app.post("/provide_input", (req, res) => {
    const { job_id, input_data } = req.body;
    const job = jobs.get(job_id);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }

    if (job.status !== "awaiting_input") {
      res.status(400).json({ error: `job is ${job.status}, not awaiting_input` });
      return;
    }

    // Re-process with additional input
    const combined = `${job.input.text} ${JSON.stringify(input_data)}`;
    job.status = "running";
    job.input = { ...job.input, additional: input_data };

    processJob(job, combined);
    res.json({ job_id });
  });

  // ─── INTERNAL PROCESSING ───────────────────────────────

  function startJobProcessing(jobId: string) {
    const job = jobs.get(jobId);
    if (!job || job.status !== "awaiting_payment") return;

    job.status = "running";
    processJob(job, job.input.text);
  }

  async function processJob(job: Job, text: string) {
    console.log(`[masumi] ⏳ Processing job ${job.id}: "${text}"`);
    try {
      const response = await agent.process(text);

      if (response.success) {
        job.result = {
          action: response.action,
          data: response.data,
          timestamp: response.timestamp,
        };
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

  // ─── AGENT INFO (discovery) ─────────────────────────────
  app.get("/info", (_req, res) => {
    res.json({
      name: "stewie",
      description: "Meme token intelligence agent — scan, audit, track, and find trading signals on Solana, ETH, BNB, and Base.",
      version: "1.0.0",
      capabilities: [
        "token scanning",
        "security audit",
        "holder analysis",
        "trading calls",
        "gem finder",
        "market overview",
        "news",
      ],
      chains: ["solana", "ethereum", "bsc", "base"],
    });
  });

  // ─── CLEANUP ────────────────────────────────────────────
  setInterval(() => {
    const cutoff = Date.now() - 3_600_000;
    for (const [id, job] of jobs) {
      if (job.createdAt < cutoff) jobs.delete(id);
    }
  }, 600_000);

  // ─── START SERVER ───────────────────────────────────────
  app.listen(port, () => {
    console.log(`[masumi] MIP-003 agent server on port ${port}`);
    console.log(`[masumi] Free mode: ${process.env.MASUMI_FREE === "true" ? "ON" : "OFF"}`);
  });

  return app;
}

// ─── CLI ENTRY POINT ────────────────────────────────────────
const port = parseInt(process.env.PORT ?? "8080", 10);
createMasumiServer(port);
