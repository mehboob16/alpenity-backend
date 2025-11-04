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

// === Start the Server ===
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
});
