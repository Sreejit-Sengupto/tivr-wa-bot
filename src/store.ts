export interface StoredMessage {
  id: string;
  chatJid: string;
  senderJid: string;
  senderName: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export class MessageStore {
  private readonly maxLimit: number;
  private readonly store: Map<string, StoredMessage[]> = new Map();

  constructor(maxLimit: number = 20) {
    this.maxLimit = maxLimit;
  }

  /**
   * Adds a message to the in-memory buffer for a given chat.
   * Avoids duplicates and retains only the most recent N messages.
   */
  public add(message: StoredMessage): void {
    if (!message.text || !message.text.trim()) {
      return;
    }

    const messages = this.store.get(message.chatJid) || [];

    // Avoid duplicate message insertions
    if (messages.some((m) => m.id === message.id)) {
      return;
    }

    messages.push(message);

    // Keep only the most recent `maxLimit` messages
    if (messages.length > this.maxLimit) {
      messages.splice(0, messages.length - this.maxLimit);
    }

    this.store.set(message.chatJid, messages);
  }

  /**
   * Retrieves the most recent messages for a given chat.
   */
  public getRecent(chatJid: string): StoredMessage[] {
    return [...(this.store.get(chatJid) || [])];
  }

  /**
   * Returns the count of stored messages for a given chat.
   */
  public count(chatJid: string): number {
    return (this.store.get(chatJid) || []).length;
  }

  /**
   * Clears stored messages for a specific chat or all chats.
   */
  public clear(chatJid?: string): void {
    if (chatJid) {
      this.store.delete(chatJid);
    } else {
      this.store.clear();
    }
  }
}

export const messageStore = new MessageStore(20);
