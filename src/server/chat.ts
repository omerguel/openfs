/* ------------------------------------------------------------------ */
/* Plaudern (chat) — DB access + validation + HTTP wrappers.           */
/* Self-contained: the tables are not part of db.ts, so chatRoutes()   */
/* calls ensureChatTables() itself. Mount via `...chatRoutes(db)` in   */
/* the Bun.serve() routes object in src/index.ts.                      */
/* ------------------------------------------------------------------ */

import type { Database } from "./sqlite";
import type { BunRequest } from "bun";

import { ValidationError } from "./engine";
import { handle, json } from "./http";
import { demoDataEnabled } from "./db";

export type ChatSender = "schule" | "schueler";

export type Conversation = {
  id: number;
  studentId: number | null;
  studentName: string;
  lastMessageAt: string | null;
  unread: number;
  createdAt: string;
  /** Text of the newest message — "" when the thread is empty. */
  lastMessage: string;
};

export type ChatMessage = {
  id: number;
  conversationId: number;
  sender: ChatSender;
  text: string;
  sentAt: string;
};

export type ConversationInput = {
  student_id?: number | null;
  student_name: string;
};

const DDL = `
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER,
  student_name TEXT NOT NULL,
  last_message_at TEXT,
  unread INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  sender TEXT NOT NULL CHECK (sender IN ('schule','schueler')),
  text TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id);
`;

/* Demo threads — imported once into an empty table; afterwards the DB is
   the source of truth (/api/conversations). `age` is a SQLite datetime
   modifier relative to now so the seed always looks recent. */
type SeedMessage = { sender: ChatSender; text: string; age: string };
type SeedConversation = { messages: SeedMessage[]; unread: number };

const CONVERSATION_SEED: SeedConversation[] = [
  {
    // Terminverschiebung — last word from the student → unread.
    unread: 1,
    messages: [
      {
        sender: "schueler",
        text: "Hallo! Ich muss leider meine Fahrstunde am Donnerstag verschieben, ich habe einen Arzttermin bekommen.",
        age: "-2880 minutes", // vor 2 Tagen
      },
      {
        sender: "schule",
        text: "Kein Problem, danke für die frühe Info. Passt dir Freitag um 15:00 Uhr stattdessen?",
        age: "-2855 minutes",
      },
      {
        sender: "schueler",
        text: "Freitag 15:00 Uhr passt super, vielen Dank!",
        age: "-30 minutes",
      },
    ],
  },
  {
    // Theorieprüfung.
    unread: 0,
    messages: [
      {
        sender: "schueler",
        text: "Guten Tag, wann findet die nächste Theorieprüfung statt? Ich habe alle Pflichtstunden zusammen.",
        age: "-5760 minutes", // vor 4 Tagen
      },
      {
        sender: "schule",
        text: "Hallo! Der nächste TÜV-Termin ist am 24.06. um 09:00 Uhr. Soll ich dich anmelden?",
        age: "-5720 minutes",
      },
      {
        sender: "schueler",
        text: "Ja bitte, melden Sie mich an. Brauche ich noch Unterlagen?",
        age: "-4320 minutes", // vor 3 Tagen
      },
      {
        sender: "schule",
        text: "Erledigt! Bitte Personalausweis und Ausbildungsnachweis mitbringen. Viel Erfolg beim Üben!",
        age: "-4305 minutes",
      },
    ],
  },
  {
    // Fragen zur Abrechnung — two unread student messages.
    unread: 2,
    messages: [
      {
        sender: "schueler",
        text: "Hallo, ich habe eine Frage zur letzten Rechnung. Wurden da zwei Fahrstunden doppelt berechnet?",
        age: "-1440 minutes", // vor 1 Tag
      },
      {
        sender: "schueler",
        text: "Es geht um die Position vom 02.06. — da steht zweimal 'Übungsstunde 45 Min'.",
        age: "-1435 minutes",
      },
    ],
  },
  {
    // Erste Fahrstunde / Organisatorisches.
    unread: 0,
    messages: [
      {
        sender: "schule",
        text: "Willkommen bei der Fahrschule! Deine erste Fahrstunde ist am Montag um 16:30 Uhr, Treffpunkt vor der Fahrschule.",
        age: "-8640 minutes", // vor 6 Tagen
      },
      {
        sender: "schueler",
        text: "Danke! Soll ich etwas mitbringen?",
        age: "-8580 minutes",
      },
      {
        sender: "schule",
        text: "Nur bequeme Schuhe und deinen Ausbildungsvertrag. Bis Montag!",
        age: "-7200 minutes", // vor 5 Tagen
      },
    ],
  },
];

