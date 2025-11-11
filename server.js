const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 3001; // We'll run the backend on this port

// === Middleware ===
// 1. Enable CORS for all requests (so React on port 5173 can talk to us)
app.use(cors());

// 2. Enable built-in JSON parsing
app.use(express.json({ limit: "5mb" })); // Allow larger JSON payloads

// === "In-Memory Database" ===
// This variable will hold the article data.
// It's not a real database, but it works for this minimal example.
let latestArticle = null;

// === In-memory logs (for admin pane, demo only) ===
let logs = [];

// Helper to add log entries (newest first)
function addLog(type, data = {}) {
  const log = {
    id: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
    type, // e.g., 'success', 'failure', 'article_received'
    data,
    timestamp: new Date().toISOString(),
  };
  logs.unshift(log);
  // Optionally cap logs to avoid unbounded growth (demo): keep last 1000
  if (logs.length > 1000) logs = logs.slice(0, 1000);
  return log;
}

// === Routes ===

/**
 * [WRITE] POST /api/article
 * The endpoint n8n will send its data TO.
 */
app.post("/api/article", (req, res) => {
  console.log("Received new article from n8n:");
  console.log(JSON.stringify(req.body, null, 2));

  // Store the new article data
  latestArticle = req.body;

  // Log that an article was received (demo admin)
  addLog("article_received", {
    message: "Article received and stored by backend",
    articlePreview: {
      // keep small / not storing huge payloads in list preview
      title: req.body.title || null,
      url: req.body.url || null,
    },
    raw: req.body,
  });

  res.status(200).json({
    status: "success",
    message: "Article received and stored.",
    article_url: "https://alpenity-frontend.vercel.app/",
  });
});

/**
 * [READ] GET /api/article
 * The endpoint React will fetch its data FROM.
 */
app.get("/api/article", (req, res) => {
  if (latestArticle) {
    res.status(200).json(latestArticle);
  } else {
    // If no article has been posted yet
    res.status(404).json({
      status: "not_found",
      message: "No article has been posted by n8n yet.",
    });
  }
});

// --- Admin logging endpoints ---

/**
 * POST /api/logs
 * Accepts either a single log object or an array of log objects from workflow.
 * New/expected incoming schema example (array allowed):
 * [
 *  {
 *    "status": "success",
 *    "workflow_id": "qK8cGeNk3cXA2qbH",
 *    "workflow_name": "Meta Posting workflow",
 *    "execution_id": "433",
 *    "post_link": "https://www.facebook.com/...",
 *    "article_url": null
 *  }
 * ]
 */
app.post("/api/logs", (req, res) => {
  const body = req.body;

  if (!body) {
    return res.status(400).json({ status: "error", message: "Empty body" });
  }

  // Normalize to an array of items
  const items = Array.isArray(body) ? body : [body];

  const created = [];

  for (const item of items) {
    // Map incoming "status" to internal "type"
    const incomingStatus = (item.status || item.type || "info")
      .toString()
      .toLowerCase();
    const type =
      incomingStatus === "failure"
        ? "failure"
        : incomingStatus === "success"
        ? "success"
        : "info";

    // Store the whole item as data but remove 'status' to avoid duplication
    const data = { ...item };
    delete data.status;
    delete data.type; // if present

    const entry = addLog(type, data);
    created.push(entry);
  }

  res.status(200).json({
    status: "ok",
    message: `Stored ${created.length} log(s) (in-memory).`,
    logs: created,
  });
});

/**
 * GET /api/logs
 * Returns logs (newest first). Optional ?limit=20
 */
app.get("/api/logs", (req, res) => {
  const limit = parseInt(req.query.limit || "100", 10) || 100;
  res.status(200).json(logs.slice(0, limit));
});

/**
 * POST /api/logs/clear
 * Clears all logs (demo only).
 */
app.post("/api/logs/clear", (req, res) => {
  logs = [];
  res.status(200).json({ status: "ok", message: "Logs cleared (demo)." });
});

// === Start the Server ===
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
});
