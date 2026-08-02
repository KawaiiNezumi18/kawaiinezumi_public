import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { FoundryLocalManager } from 'foundry-local-sdk';

// Create the Express application and configure the local web server.
const app = express();
const port = process.env.PORT || 3000;

// Resolve the current module directory so we can serve static files reliably.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse incoming JSON payloads and serve the frontend assets from the public folder.
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Track the loaded chat client and the current model initialization state.
let chatClient = null;
let isModelReady = false;
let systemStatus = 'Initializing Foundry Local Manager...';

// Bootstrap the local Foundry runtime once the server starts up.
// This function downloads the execution provider, pulls the model, and prepares
// a reusable chat client so the API can answer prompts with low latency.
async function initFoundryLocal() {
    try {
        console.log('Initializing Foundry Local Manager...');

        // Create a manager scoped to this web app instance.
        const manager = FoundryLocalManager.create({
            appName: 'foundry_local_web_chat',
            logLevel: 'info'
        });

        // First, install the hardware acceleration pieces required by the runtime.
        systemStatus = 'Downloading execution providers...';
        let currentEp = '';
        await manager.downloadAndRegisterEps((epName, percent) => {
            if (epName !== currentEp) {
                currentEp = epName;
            }
            systemStatus = `Registering hardware acceleration: ${epName} (${percent.toFixed(0)}%)`;
        });

        // Then resolve the model from the local catalog and pull its weights.
        systemStatus = 'Selecting and downloading model...';
        // Use the Qwen model variant that matches the documented example workflow.
        const model = await manager.catalog.getModel('qwen2.5-1.5b');

        await model.download((progress) => {
            systemStatus = `Downloading model weights: ${progress.toFixed(1)}%`;
            process.stdout.write(`\r${systemStatus}`);
        });
        console.log('\nModel download complete.');

        // Load the model into memory so future requests can reuse it.
        systemStatus = 'Loading model into memory...';
        await model.load();

        // Create the client used by the REST API for chat completions.
        chatClient = model.createChatClient();
        isModelReady = true;
        systemStatus = 'Ready';
        console.log('Foundry Local Model loaded and ready for API requests.');
    } catch (error) {
        console.error('Failed to initialize Foundry Local:', error);
        systemStatus = 'Error initializing local AI model.';
    }
}

// Public status endpoint so the frontend can poll initialization progress.
app.get('/api/status', (req, res) => {
    res.json({ ready: isModelReady, status: systemStatus });
});

// Chat completion endpoint: accepts the entire conversation history and returns
// the model's next assistant response.
app.post('/api/chat', async (req, res) => {
    // Block requests until the model has finished downloading and loading.
    if (!isModelReady || !chatClient) {
        return res.status(503).json({ error: 'Model is still loading. Please wait.' });
    }

    const { messages } = req.body;

    // Expect an array of OpenAI-style message objects.
    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Invalid messages array provided.' });
    }

    try {
        // Pass the full conversation trace so the model can keep context.
        const response = await chatClient.completeChat(messages);

        // Normalize the SDK response into the shape expected by the frontend.
        const assistantMessage = response.choices[0]?.message || {
            role: 'assistant',
            content: "I'm sorry, I couldn't generate a response."
        };

        res.json({ message: assistantMessage });
    } catch (error) {
        console.error('Inference Error:', error);
        res.status(500).json({ error: 'An error occurred during local inference compilation.' });
    }
});

// Catch-all route so the SPA can refresh directly without a 404.
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the HTTP server and kick off the model initialization in the background.
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    initFoundryLocal();
});