import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { RagEngine } from './ragEngine.js';

// Create the Express web server.
const app = express();
const port = process.env.PORT || 3000;

// In ES modules, __dirname is not defined by default, so we reconstruct it from the
// current file URL. This is useful for serving static files from the public folder.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse incoming JSON requests so the frontend can send a { query: '...' } payload.
app.use(express.json());

// Serve the frontend files from the public folder.
// This allows the browser app to load HTML, CSS, and JavaScript without any extra setup.
app.use(express.static(path.join(__dirname, '../public')));

// Create the RAG pipeline instance that will load models and answer questions.
const ragEngine = new RagEngine();

/**
 * GET /api/status
 *
 * Returns the current readiness of the RAG engine so the frontend can know whether the
 * models have finished loading and the documents have been indexed.
 */
app.get('/api/status', (req, res) => {
    res.json({
        ready: ragEngine.isReady,
        status: ragEngine.status
    });
});

/**
 * POST /api/unload
 *
 * Unloads both local models, for example when the application is shutting down.
 */
app.post('/api/unload', async (req, res) => {
    try {
        await ragEngine.unload();
        res.json({ status: ragEngine.status });
    } catch (error) {
        console.error('Model unload endpoint error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/chat
 *
 * Accepts a JSON body like:
 * { "query": "What does the policy say about leave?" }
 *
 * The request is validated; if a query is missing, the server returns a 400 error.
 * Otherwise it sends the query through the RAG engine and returns the generated answer.
 */
app.post('/api/chat', async (req, res) => {
    try {
        const { query } = req.body;

        // Reject empty or missing user queries.
        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required.' });
        }

        // Ask the retrieval + generation engine to answer the question.
        const answer = await ragEngine.chat(query);

        // Send the final answer back to the client.
        res.json({ answer });
    } catch (error) {
        console.error('Chat endpoint error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start the web server and initialize the RAG engine once the server is listening.
let initializationPromise = Promise.resolve();
const server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    initializationPromise = ragEngine.initialize();
});

let isShuttingDown = false;

async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`${signal} received. Shutting down server...`);

    server.close(async (error) => {
        let shutdownFailed = false;

        if (error) {
            console.error('Error closing server:', error);
            shutdownFailed = true;
        }

        try {
            await initializationPromise;
            await ragEngine.unload();
            console.log('Models unloaded.');
        } catch (unloadError) {
            console.error('Error unloading models during shutdown:', unloadError);
            shutdownFailed = true;
        }

        process.exitCode = shutdownFailed
            ? 1
            : signal === 'SIGINT' ? 130 : 143;
    });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));