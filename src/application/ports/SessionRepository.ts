import type { TableSession } from "@/domain/session/TableSession";

export interface SessionRepository {
  findById(id: string): Promise<TableSession | null>;
  /** Open sessions across all tables (for floor map and alerts). */
  listOpen(): Promise<readonly TableSession[]>;
  /** The single open session for a table, or null. */
  findOpenForTable(tableId: string): Promise<TableSession | null>;
  open(session: TableSession): Promise<TableSession>;
  close(id: string, closedAt: Date): Promise<void>;
  setMenuOpened(id: string, openedAt: Date): Promise<void>;
}
