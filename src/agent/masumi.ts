import express from "express";
import { MemflowAgent } from "./index.js";

// ─── MASUMI MIP-003 PROTOCOL ADAPTER ──────────────────────

interface Job {
  id: string;
  status: "running" | "awaiting_input" | "completed" | "failed";
  input: Record<string, any>;
  result: any;
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, Job>();

const agent = new MemflowAgent({
  autoRun: false,
  onCall: () => {},
});

// ─── INPUT SCHEMA ──────────────────────────────────────────
const INPUT_SCHEMA = {
  input_data: [
    { id: "text", type: "string", name: "Natural language command" },
  ],
};

const DEMO = {
  input_data: { text: "scan PEPE" },
  output_data: {
    action: "scan",
    symbol: "PEPE",
    chain: "ethereum",
    price: "$0.00001234",
    mcap: "$5.12B",
    liquidity: "$89.2M",
    riskLevel: "LOW",
  },
};

// ─── HELPERS ────────────────────────────────────────────────
function generateJobId(): string {
  return `memflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── EXPRESS SERVER ─────────────────────────────────────────
export function createMasumiServer(port = 8080): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Health check
  app.get("/availability", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Input schema
  app.get("/input_schema", (_req, res) => {
    res.json(INPUT_SCHEMA);
  });

  // Demo
  app.get("/demo", (_req, res) => {
    res.json(DEMO);
  });

  // Start job
  app.post("/start_job", async (req, res) => {
    try {
      const { input_data, identifier_from_purchaser } = req.body;
      const text = input_data?.text;
      if (!text || typeof text !== "string") {
        res.status(400).json({ error: "input_data.text is required" });
        return;
      }

      const jobId = generateJobId();
      jobs.set(jobId, {
        id: jobId,
        status: "running",
        input: { text, purchaser: identifier_from_purchaser },
        result: null,
        createdAt: Date.now(),
      });

      // Process async
      agent.process(text).then((response) => {
        const job = jobs.get(jobId);
        if (!job) return;
        if (response.success) {
          job.status = "completed";
          job.result = {
            action: response.action,
            data: response.data,
            timestamp: response.timestamp,
          };
        } else {
          job.status = "failed";
          job.error = response.error;
        }
      }).catch((err) => {
        const job = jobs.get(jobId);
        if (job) {
          job.status = "failed";
          job.error = (err as Error).message;
        }
      });

      res.json({ job_id: jobId });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Job status
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

    if (job.status === "completed") {
      res.json({ status: "completed", result: job.result });
    } else if (job.status === "failed") {
      res.json({ status: "failed", result: null, error: job.error });
    } else {
      res.json({ status: job.status, result: null });
    }
  });

  // Provide input (HITL)
  app.post("/provide_input", (req, res) => {
    const { job_id, input_data } = req.body;
    const job = jobs.get(job_id);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }

    // Re-process with additional input
    const combined = `${job.input.text} ${input_data?.text ?? ""}`;
    job.status = "running";
    job.input = { ...job.input, ...input_data };

    agent.process(combined).then((response) => {
      if (response.success) {
        job.status = "completed";
        job.result = { action: response.action, data: response.data };
      } else {
        job.status = "failed";
        job.error = response.error;
      }
    }).catch((err) => {
      job.status = "failed";
      job.error = (err as Error).message;
    });

    res.json({ job_id });
  });

  // Clean old jobs every 10 min
  setInterval(() => {
    const cutoff = Date.now() - 3_600_000;
    for (const [id, job] of jobs) {
      if (job.createdAt < cutoff) jobs.delete(id);
    }
  }, 600_000);

  app.listen(port, () => {
    console.log(`[masumi] MIP-003 agent server on port ${port}`);
  });

  return app;
}

// ─── CLI ENTRY POINT ────────────────────────────────────────
const port = parseInt(process.env.PORT ?? "8080", 10);
createMasumiServer(port);
