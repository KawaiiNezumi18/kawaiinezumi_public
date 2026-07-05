// Import the OpenAI SDK to interact with models
import OpenAI from 'openai';
// Import Node.js readline module to handle terminal input/output
import readline from 'readline';

// 1. Define Foundry Local server details
// Foundry Local uses dynamic port (change this according to your own server port)
const FOUNDRY_PORT = 53427; 
// Define the model you want to use
const MODEL_NAME = 'qwen2.5-1.5b-instruct-generic-cpu:4';

// 2. Initialize the OpenAI client pointing to Foundry Local
const openai = new OpenAI({
  baseURL: 'http://127.0.0.1:' + FOUNDRY_PORT + '/v1',  // Local server endpoin
  apiKey: 'local-no-key-required' // Required by SDK but ignored by Foundry Local
});

// 3. Create a command-line interface for chatting
const rl = readline.createInterface({
  input: process.stdin, // Read user input from the terminal
  output: process.stdout // Print AI responses to terminal
});

// Track conversation memory with system prompt.
// Define the assistant's personality and behavior.
const messages = [
  { role: 'system', 
    content: 'You are a helpful, friendly assistant. Keep your responses ' +
                'concise and conversational. If you don\'t know something, say so.'
  }
];

// Main chat loop function that repeatedly asks the user for input
async function handleChat() {
  // Prompt user for input
  rl.question('\nYou: ', async (userInput) => {
    // Exit condition
    if (userInput.toLowerCase() === 'exit') {
      console.log('Goodbye!');
      rl.close();
      return;
    }

    // Skip empty input
    // If the user presses Enter without typing anything, 
    // it just restarts the loop.
    if (!userInput.trim()) {
      handleChat();
      return;
    }

    // Save user input to conversation history
    messages.push({ role: 'user', content: userInput });

    try {
      // Show placeholder while AI is generating
      process.stdout.write('AI is thinking...');
      
      // Calls the OpenAI API (via Foundry Local) to generate
      // AI response using the chosen model.
      const response = await openai.chat.completions.create({
        model: MODEL_NAME,
        messages: messages,
        temperature: 0.7  // makes responses more creative and varied
      });

      // Clear the "thinking..." placeholder line
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);

      // Extract AI reply from response object
      const aiReply = response.choices[0].message.content;
      console.log(`AI: ${aiReply}`);

      // Save AI reply to conversation history (this is in order
      // to maintain context for multi-turn conversations)
      messages.push({ role: 'assistant', content: aiReply });

    } catch (error) {
      // Handle connection errors
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.error('\nError connecting to Foundry Local:', error.message);
      console.log('Please ensure your Foundry Local CLI is active and the model is loaded.');
    }

    // Continue chat loop to keep the conversation going
    handleChat();
  });
}

// Startup messages
console.log('=== Foundry Local Chatbot Started ===');
console.log(`Targeting Model: ${MODEL_NAME}`);
console.log(`Targeting Port: ${FOUNDRY_PORT}`);
console.log('Type \'exit\' to quit.\n');

// Start chat loop
handleChat();