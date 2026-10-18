// This module manages the tool registry and the chat loop.
// Each tool (like weatherTool) is defined in its own file and registered here,
// so the app can scale without becoming one giant file.

import { weatherTool } from './weather-tool.js';

// Central registry:
// - `tools` holds the schemas (definitions) of all tools.
// - `toolFunctions` maps tool names to their actual handler functions.
export const tools = [];
export const toolFunctions = {};

// Function to register a new tool.
// Ensures the tool has a schema and handler, then adds it to the registry.
export function registerTool(tool) {
    if (!tool || !tool.schema || !tool.schema.function?.name || typeof tool.handler !== 'function') {
        throw new Error('Each registered tool must define a schema and handler.');
    }

    const existingToolName = tool.schema.function.name;
    if (!toolFunctions[existingToolName]) {
        // If tool is new, add its schema to the list
        tools.push(tool.schema);
    } else {
        // If tool already exists, update its schema
        const index = tools.findIndex((schema) => schema.function.name === existingToolName);
        if (index >= 0) {
            tools[index] = tool.schema;
        }
    }

    // Map the tool name to its handler function
    toolFunctions[existingToolName] = tool.handler;
}

// Register the weather tool so it’s available to the chat loop
registerTool(weatherTool);

// Some models don’t send structured tool calls.
// Instead, they return plain JSON text like {"name":"get_weather","arguments":{...}}.
// This helper parses that fallback format into the same structure as normal tool calls.
function extractTextToolCalls(content) {
    if (typeof content !== 'string') {
        return [];
    }

    const trimmedContent = content.trim();
    try {
        const parsed = JSON.parse(trimmedContent);
        if (typeof parsed.name !== 'string' || parsed.arguments === undefined) {
            return [];
        }

        // Convert into the expected tool call format
        return [{
            id: 'text-tool-call-1',
            type: 'function',
            function: {
                name: parsed.name,
                arguments: typeof parsed.arguments === 'string'
                    ? parsed.arguments
                    : JSON.stringify(parsed.arguments)
            }
        }];
    } catch {
        return [];
    }
}

// Helper to get tool calls from a model message.
// Prefers structured SDK tool calls, but falls back to parsing text if needed.
function getToolCalls(message) {
    // Prefer the SDK's structured tool calls because they are the cleanest format.
    // If the model returns a plain JSON payload instead, we fall back to parsing it manually.
    if (message?.tool_calls?.length > 0) {
        return message.tool_calls;
    }

    return extractTextToolCalls(message?.content);
}

// Main tool execution loop:
// 1. Look at the model’s response for tool calls.
// 2. Run each tool in order.
// 3. Send results back to the model.
// 4. Repeat until the model gives a final answer or a safety limit is reached.
export async function processToolCalls(messages, response, chatClient) {
    console.log('Calling processToolCalls');
   
    let choice = response.choices[0]?.message;
    console.log('Model response:', choice);

    let rounds = 0;
    const maxToolRounds = 5;    // Prevent infinite loops
    let toolCalls = getToolCalls(choice);

    console.log('Tool calls:', toolCalls);

    // Loop until no more tool calls or safety limit reached
    while (toolCalls.length > 0 && rounds < maxToolRounds) {
        rounds += 1;
        
        if (!choice.tool_calls?.length) {
            // Ensure assistant messages keep non-empty content
            choice = {
                ...choice,
                content: choice.content?.trim() || 'Requesting tool results.',
                tool_calls: toolCalls
            };
            console.log('Parsed textual tool calls:', toolCalls);
        }
        
        messages.push(choice);

        // Execute each tool call
        for (const toolCall of toolCalls) {
            const functionName = toolCall.function?.name;
            let result;

            try {
                const toolFunction = toolFunctions[functionName];

                if (!toolFunction) {
                    throw new Error(`Unknown tool: ${functionName}`);
                }

                // Parse arguments (may be stringified JSON)
                const rawArguments = toolCall.function?.arguments;
                const argumentsObject = typeof rawArguments === 'string'
                    ? JSON.parse(rawArguments || '{}')
                    : rawArguments || {};

                console.log(
                    `Tool call: ${functionName}(${JSON.stringify(argumentsObject)})`
                );

                // Run the tool handler
                result = await toolFunction(argumentsObject);
            } catch (error) {
                // If tool fails, return error object instead of crashing
                result = { error: error.message || 'Tool execution failed.' };
            }

            // Push tool result back into the conversation
            messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result)
            });
        }

        // Ask the model again with updated messages and tool results
        response = await chatClient.completeChat(messages, tools);
        choice = response.choices[0]?.message;
        toolCalls = getToolCalls(choice);
    }

    // If safety limit reached, return fallback message.
    //
    // A non-empty list here means the safety limit was reached before a final
    // assistant message could be produced.
    if (toolCalls.length > 0) {
        return {
            role: 'assistant',
            content: 'I was unable to finish processing the requested tool calls.'
        };
    }

    // Otherwise return the final assistant message
    return choice || {
        role: 'assistant',
        content: "I'm sorry, I couldn't generate a response."
    };
}