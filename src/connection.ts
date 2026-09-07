import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  type WASocket,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import pino from "pino";
import fs from "node:fs";
import { config } from "./config.js";

export interface ConnectionCallbacks {
  onOpen?: (sock: WASocket) => Promise<void> | void;
  onClose?: (
    error: Error | undefined,
    shouldReconnect: boolean,
  ) => Promise<void> | void;
  onConnecting?: () => Promise<void> | void;
  onQR?: (qr: string) => Promise<void> | void;
}

// Singleton tracking for active socket and reconnection timers to prevent duplicate connections
let activeSocket: WASocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

/**
 * Utility to safely delete the stored authentication directory
 * so that subsequent attempts generate a fresh QR code.
 */
export function clearAuthState(): void {
  try {
    if (fs.existsSync(config.authDir)) {
      fs.rmSync(config.authDir, { recursive: true, force: true });
      console.log(
        `[WhatsApp] Cleared auth credentials directory: ${config.authDir}`,
      );
    }
  } catch (err) {
    console.error(
      `[WhatsApp] Failed to clear auth directory ${config.authDir}:`,
      err,
    );
  }
}

/**
 * Cleans up and tears down any existing active socket and pending reconnect timers.
 * Prevents multiple parallel WASocket instances from conflicting on auth state.
 */
export function cleanupActiveSocket(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (activeSocket) {
    try {
      activeSocket.ws?.close();
      activeSocket.end(undefined);
    } catch {
      // Ignore errors during socket cleanup
    }
    activeSocket = null;
  }
}

/**
 * Initializes and establishes a WhatsApp socket connection via Baileys.
 * Handles authentication state persistence, terminal QR generation,
 * session renewal, automatic stale session cleanup, and single-instance reconnection.
 */
export async function connectToWhatsApp(
  callbacks?: ConnectionCallbacks,
): Promise<WASocket> {
  // Ensure any previous socket or timer is cleanly torn down before establishing a new socket
  cleanupActiveSocket();

  const logger = pino({
    level: config.logLevel,
  });

  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger: logger.child({ module: "baileys" }),
    browser: Browsers.macOS("Chrome"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    keepAliveIntervalMs: 25_000,
    connectTimeoutMs: 60_000,
    retryRequestDelayMs: 2000,
    maxMsgRetryCount: 5,
    fireInitQueries: config.syncHistory,
    shouldSyncHistoryMessage: () => config.syncHistory,
    transactionOpts: {
      maxCommitRetries: 10,
      delayBetweenTriesMs: 3000,
    },
  });

  activeSocket = sock;

  // Save updated session credentials whenever they change
  sock.ev.on("creds.update", saveCreds);

  // Monitor connection updates
  sock.ev.on("connection.update", (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n==================================================");
      console.log(" Scan this QR code with WhatsApp on your phone:");
      console.log(" (WhatsApp -> Linked Devices -> Link a Device)");
      console.log("==================================================\n");
      qrcode.generate(qr, { small: true });
      callbacks?.onQR?.(qr);
    }

    if (connection === "connecting") {
      console.log("[WhatsApp] Connecting to WhatsApp servers...");
      callbacks?.onConnecting?.();
    } else if (connection === "open") {
      console.log(
        "[WhatsApp] Connection established successfully! Socket is ready.",
      );
      callbacks?.onOpen?.(sock);
    } else if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const isRestartRequired = statusCode === DisconnectReason.restartRequired;
      const isBadSession = statusCode === DisconnectReason.badSession;

      console.warn(
        `[WhatsApp] Connection closed (status: ${statusCode || "unknown"}).`,
      );

      callbacks?.onClose?.(
        lastDisconnect?.error as Error | undefined,
        !isLoggedOut,
      );

      const scheduleReconnect = (
        delayMs: number,
        clearAuth: boolean = false,
      ) => {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }

        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (clearAuth) {
            clearAuthState();
          }
          connectToWhatsApp(callbacks).catch((err) => {
            console.error("[WhatsApp] Reconnection error:", err);
          });
        }, delayMs);
      };

      if (isLoggedOut || isBadSession) {
        console.warn(
          `[WhatsApp] Session expired or invalid (status: ${statusCode}). Deleting stale auth credentials...`,
        );
        console.log("[WhatsApp] Generating fresh QR code in 2 seconds...");
        scheduleReconnect(2000, true);
      } else if (isRestartRequired) {
        console.log(
          "[WhatsApp] Restart required (status: 515). Reconnecting immediately...",
        );
        scheduleReconnect(0, false);
      } else {
        console.log("[WhatsApp] Attempting reconnection in 3 seconds...");
        scheduleReconnect(3000, false);
      }
    }
  });

  return sock;
}
