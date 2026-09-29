// These DOM hooks grab the HTML elements that the app will update during runtime.
const chatBody = document.getElementById('chat-body');
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const statusBadge = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const offlineBanner = document.getElementById('offline-banner');

// This array stores the full chat conversation in OpenAI-style format:
// [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }]
const conversationHistory = [];

// Run the startup check as soon as the page finishes loading.
document.addEventListener('DOMContentLoaded', checkServerStatus);

// Ask the backend whether GenieX is reachable and whether the selected model is loaded.
async function checkServerStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    if (data.status === 'online') {
      // The AI backend is ready, so enable the chat input and show the healthy state.
      statusBadge.className = 'status-badge online';
      statusText.textContent = 'Online';
      offlineBanner.classList.add('hidden');
      toggleInput(true);
    } else {
      // The backend is reachable but the model is missing or not loaded.
      showOfflineState(data.message);
    }
  } catch (error) {
    // The app server or GenieX server may not be running yet.
    showOfflineState('Could not reach backend application.');
  }
}

// Show the offline state and disable chat input until the model is ready.
function showOfflineState(msg) {
  statusBadge.className = 'status-badge offline';
  statusText.textContent = 'Offline';
  offlineBanner.classList.remove('hidden');
  toggleInput(false);
}

// Enables or disables the message box and send button.
function toggleInput(enabled) {
  userInput.disabled = !enabled;
  sendBtn.disabled = !enabled;
}

// When the user submits the form, send the message to the backend and display the reply.
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text) return;

  // Add the user's message to the UI and to the chat history that gets sent to the model.
  appendMessage(text, 'user-message');
  conversationHistory.push({ role: 'user', content: text });
  userInput.value = '';

  // Show a temporary loading message while the model is generating a response.
  const loadingDiv = appendMessage('Thinking...', 'bot-message system-message');
  toggleInput(false);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversationHistory })
    });

    const data = await response.json();
    loadingDiv.remove();

    if (response.ok && data.reply) {
      // Convert markdown text from the model into HTML and sanitize it before display.
      // This allows formatted responses while blocking unsafe HTML injection.
      const rawMarkdown = marked.parse(data.reply);
      const cleanHTML = DOMPurify.sanitize(rawMarkdown);

      appendMessage(cleanHTML, 'bot-message', true);
      conversationHistory.push({ role: 'assistant', content: data.reply });
    } else {
      appendMessage('Error: ' + (data.error || 'Failed to get response.'), 'bot-message');
    }
  } catch (err) {
    loadingDiv.remove();
    appendMessage('Network Error: Failed to reach server.', 'bot-message');
  } finally {
    // Re-enable input after the request finishes, and keep the cursor ready for the next prompt.
    toggleInput(true);
    userInput.focus();
  }
});

// Creates a message bubble in the chat window.
// If isHTML is true, the content is treated as formatted HTML; otherwise it is displayed as plain text.
function appendMessage(content, className, isHTML = false) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${className}`;

  if (isHTML) {
    msgDiv.innerHTML = content;
  } else {
    // Protect against unsafe text by sanitizing before setting as text content.
    msgDiv.textContent = DOMPurify.sanitize(content);
  }

  chatBody.appendChild(msgDiv);
  chatBody.scrollTop = chatBody.scrollHeight;
  return msgDiv;
}