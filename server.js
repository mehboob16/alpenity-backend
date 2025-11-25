const express = require("express");
const cors = require("cors");
// try to require mongodb but don't crash if it's not installed
let MongoClient, ObjectId;
try {
  ({ MongoClient, ObjectId } = require("mongodb"));
} catch (err) {
  console.warn(
    "Warning: 'mongodb' package is not installed. DB persistence will be disabled."
  );
  // Keep MongoClient undefined so initMongo can detect and skip DB initialization
}
require("dotenv").config(); // <-- NEW: load .env

const app = express();
const PORT = 3001; // We'll run the backend on this port

// === Middleware ===
// 1. Enable CORS for all requests (so React on port 5173 can talk to us)
app.use(cors());

// 2. Enable built-in JSON parsing
app.use(express.json({ limit: "5mb" })); // Allow larger JSON payloads

// === MongoDB setup ===
// Set MONGODB_URI in your environment (never hardcode credentials)
const MONGODB_URI = process.env.MONGODB_URI || "<YOUR_MONGODB_URI_HERE>";
const DB_NAME = process.env.DB_NAME || "simpleui";
let mongoClient;
let logsCollection;

// NEW: status object to report connection state
let dbStatus = { connected: false, message: "not initialized" };

// === "In-Memory Database" ===
// Keep latestArticle in-memory for article endpoint (unchanged)
let latestArticle = null;

// Helper to add log entries (now persists to MongoDB)
async function addLog(type, data = {}) {
  const doc = {
    type,
    data,
    createdAt: new Date(), // store as Date for sorting
  };
  if (logsCollection) {
    const res = await logsCollection.insertOne(doc);
    const id = res.insertedId.toHexString();
    return {
      id,
      type: doc.type,
      data: doc.data,
      timestamp: doc.createdAt.toISOString(),
    };
  } else {
    // fallback to in-memory minimal behavior if DB not configured
    const id =
      Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    return {
      id,
      type: doc.type,
      data: doc.data,
      timestamp: doc.createdAt.toISOString(),
    };
  }
}

async function initMongo() {
  if (!MongoClient) {
    console.warn(
      "MongoClient unavailable: skipping MongoDB initialization. Install 'mongodb' to enable persistence."
    );
    dbStatus = { connected: false, message: "mongodb package not installed" };
    return;
  }
  if (!MONGODB_URI || MONGODB_URI.includes("<YOUR_MONGODB_URI_HERE>")) {
    console.warn("MONGODB_URI not set. Backend will not persist logs to DB.");
    dbStatus = { connected: false, message: "MONGODB_URI not configured" };
    return;
  }
  // mongoClient = new MongoClient(MONGODB_URI, {
  //   useNewUrlParser: true,
  //   useUnifiedTopology: true,
  // });
  mongoClient = new MongoClient(MONGODB_URI);

  try {
    await mongoClient.connect();
    const db = mongoClient.db(DB_NAME);
    logsCollection = db.collection("Logs");
    // create index for faster queries/sorting
    await logsCollection.createIndex({ createdAt: -1 });
    // ping DB to confirm
    await db.command({ ping: 1 });
    dbStatus = {
      connected: true,
      message: "Connected to MongoDB",
      db: DB_NAME,
      time: new Date().toISOString(),
    };
    console.log("Connected to MongoDB, logs collection ready.");
  } catch (err) {
    dbStatus = {
      connected: false,
      message: err.message || "Connection failed",
    };
    console.error("Failed to initialize MongoDB:", err);
  }
}

// Initialize Mongo (non-blocking)
initMongo().catch((err) => {
  console.error("Failed to initialize MongoDB:", err);
});

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
app.post("/api/logs", async (req, res) => {
  const body = req.body;
  if (!body) {
    return res.status(400).json({ status: "error", message: "Empty body" });
  }
  const items = Array.isArray(body) ? body : [body];
  const created = [];

  for (const item of items) {
    const incomingStatus = (item.status || item.type || "info")
      .toString()
      .toLowerCase();
    let type = "info";
    if (incomingStatus === "failure") type = "failure";
    else if (incomingStatus === "success") type = "success";
    else if (
      incomingStatus === "waiting for approval" ||
      incomingStatus === "waiting"
    )
      type = "waiting";

    // If success with draft_workflow_execution_id, remove the waiting draft by execution_id AND platform
    if (type === "success" && item.draft_workflow_execution_id) {
      const draftExecutionId = item.draft_workflow_execution_id;
      const platform = item.platform || null;
      if (logsCollection) {
        const query = {
          type: "waiting",
          "data.execution_id": draftExecutionId,
        };
        if (platform) query["data.platform"] = platform;
        const deleted = await logsCollection.findOneAndDelete(query);
        if (deleted.value) {
          console.log(
            `Removed waiting log for draft execution ${draftExecutionId} platform ${platform}`
          );
        }
      }
    }

    // persist the incoming item (remove top-level status/type to avoid duplication)
    const data = { ...item };
    delete data.status;
    delete data.type;

    try {
      const entry = await addLog(type, data);
      created.push(entry);
    } catch (err) {
      console.error("Error adding log to DB:", err);
    }
  }

  res.status(200).json({
    status: "ok",
    message: `Stored ${created.length} log(s).`,
    logs: created,
  });
});

/**
 * GET /api/logs
 * Query params: page (1-based), limit
 * Returns { logs: [...], total, page, limit }
 * Sorted newest-first (createdAt desc)
 */
app.get("/api/logs", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.max(
    1,
    Math.min(100, parseInt(req.query.limit || "20", 10))
  );
  const skip = (page - 1) * limit;

  try {
    if (logsCollection) {
      const total = await logsCollection.countDocuments();
      const docs = await logsCollection
        .find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();

      // map to client shape
      const logs = docs.map((d) => ({
        id: d._id.toHexString(),
        type: d.type,
        data: d.data,
        timestamp: d.createdAt.toISOString(),
      }));

      res.status(200).json({ logs, total, page, limit });
    } else {
      // fallback: empty dataset if DB not configured
      res.status(200).json({ logs: [], total: 0, page, limit });
    }
  } catch (err) {
    console.error("Error fetching logs:", err);
    res.status(500).json({ status: "error", message: "Failed to fetch logs" });
  }
});

/**
 * POST /api/logs/clear
 * Clears all logs (demo only or admin)
 */
app.post("/api/logs/clear", async (req, res) => {
  try {
    if (logsCollection) {
      await logsCollection.deleteMany({});
    }
    res.status(200).json({ status: "ok", message: "Logs cleared." });
  } catch (err) {
    console.error("Error clearing logs:", err);
    res.status(500).json({ status: "error", message: "Failed to clear logs." });
  }
});

/**
 * GET /api/db-test
 * Returns current DB connection status. Performs a lightweight ping if connected.
 */
app.get("/api/db-test", async (req, res) => {
  try {
    if (logsCollection && logsCollection.db) {
      // perform a ping to validate connection
      await logsCollection.db.command({ ping: 1 });
      return res.status(200).json({
        connected: true,
        message: "MongoDB reachable",
        db: DB_NAME,
        time: new Date().toISOString(),
      });
    }
    // If logsCollection is not ready, return the current status object
    return res.status(200).json(dbStatus);
  } catch (err) {
    console.error("DB ping failed:", err);
    return res
      .status(500)
      .json({ connected: false, message: err.message || "ping failed" });
  }
});

// === Start the Server ===
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
});
