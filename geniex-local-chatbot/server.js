import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

// This file runs a small Node.js backend that exposes a chat API.
// It talks to a local GenieX server that behaves like an OpenAI-compatible API.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create the Express app and choose the port used by the local web UI.
const app = express();
const PORT = 3000;

// GenieX is expected to run locally and expose an OpenAI-style API at this URL.
const GENIEX_BASE_URL = 'http://127.0.0.1:18181/v1';
const MODEL_NAME = 'google/gemma-4-E2B-it-qat-q4_0-gguf';

// Initialize the OpenAI SDK so we can send chat requests to the local GenieX server.
// The SDK requires an API key, even though the local server does not enforce one.
const openai = new OpenAI({
  baseURL: GENIEX_BASE_URL,
  apiKey: 'dummy-key',
});

// Parse JSON bodies from browser requests and serve static files from the public folder.
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Checks whether GenieX is online and whether the model we need is already loaded.
app.get('/api/status', async (req, res) => {
  try {
    // Ask the GenieX server for the list of installed models.
    const response = await fetch(`${GENIEX_BASE_URL}/models`);
    const data = await response.json();

    // A model is considered ready if its ID matches the target model exactly
    // or if it has a version suffix such as "model-name:latest".
    const isModelLoaded = data.data && data.data.some(
      m => m.id === MODEL_NAME || m.id.startsWith(`${MODEL_NAME}:`)
    );

    if (isModelLoaded) {
      res.json({ status: 'online', model: MODEL_NAME });
    } else {
      res.json({
        status: 'model_missing',
        message: `Server active, but model '${MODEL_NAME}' is not loaded.`
      });
    }
  } catch (error) {
    // If the local server is down or not started yet, report it clearly to the UI.
    res.json({ status: 'offline', message: 'Cannot connect to GenieX server.' });
  }
});

// Handles chat requests from the browser. The client sends the conversation history,
// and this server forwards it to GenieX and returns the model's reply.
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;

    // The client must send an array of chat messages, like [{ role, content }, ...].
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required.' });
    }

    // Send a non-streaming chat completion request to the local GenieX server.
    const completion = await openai.chat.completions.create({
      model: MODEL_NAME,
      messages: messages,
      stream: false,
    });

    // Extract the assistant reply from the model response.
    const reply = completion.choices[0]?.message?.content || 'No response generated.';
    res.json({ reply });
  } catch (error) {
    console.error('Chat completion error:', error);
    res.status(500).json({ error: 'Failed to communicate with GenieX server.' });
  }
});

// Start listening for incoming requests from the browser.
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});