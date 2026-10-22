import type { TTarsJsonField } from 'librechat-data-provider';

/** The conversation history a traced message carried, numbered by turn. */

export type HistoryTurnEntry = {
  turnIndex: number;
  role: string;
  content: TTarsJsonField;
};

/** Annotates each history entry with its turn index based on user messages. */
export function annotateHistoryTurns(
  history: { role: string; content: TTarsJsonField }[],
): HistoryTurnEntry[] {
  let userTurn = 0;
  return history.map((entry) => {
    if (entry.role === 'user') {
      userTurn += 1;
    }
    return {
      turnIndex: Math.max(1, userTurn),
      role: entry.role,
      content: entry.content,
    };
  });
}
