import fs from 'fs';
import path from 'path';
import { FoundryLocalManager } from 'foundry-local-sdk';
import { extractTextFromFile, splitTextIntoChunks } from './documentProcessor.js';
import { VectorStore } from './vectorStore.js';

/**
 * RAG engine that loads local models, indexes text files, and answers questions by
 * retrieving the most relevant chunks from a vector store.
 *
 * This class combines three core steps:
 * 1. Parse and split documents into chunks
 * 2. Generate embeddings and store them in SQLite
 * 3. Embed the user query, find matching chunks, and ask the chat model to answer
 *    using only those retrieved passages as context
 */
export class RagEngine {
    constructor() {
        // Local vector database used to keep embeddings for retrieved text chunks.
        this.vectorStore = new VectorStore();

        // Foundry Local runtime objects.
        this.manager = null;
        this.embeddingModel = null;
        this.chatModel = null;
        this.embeddingClient = null;
        this.chatClient = null;

        // Runtime state for the engine.
        this.isReady = false;
        this.status = 'Initializing engine...';
    }

    /**
     * Loads the embedding model and chat model, then ingests all documents from the
     * data_sources directory.
     *
     * The engine is considered ready only after the models load and the documents are
     * indexed successfully.
     */
    async initialize() {
        try {
            this.status = 'Creating Foundry Local Manager...';
            this.manager = FoundryLocalManager.create({
                appName: 'foundry_local_rag_app',
                logLevel: 'info'
            });

            // 1. Load the embedding model used to turn text into numeric vectors.
            this.status = 'Loading embedding model (qwen3-embedding-0.6b)...';
            this.embeddingModel = await this.manager.catalog.getModel('qwen3-embedding-0.6b');
            await this.embeddingModel.download();
            await this.embeddingModel.load();
            this.embeddingClient = this.embeddingModel.createEmbeddingClient();

            // 2. Load the chat model used to answer user questions.
            this.status = 'Loading chat model (qwen2.5-1.5b)...';
            this.chatModel = await this.manager.catalog.getModel('qwen2.5-1.5b');
            await this.chatModel.download();
            await this.chatModel.load();
            this.chatClient = await this.chatModel.createChatClient();

            // 3. Read all source documents and create embeddings for each text chunk.
            await this.ingestDocuments('./data_sources');

            this.isReady = true;
            this.status = 'Ready';
            console.log('✓ RAG Engine initialized and documents indexed.');
        } catch (error) {
            console.error('Failed to initialize RAG Engine:', error);
            this.status = `Error: ${error.message}`;
        }
    }

    /**
     * Unloads the chat and embedding models from Foundry Local.
     */
    async unload() {
        this.isReady = false;
        this.status = 'Unloading models...';

        const models = [this.chatModel, this.embeddingModel].filter(Boolean);

        await Promise.all(
            models.map((model) => model.unload())
        );

        this.chatClient = null;
        this.embeddingClient = null;
        this.status = 'Models unloaded';
    }

    /**
     * Processes all files in a folder and stores their chunk embeddings in SQLite.
     *
     * For each document:
     * - read the raw text from the file
     * - split it into overlapping chunks
     * - generate an embedding for each chunk
     * - save the text and embedding in the vector store
     */
    async ingestDocuments(dataFolderPath) {
        // If the documents folder does not exist yet, create it and stop early.
        if (!fs.existsSync(dataFolderPath)) {
            fs.mkdirSync(dataFolderPath, { recursive: true });
            return;
        }

        const files = fs.readdirSync(dataFolderPath);

        // Reset the vector store so indexing is fresh each time the engine starts.
        this.vectorStore.clearDatabase();

        for (const file of files) {
            const filePath = path.join(dataFolderPath, file);

            // Ignore folders and only process actual files.
            if (fs.statSync(filePath).isDirectory()) continue;

            console.log(`Processing document: ${file}...`);

            // Extract raw text from the original document format.
            const rawText = await extractTextFromFile(filePath);

            // Split long text into smaller sections with overlap so context stays connected.
            const chunks = splitTextIntoChunks(rawText, 1000, 200);

            if (chunks.length === 0) continue;

            // Generate embeddings for every chunk using the embedding model.
            const response = await this.embeddingClient.generateEmbeddings(chunks);
            const embeddings = response.data.map((item) => item.embedding);

            // Save chunk text plus its vector representation to SQLite.
            this.vectorStore.saveChunks(file, chunks, embeddings);
            console.log(`✓ Indexed ${chunks.length} chunks for ${file}`);
        }
    }

    /**
     * Answers a user question using retrieval-augmented generation.
     *
     * Flow:
     * 1. Embed the query using the same embedding model as the documents.
     * 2. Search the vector store for the most similar chunks.
     * 3. Build a prompt that includes only the retrieved chunks as context.
     * 4. Ask the chat model to answer using that context.
     */
    async chat(userQuery) {
        if (!this.isReady) {
            throw new Error('RAG Engine is not ready yet.');
        }

        // 1. Convert the user question into an embedding.
        const queryEmbeddingResp = await this.embeddingClient.generateEmbeddings([userQuery]);
        const queryVector = queryEmbeddingResp.data[0].embedding;

        // 2. Search the database for the top 3 most relevant text chunks.
        const relevantDocs = this.vectorStore.similaritySearch(queryVector, 3);

        // Turn the results into a single context block showing which file each chunk came from.
        const contextText = relevantDocs.map((doc, idx) => `[Source ${idx + 1} - ${doc.fileName}]:\n${doc.content}`).join('\n\n');

        // 3. Create the final prompt for the chat model.
        const promptMessages = [
            {
                role: 'system',
                content: `You are a helpful HR Assistant. Answer user questions strictly ` + 
                `based on the following context retrieved from company policy documents. ` + 
                `If the context does not contain enough information, state clearly that you ` + 
                `do not know the answer because it is not part of your knowledge base. ` + 
                `\n\n### Context:\n${contextText}`
            },
            {
                role: 'user',
                content: userQuery
            }
        ];

        // 4. Ask the chat model to produce the final answer.
        const completion = await this.chatClient.completeChat(promptMessages);
        return completion.choices[0]?.message?.content || 'No response generated.';
    }
}