import { connectToWhatsApp } from './connection.js';
import { config } from './config.js';
import { messageStore } from './store.js';
import { outboundQueue } from './queue.js';
import { generateAIResponse } from './ai.js';
import { setTimeout as delay } from 'node:timers/promises';

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
            console.log(`[Bot] Presence: Marking Presence as "Unavailable"`);
            console.log(`[Bot] Trigger keyword: "${config.triggerTag}"\n`);


            // Listen for incoming and outgoing messages
            sock.ev.on('messages.upsert', async ({ messages, type }) => {
                // Set presence to unavailable
                await sock.sendPresenceUpdate('unavailable');
                for (const msg of messages) {
                    const remoteJid = msg.key.remoteJid;
                    if (!remoteJid) continue;

                    // If a TARGET_GROUP_JID is set, filter out any messages from other chats
                    if (config.targetGroupJid && remoteJid !== config.targetGroupJid) {
                        continue;
                    }

                    const isFromMe = Boolean(msg.key.fromMe);
                    const senderJid = msg.key.participant || remoteJid;
                    const senderName = msg.pushName || (isFromMe ? 'Protone Bot' : 'Group Member');
                    const messageId = msg.key.id || `${Date.now()}`;

                    // Extract text content from various WhatsApp message types
                    const text =
                        msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        msg.message?.videoMessage?.caption ||
                        '';

                    if (!text.trim()) continue;

                    const timestamp =
                        typeof msg.messageTimestamp === 'number'
                            ? msg.messageTimestamp * 1000
                            : Date.now();

                    // attachments
                    const attachments = msg.message?.imageMessage?.url || ''

                    // Add message to in-memory store
                    messageStore.add({
                        id: messageId,
                        chatJid: remoteJid,
                        senderJid,
                        senderName,
                        role: isFromMe ? 'assistant' : 'user',
                        text: text.trim(),
                        timestamp,
                    });

                    const currentCount = messageStore.count(remoteJid);

                    console.log('\n---------------- MESSAGE RECEIVED ----------------');
                    console.log(`Direction:    ${isFromMe ? '[OUTBOUND]' : '[INBOUND]'}`);
                    console.log(`Chat JID:     ${remoteJid}`);
                    console.log(`Sender:       ${senderName} (${senderJid})`);
                    console.log(`Text:         "${text}"`);
                    console.log(`Attachments:    "${attachments}"`);
                    console.log(`Buffer Count: ${currentCount}/20 stored messages`);
                    console.log('--------------------------------------------------');

                    // Trigger check for messages containing the trigger tag
                    const triggerLower = config.triggerTag.toLowerCase();
                    const textLower = text.toLowerCase();

                    if (textLower.startsWith(triggerLower)) {
                        // Extract the query without the trigger tag
                        let promptQuery = text.replace(new RegExp(config.triggerTag, 'ig'), '').trim();

                        // If the user replied to a message with just the tag (empty prompt),
                        // use the quoted/replied-to message text as the prompt instead.
                        // contextInfo lives on the sub-message type (e.g. extendedTextMessage,
                        // imageMessage, videoMessage, etc.) — NOT on `conversation` (plain string).
                        if (!promptQuery) {
                            const msgContent = msg.message;
                            const contextInfo =
                                msgContent?.extendedTextMessage?.contextInfo ??
                                msgContent?.imageMessage?.contextInfo ??
                                msgContent?.videoMessage?.contextInfo ??
                                msgContent?.audioMessage?.contextInfo ??
                                msgContent?.stickerMessage?.contextInfo ??
                                null;

                            const quotedMsg = contextInfo?.quotedMessage;
                            const quotedText =
                                quotedMsg?.conversation ||
                                quotedMsg?.extendedTextMessage?.text ||
                                quotedMsg?.imageMessage?.caption ||
                                quotedMsg?.videoMessage?.caption ||
                                '';
                            if (quotedText.trim()) {
                                const quotedParticipant = contextInfo?.participant || 'Someone';
                                promptQuery = `(Replying to message from ${quotedParticipant}): ${quotedText.trim()}`;
                                console.log(`[Bot] Empty prompt — using quoted message text as prompt: "${promptQuery}"`);
                            }
                        }

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
                                    await sock.sendPresenceUpdate('composing', remoteJid);
                                    await delay(2000);
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
                                            senderName: 'Protone Bot',
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