const FALLBACK_NAMES = ["Lena Braun", "Jonas Meyer", "Aylin Demir", "Tom Richter"];

/* Pull real students for the seed when the students table exists and has
   rows — keeps the demo threads linked to /fahrschueler records. */
function seedStudents(db: Database): { id: number | null; name: string }[] {
  try {
    const rows = db
      .query<{ id: number; name: string }, []>(
        `SELECT id, trim(first_name || ' ' || last_name) AS name
         FROM students ORDER BY id LIMIT ${CONVERSATION_SEED.length}`,
      )
      .all()
      .filter((row) => row.name.length > 0);
    if (rows.length > 0) {
      return CONVERSATION_SEED.map(
        (_, index) => rows[index] ?? { id: null, name: FALLBACK_NAMES[index]! },
      );
    }
  } catch {
    // No students table (bare DB) — fall through to plain names.
  }
  return FALLBACK_NAMES.map((name) => ({ id: null, name }));
}

/** Creates the chat tables and seeds demo conversations — only when empty. */
export function ensureChatTables(db: Database) {
  db.exec(DDL);

  // Idempotent migration: add the orphaned marker column if absent.
  const hasOrphaned = db
    .query<{ name: string }, [string]>(
      "SELECT name FROM pragma_table_info('conversations') WHERE name = ?",
    )
    .get("orphaned");
  if (!hasOrphaned) {
    db.exec("ALTER TABLE conversations ADD COLUMN orphaned INTEGER NOT NULL DEFAULT 0");
  }

  const count = db
    .query<{ n: number }, []>("SELECT count(*) AS n FROM conversations")
    .get()!.n;
  if (count > 0 || !demoDataEnabled(db)) return;

  const students = seedStudents(db);
  const insertConversation = db.prepare(
    `INSERT INTO conversations (student_id, student_name, last_message_at, unread, created_at)
     VALUES (?, ?, NULL, ?, datetime('now', ?))`,
  );
  const insertMessage = db.prepare(
    `INSERT INTO chat_messages (conversation_id, sender, text, sent_at)
     VALUES (?, ?, ?, datetime('now', ?))`,
  );
  const syncLastMessage = db.prepare(
    `UPDATE conversations
     SET last_message_at = (
       SELECT max(sent_at) FROM chat_messages WHERE conversation_id = ?
     )
     WHERE id = ?`,
  );

  const seed = db.transaction(() => {
    CONVERSATION_SEED.forEach((thread, index) => {
      const student = students[index] ?? { id: null, name: FALLBACK_NAMES[index]! };
      const firstAge = thread.messages[0]?.age ?? "-10080 minutes";
      const conversationId = Number(
        insertConversation.run(student.id, student.name, thread.unread, firstAge)
          .lastInsertRowid,
      );
      for (const message of thread.messages) {
        insertMessage.run(conversationId, message.sender, message.text, message.age);
      }
      syncLastMessage.run(conversationId, conversationId);
    });
  });
  seed();
}

/* ------------------------------------------------------------------ */
/* Reads                                                                */
/* ------------------------------------------------------------------ */

type ConversationRow = {
  id: number;
  student_id: number | null;
  student_name: string;
  last_message_at: string | null;
  unread: number;
  created_at: string;
  last_message: string | null;
};

