import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  type WASocket,
  type ConnectionState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import fs from 'node:fs';
import { config } from './config.js';

export interface ConnectionCallbacks {
  onOpen?: (sock: WASocket) => Promise<void> | void;
  onClose?: (error: Error | undefined, shouldReconnect: boolean) => Promise<void> | void;
  onConnecting?: () => Promise<void> | void;
  onQR?: (qr: string) => Promise<void> | void;
}

/**
 * Utility to safely delete the stored authentication directory
 * so that subsequent attempts generate a fresh QR code.
 */
export function clearAuthState(): void {
  try {
    if (fs.existsSync(config.authDir)) {
      fs.rmSync(config.authDir, { recursive: true, force: true });
      console.log(`[WhatsApp] Cleared auth credentials directory: ${config.authDir}`);
    }
  } catch (err) {
    console.error(`[WhatsApp] Failed to clear auth directory ${config.authDir}:`, err);
  }
}

/**
 * Initializes and establishes a WhatsApp socket connection via Baileys.
 * Handles authentication state persistence, terminal QR generation,
 * session renewal, automatic stale session cleanup, and reconnection.
 */
export async function connectToWhatsApp(
  callbacks?: ConnectionCallbacks
): Promise<WASocket> {
  const logger = pino({
    level: config.logLevel,
  });

  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger: logger.child({ module: 'baileys' }),
    browser: Browsers.macOS('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
  });

  // Save updated session credentials whenever they change
  sock.ev.on('creds.update', saveCreds);

  // Monitor connection updates
  sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n==================================================');
      console.log(' Scan this QR code with WhatsApp on your phone:');
      console.log(' (WhatsApp -> Linked Devices -> Link a Device)');
      console.log('==================================================\n');
      qrcode.generate(qr, { small: true });
      callbacks?.onQR?.(qr);
    }

    if (connection === 'connecting') {
      console.log('[WhatsApp] Connecting to WhatsApp servers...');
      callbacks?.onConnecting?.();
    } else if (connection === 'open') {
      console.log('[WhatsApp] Connection established successfully! Socket is ready.');
      callbacks?.onOpen?.(sock);
    } else if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      console.warn(
        `[WhatsApp] Connection closed (status: ${statusCode || 'unknown'}).`
      );

      callbacks?.onClose?.(lastDisconnect?.error as Error | undefined, !isLoggedOut);

      if (isLoggedOut) {
        console.warn(
          '[WhatsApp] Device logged out or session expired (401). Deleting stale auth credentials...'
        );
        clearAuthState();
        console.log('[WhatsApp] Generating fresh QR code in 2 seconds...');
        setTimeout(() => {
          connectToWhatsApp(callbacks).catch((err) => {
            console.error('[WhatsApp] Fresh connection error:', err);
          });
        }, 2000);
      } else {
        console.log('[WhatsApp] Attempting reconnection in 3 seconds...');
        setTimeout(() => {
          connectToWhatsApp(callbacks).catch((err) => {
            console.error('[WhatsApp] Reconnection error:', err);
          });
        }, 3000);
      }
    }
  });

  // await sock.sendPresenceUpdate('unavailable')
  return sock;
}
