// The conversation: an external store (like the app state) so the map, the composer and the cards stay in sync.

import type { AppState } from "@/core/state/store";
import type { Card, CardKind, Source } from "./compose";

export type Via = "text" | "voice" | "chip";
export type Message =
  | { role: "user"; id: number; text: string; via: Via }
  | { role: "assistant"; id: number; card: Card };

export interface Pending { kind: CardKind; source: Source; correctable: boolean; waitLayer: string }

export interface ConversationSnapshot {
  messages: Message[];
  /** Read answers aloud: on after a spoken question (voice in → voice out), or when the user turns it on. */
  voiceReply: boolean;
}

let uid = 1;

export class Conversation {
  private snap: ConversationSnapshot = { messages: [], voiceReply: false };
  private listeners = new Set<() => void>();
  /** Unknown commands in a row: after 3, the assistant shows the menu and stops insisting (doc 02 F3). */
  unknownStreak = 0;
  /** States before each command, for «No era eso». */
  undo: AppState[] = [];
  /** A card waiting for its layer to load (e.g. after switching 24 → 45 years). */
  pending: Pending | null = null;

  get = (): ConversationSnapshot => this.snap;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };

  private emit(next: Partial<ConversationSnapshot>): void {
    this.snap = { ...this.snap, ...next };
    for (const l of this.listeners) l();
  }

  say(text: string, via: Via): void {
    this.emit({ messages: [...this.snap.messages, { role: "user", id: uid++, text, via }] });
  }

  /**
   * Adds an answer. Answers to map taps or to the map controls REPLACE the previous one of the same kind
   * when nothing was said in between, so exploring does not flood the conversation (doc 02 F1).
   */
  answer(card: Card): void {
    const msgs = this.snap.messages;
    const last = msgs.at(-1);
    if ((card.source === "map" || card.source === "controls") && last?.role === "assistant" && last.card.source === card.source) {
      this.emit({ messages: [...msgs.slice(0, -1), { role: "assistant", id: last.id, card }] });
      return;
    }
    this.emit({ messages: [...msgs, { role: "assistant", id: uid++, card }] });
  }

  /** Waits for a layer before answering (see run.ts flushPending). */
  wait(p: Pending): void {
    this.pending = p;
  }

  setVoiceReply(on: boolean): void {
    if (on !== this.snap.voiceReply) this.emit({ voiceReply: on });
  }

  clear(): void {
    this.unknownStreak = 0;
    this.undo = [];
    this.pending = null;
    this.emit({ messages: [] });
  }

  lastCard(): Card | null {
    for (let i = this.snap.messages.length - 1; i >= 0; i--) {
      const m = this.snap.messages[i];
      if (m.role === "assistant") return m.card;
    }
    return null;
  }
}