const toConversation = (row: ConversationRow): Conversation => ({
  id: row.id,
  studentId: row.student_id,
  studentName: row.student_name,
  lastMessageAt: row.last_message_at,
  unread: row.unread,
  createdAt: row.created_at,
  lastMessage: row.last_message ?? "",
});

const CONVERSATION_SELECT = `
  SELECT c.id, c.student_id, c.student_name, c.last_message_at, c.unread,
         c.created_at,
         (SELECT m.text FROM chat_messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS last_message
  FROM conversations c`;

export function listConversations(db: Database): Conversation[] {
  return db
    .query<ConversationRow, []>(
      `${CONVERSATION_SELECT}
       ORDER BY coalesce(c.last_message_at, c.created_at) DESC, c.id DESC`,
    )
    .all()
    .map(toConversation);
}

export function getConversation(db: Database, id: number): Conversation {
  const row = db
    .query<ConversationRow, [number]>(`${CONVERSATION_SELECT} WHERE c.id = ?`)
    .get(id);
  if (!row) throw new ValidationError("Unterhaltung nicht gefunden.");
  return toConversation(row);
}

type MessageRow = {
  id: number;
  conversation_id: number;
  sender: ChatSender;
  text: string;
  sent_at: string;
};

const toMessage = (row: MessageRow): ChatMessage => ({
  id: row.id,
  conversationId: row.conversation_id,
  sender: row.sender,
  text: row.text,
  sentAt: row.sent_at,
});

export function listMessages(db: Database, conversationId: number): ChatMessage[] {
  getConversation(db, conversationId); // throws when missing
  return db
    .query<MessageRow, [number]>(
      `SELECT id, conversation_id, sender, text, sent_at
       FROM chat_messages WHERE conversation_id = ?
       ORDER BY sent_at, id`,
    )
    .all(conversationId)
    .map(toMessage);
}

/* ------------------------------------------------------------------ */
/* Writes                                                               */
/* ------------------------------------------------------------------ */

/* Shared insert: bumps last_message_at; a student message raises the
   unread counter (shown in /plaudern), a school reply clears it. */
function insertMessage(
  db: Database,
  conversationId: number,
  sender: ChatSender,
  text: unknown,
  maxLength?: number,
): ChatMessage {
  getConversation(db, conversationId); // throws when missing
  if (typeof text !== "string" || !text.trim()) {
    throw new ValidationError("Nachricht darf nicht leer sein.");
  }
  const body = text.trim();
  if (maxLength !== undefined && body.length > maxLength) {
    throw new ValidationError(`Nachricht darf maximal ${maxLength} Zeichen lang sein.`);
  }

  const send = db.transaction(() => {
    const row = db
      .query<MessageRow, [number, string, string]>(
        `INSERT INTO chat_messages (conversation_id, sender, text)
         VALUES (?, ?, ?)
         RETURNING id, conversation_id, sender, text, sent_at`,
      )
      .get(conversationId, sender, body)!;
    db.prepare(
      sender === "schule"
        ? "UPDATE conversations SET last_message_at = ?, unread = 0 WHERE id = ?"
        : "UPDATE conversations SET last_message_at = ?, unread = unread + 1 WHERE id = ?",
    ).run(row.sent_at, conversationId);
    return row;
  });
  return toMessage(send());
}

/** Inserts a 'schule' message, bumps last_message_at and clears unread. */
export function sendMessage(
  db: Database,
  conversationId: number,
  text: unknown,
): ChatMessage {
  return insertMessage(db, conversationId, "schule", text);
}

/** Cap for messages arriving through the public Schülerportal. */
export const STUDENT_MESSAGE_MAX_LEN = 2000;

/** Inserts a 'schueler' message (Schülerportal) and bumps unread. */
export function sendStudentMessage(
  db: Database,
  conversationId: number,
  text: unknown,
): ChatMessage {
  return insertMessage(db, conversationId, "schueler", text, STUDENT_MESSAGE_MAX_LEN);
}

