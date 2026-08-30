import readline from 'readline';
import { generateAIResponse } from './ai.js';
import { config } from './config.js';

async function runCli() {
  console.log('==================================================');
  console.log('       WhatsApp Smart Bot - Terminal Test CLI     ');
  console.log('==================================================');
  console.log(`Model:        ${config.groqModel}`);
  console.log(`Tavily:       ${config.tavilyApiKey ? 'Enabled (Web Search Active)' : 'Disabled'}`);
  console.log('Type your question or message and press Enter.');
  console.log('Type "/exit" or press Ctrl+C to quit.');
  console.log('==================================================\n');

  // Check if query was passed as command line argument (one-shot mode)
  const argsQuery = process.argv.slice(2).join(' ').trim();
  if (argsQuery) {
    console.log(`Query: "${argsQuery}"\n`);
    const reply = await generateAIResponse({
      promptQuery: argsQuery,
      senderName: 'TerminalUser',
      chatHistory: [],
    });
    console.log('\nProtone > ' + reply + '\n');
    process.exit(0);
  }

  // Interactive REPL mode
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'You > ',
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input === '/exit' || input === 'exit' || input === 'quit') {
      console.log('Goodbye!');
      process.exit(0);
    }

    if (input === '/help') {
      console.log('\nCommands:');
      console.log('  /help    - Show this help message');
      console.log('  /exit    - Exit the test CLI\n');
      rl.prompt();
      return;
    }

    try {
      const response = await generateAIResponse({
        promptQuery: input,
        senderName: 'TerminalUser',
        chatHistory: [],
      });

      console.log('\nProtone > ' + response + '\n');
    } catch (err: any) {
      console.error('\n[Error]:', err?.message || err, '\n');
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\nSession ended. Goodbye!');
    process.exit(0);
  });
}

runCli().catch((err) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
