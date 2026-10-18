import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

/**
 * Reads a document file and converts it to plain text.
 *
 * This function handles the file formats we support in the app:
 * - PDF: use a PDF parser
 * - DOC/DOCX: extract raw text from Word files
 * - TXT/MD: read the file as UTF-8 text
 *
 * We do this as a first step because downstream features (such as searching,
 * semantic retrieval, or embedding generation) work best with clean plain text.
 */
export async function extractTextFromFile(filePath) {
    // Get the file extension so we know which parser to use.
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.pdf') {
        // Read the PDF as a binary buffer and let pdf-parse extract the text.
        const dataBuffer = fs.readFileSync(filePath);
        const parser = new PDFParse({ data: dataBuffer });
        try {
            const data = await parser.getText();
            return data.text;
        } finally {
            await parser.destroy();
        }
    } else if (ext === '.docx' || ext === '.doc') {
        // Mammoth extracts the actual document content while ignoring most formatting.
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value;
    } else if (ext === '.md' || ext === '.txt') {
        // Plain text files are easy to process and can be read directly.
        return fs.readFileSync(filePath, 'utf-8');
    } else {
        // Fail clearly when a file type is unsupported.
        throw new Error(`Unsupported file type: ${ext}`);
    }
}

/**
 * Break a long text document into smaller chunks.
 *
 * Large documents are usually too big to send to an LLM or vector database as one
 * single block. Chunking allows us to:
 * - keep each piece small enough to process efficiently
 * - preserve local context around each section
 * - reduce the chance of losing context at boundaries between sections
 *
 * The overlap is important because text often spans sentence or paragraph boundaries.
 * If we split at fixed positions without overlap, the model may miss facts that are
 * split across chunks. Overlap makes sure each block still has some context from the
 * preceding or following text, which helps retrieval and understanding.
 *
 * Example:
 * chunkSize = 1000, chunkOverlap = 200
 * chunk 1: 0..999
 * chunk 2: 800..1799
 * chunk 3: 1600..2599
 *
 * This means neighboring chunks share some text, keeping meaning continuous even when
 * a sentence is cut across the boundary.
 */
export function splitTextIntoChunks(text, chunkSize = 1000, chunkOverlap = 200) {
    // A list to hold each text block after splitting.
    const chunks = [];

    // Start at the beginning of the document.
    let currentIndex = 0;

    while (currentIndex < text.length) {
        // Calculate the end of this chunk.
        let endIndex = currentIndex + chunkSize;

        // Prevent going past the end of the file.
        if (endIndex > text.length) endIndex = text.length;

        // Take a substring from the current position to the end of this block.
        let chunk = text.substring(currentIndex, endIndex);

        // Skip empty or whitespace-only chunks to avoid adding junk blocks.
        if (chunk.trim().length > 0) {
            chunks.push(chunk.trim());
        }

        // Move ahead by the chunk size minus the overlap so that each new block
        // includes context from the previous one.
        currentIndex += (chunkSize - chunkOverlap);
    }

    return chunks;
}