/** The live (non-orphaned) thread of a student, or null. */
export function findStudentConversation(
  db: Database,
  studentId: number,
): Conversation | null {
  const row = db
    .query<{ id: number }, [number]>(
      "SELECT id FROM conversations WHERE student_id = ? AND orphaned = 0 ORDER BY id LIMIT 1",
    )
    .get(studentId);
  return row ? getConversation(db, row.id) : null;
}

export function markRead(db: Database, conversationId: number): Conversation {
  getConversation(db, conversationId); // throws when missing
  db.prepare("UPDATE conversations SET unread = 0 WHERE id = ?").run(conversationId);
  return getConversation(db, conversationId);
}

/** Starts a conversation — reuses an existing thread for the same student
 *  (matched by student_id, then by name) instead of creating a duplicate. */
export function createConversation(
  db: Database,
  input: Partial<ConversationInput>,
): Conversation {
  const name = typeof input.student_name === "string" ? input.student_name.trim() : "";
  if (!name) {
    throw new ValidationError("Name ist ein Pflichtfeld.");
  }

  let studentId: number | null = null;
  if (input.student_id !== undefined && input.student_id !== null) {
    if (!Number.isInteger(input.student_id) || input.student_id <= 0) {
      throw new ValidationError(
        "Feld 'student_id' muss eine Fahrschüler-ID oder null sein.",
      );
    }
    studentId = input.student_id;
  }

  const existing =
    studentId !== null
      ? db
          .query<{ id: number }, [number]>(
            "SELECT id FROM conversations WHERE student_id = ? AND orphaned = 0 LIMIT 1",
          )
          .get(studentId)
      : db
          .query<{ id: number }, [string]>(
            "SELECT id FROM conversations WHERE student_name = ? AND orphaned = 0 LIMIT 1",
          )
          .get(name);
  if (existing) return getConversation(db, existing.id);

  const row = db
    .query<{ id: number }, [number | null, string]>(
      `INSERT INTO conversations (student_id, student_name)
       VALUES (?, ?) RETURNING id`,
    )
    .get(studentId, name)!;
  return getConversation(db, row.id);
}

/** Hard delete — removes the thread and all of its messages. */
export function deleteConversation(db: Database, id: number): void {
  getConversation(db, id); // throws when missing
  const remove = db.transaction(() => {
    db.prepare("DELETE FROM chat_messages WHERE conversation_id = ?").run(id);
    db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  });
  remove();
}

/* ------------------------------------------------------------------ */
/* HTTP layer — same shape as the factories in routes.ts. Local         */
/* json/handle helpers because routes.ts must stay untouched.           */
/* ------------------------------------------------------------------ */

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) {
    throw new ValidationError("Ungültige Unterhaltungs-ID.");
  }
  return id;
}

export function chatRoutes(db: Database) {
  ensureChatTables(db);

  return {
    "/api/conversations": {
      GET: (req: BunRequest) =>
        handle(() => json({ conversations: listConversations(db) }))(),
      POST: (req: BunRequest) =>
        handle(async () =>
          json(
            createConversation(db, (await req.json()) as Partial<ConversationInput>),
            201,
          ),
        )(),
    },

    "/api/conversations/:id/messages": {
      GET: (req: BunRequest<"/api/conversations/:id/messages">) =>
        handle(() => json({ messages: listMessages(db, parseId(req.params.id)) }))(),
      POST: (req: BunRequest<"/api/conversations/:id/messages">) =>
        handle(async () => {
          const body = (await req.json()) as { text?: unknown };
          return json(sendMessage(db, parseId(req.params.id), body.text), 201);
        })(),
    },

    "/api/conversations/:id/read": {
      POST: (req: BunRequest<"/api/conversations/:id/read">) =>
        handle(() => json(markRead(db, parseId(req.params.id))))(),
    },

    "/api/conversations/:id": {
      DELETE: (req: BunRequest<"/api/conversations/:id">) =>
        handle(() => {
          deleteConversation(db, parseId(req.params.id));
          return json({ ok: true });
        })(),
    },
  };
}
