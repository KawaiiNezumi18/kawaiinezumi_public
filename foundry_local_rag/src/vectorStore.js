import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

/**
 * Stores text chunks and their vector embeddings in a local SQLite database.
 *
 * In a RAG system, we do not usually store the entire document as one giant block.
 * Instead, we split the text into chunks, generate an embedding for each chunk, and
 * save both the chunk text and its embedding. Later, when a user asks a question,
 * we compute an embedding for the question and find the chunks whose vectors are most
 * similar to it.
 */
export class VectorStore {
    constructor(dbPath = './db/vectors.db') {
        // Make sure the folder for the SQLite database exists before creating it.
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Open the SQLite database and create the required table.
        this.db = new Database(dbPath);
        this.initSchema();
    }

    /**
     * Creates the schema used to store document chunks and their embeddings.
     *
     * Each row stores:
     * - file_name: which source file this chunk came from
     * - chunk_index: its position in the original file
     * - content: the actual cleaned text for that chunk
     * - embedding: the vector representation for that same chunk
     *
     * We store the embedding as JSON text because SQLite can store strings easily,
     * and it makes retrieval code simpler to work with.
     */
    initSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS document_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_name TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                embedding TEXT NOT NULL
            );
        `);
    }

    /**
     * Removes all stored chunks from the database.
     *
     * Useful when re-indexing documents or resetting the local knowledge base.
     */
    clearDatabase() {
        this.db.exec('DELETE FROM document_chunks;');
    }

    /**
     * Saves text chunks and their embeddings into the database.
     *
     * @param {string} fileName - The name of the source file.
     * @param {string[]} chunks - The chunked text segments.
     * @param {number[][]} embeddings - Embedding vectors, in the same order as chunks.
     */
    saveChunks(fileName, chunks, embeddings) {
        // Prepare a single insert statement for efficiency.
        const insertStmt = this.db.prepare(`
            INSERT INTO document_chunks (file_name, chunk_index, content, embedding)
            VALUES (?, ?, ?, ?)
        `);

        // Wrap the loop in a database transaction so all rows are written together.
        const insertMany = this.db.transaction((items) => {
            for (const item of items) {
                insertStmt.run(
                    fileName,
                    item.index,
                    item.content,
                    JSON.stringify(item.embedding)
                );
            }
        });

        // Build a list of records that match each chunk with its embedding.
        const items = chunks.map((chunk, idx) => ({
            index: idx,
            content: chunk,
            embedding: embeddings[idx]
        }));

        insertMany(items);
    }

    /**
     * Compute cosine similarity between two vectors.
     *
     * Cosine similarity measures how aligned two vectors are, regardless of their
     * magnitude. It is often used in embedding search because it tells us whether the
     * direction of the vectors is similar, which is a good signal for semantic match.
     *
     * Formula:
     * cosine_similarity = dotProduct / (|A| * |B|)
     *
     * A score close to 1 means the vectors are very similar.
     * A score close to 0 means they are unrelated.
     */
    cosineSimilarity(vecA, vecB) {
        // dotProduct tells us how aligned the vectors are.
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }

        // Guard against zero vectors, which would otherwise produce division by zero.
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Finds the most relevant chunks for a query vector.
     *
     * This is the retrieval step in a RAG flow:
     * 1. We embed the user question.
     * 2. We compare it to every stored document chunk embedding.
     * 3. We rank the chunks by similarity.
     * 4. We return the best matches.
     *
     * This method loads all embeddings from SQLite, computes a similarity score for
     * each one, sorts them from highest to lowest, and returns the top K results.
     */
    similaritySearch(queryVector, topK = 3) {
        // Read every stored chunk and its embedding from the database.
        const rows = this.db.prepare('SELECT file_name, content, embedding FROM document_chunks').all();

        // Score each chunk against the query vector.
        const scored = rows.map((row) => {
            const vector = JSON.parse(row.embedding);
            const score = this.cosineSimilarity(queryVector, vector);
            return {
                fileName: row.file_name,
                content: row.content,
                score
            };
        });

        // Sort from highest similarity to lowest, then keep only the best K results.
        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }
}