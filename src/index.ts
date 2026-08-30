import { connectToWhatsApp } from './connection.js';
import { config } from './config.js';
import { messageStore } from './store.js';
import { outboundQueue } from './queue.js';
import { generateAIResponse } from './ai.js';

async function main() {
  console.log('==================================================');
  console.log('         WhatsApp Smart Bot - Initializing        ');
  console.log('==================================================');
  console.log(`Auth Directory:   ${config.authDir}`);
  console.log(`Log Level:        ${config.logLevel}`);
  console.log(`Trigger Tag:      ${config.triggerTag}`);
  console.log(`Groq Model:       ${config.groqModel}`);
  console.log(`Groq RPM Limit:   ${config.groqRpmLimit} req/min`);
  console.log(`Drip Rate:        1 outbound message per 4s`);
  if (config.targetGroupJid) {
    console.log(`Target Group JID: ${config.targetGroupJid}`);
  } else {
    console.log(`Target Group JID: (Monitoring all messages)`);
  }
  console.log('==================================================\n');

  await connectToWhatsApp({
    onOpen: async (sock) => {
      console.log(`\n[Bot] WhatsApp client logged in as: ${sock.user?.id || 'Connected Device'}`);
      console.log(`[Bot] Watching for messages in target group: ${config.targetGroupJid || 'ALL'}`);
      console.log(`[Bot] Trigger keyword: "${config.triggerTag}"\n`);

      // Listen for incoming and outgoing messages
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        for (const msg of messages) {
          const remoteJid = msg.key.remoteJid;
          if (!remoteJid) continue;

          // If a TARGET_GROUP_JID is set, filter out any messages from other chats
          if (config.targetGroupJid && remoteJid !== config.targetGroupJid) {
            continue;
          }

          const isFromMe = Boolean(msg.key.fromMe);
          const senderJid = msg.key.participant || remoteJid;
          const messageId = msg.key.id || `${Date.now()}`;

          // Extract text content from various WhatsApp message types
          const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            '';

          if (!text.trim()) continue;

          const triggerLower = config.triggerTag.toLowerCase();
          const textLower = text.toLowerCase();
          const containsTrigger = textLower.includes(triggerLower);

          // Determine whether this message is a user prompt vs an AI reply echo
          const isUserPrompt = containsTrigger || !isFromMe;
          const senderName = isUserPrompt
            ? (msg.pushName || (isFromMe ? 'You' : 'Group Member'))
            : 'tivr Bot';
          const role = isUserPrompt ? 'user' : 'assistant';

          const timestamp =
            typeof msg.messageTimestamp === 'number'
              ? msg.messageTimestamp * 1000
              : Date.now();

          // Add message to in-memory store
          messageStore.add({
            id: messageId,
            chatJid: remoteJid,
            senderJid,
            senderName,
            role,
            text: text.trim(),
            timestamp,
          });

          const currentCount = messageStore.count(remoteJid);

          console.log('\n---------------- MESSAGE RECEIVED ----------------');
          console.log(`Direction:    ${isFromMe ? '[OUTBOUND]' : '[INBOUND]'}`);
          console.log(`Chat JID:     ${remoteJid}`);
          console.log(`Sender:       ${senderName} (${senderJid})`);
          console.log(`Text:         "${text}"`);
          console.log(`Buffer Count: ${currentCount}/20 stored messages`);
          console.log('--------------------------------------------------');

          if (containsTrigger) {
            // Extract the query without the trigger tag
            const promptQuery = text.replace(new RegExp(config.triggerTag, 'ig'), '').trim();

            console.log(`\n[Bot] Trigger detected! Tag: "${config.triggerTag}" (${isFromMe ? 'from Self/Outbound' : 'from Member/Inbound'})`);
            console.log(`[Bot] Extracted Prompt: "${promptQuery}"`);
            console.log(`[Bot] Context History available: ${currentCount} messages`);

            // Fetch the past 20 messages from the in-memory buffer for context
            const chatHistory = messageStore.getRecent(remoteJid);

            // Generate AI response with Groq asynchronously
            (async () => {
              try {
                console.log(`[Bot] Calling Groq (${config.groqModel}) with ${chatHistory.length} messages of context...`);
                const replyText = await generateAIResponse({
                  promptQuery,
                  senderName,
                  chatHistory,
                });

                console.log(`[Bot] Generated AI Response (${replyText.length} chars). Enqueueing to drip queue...`);

                // Enqueue response to Drip Queue (1 msg / 4s)
                await outboundQueue.enqueue(async () => {
                  console.log(`[Bot] Dispatched outbound AI message to ${remoteJid}...`);
                  return sock.sendMessage(
                    remoteJid,
                    { text: replyText },
                    { quoted: msg }
                  );
                }).then((sentMsg) => {
                  if (sentMsg?.key.id) {
                    messageStore.add({
                      id: sentMsg.key.id,
                      chatJid: remoteJid,
                      senderJid: sock.user?.id || 'bot',
                      senderName: 'tivr Bot',
                      role: 'assistant',
                      text: replyText,
                      timestamp: Date.now(),
                    });
                  }
                  console.log('[Bot] AI Reply successfully sent to WhatsApp!');
                });
              } catch (aiOrSendError) {
                console.error('[Bot] Error in AI generation or sending:', aiOrSendError);
              }
            })();
          }
        }
      });
    },
    onClose: (err, shouldReconnect) => {
      if (!shouldReconnect) {
        console.log('[Bot] Session ended/invalidated. Generating fresh login QR...');
      } else {
        console.log('[Bot] Connection dropped temporarily. Reconnecting...');
      }
    },
  });
}

main().catch((err) => {
  console.error('[Bot] Fatal initialization error:', err);
  process.exit(1);
});
