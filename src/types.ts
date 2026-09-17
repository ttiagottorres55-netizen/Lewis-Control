export interface PersonEntry {
  id: string;
  fullName: string;
  dni: string;
}

export interface TransferRecord {
  id: string; // Unique timestamp/UUID
  rowNumber?: number; // 1-based row index in Google Sheets
  indexNumber: number; // Enumerated number #1, #2...
  timestamp: string; // Date and time ISO or formatted string
  staffMemberName: string; // Name of staff who registered it (Tiago, Juan, Bauti, etc.)
  fullName: string; // Nombre y Apellido
  dni: string; // Documento de identidad
  hasTransferred: boolean; // Si transfirió o no (Sí / No)
  receiptDriveUrl: string; // Google Drive link or data URL
  receiptFileId?: string; // Drive file ID if uploaded
  receiptFileName?: string;
  isApproved: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';
  adminNotes?: string;
  groupTransferId?: string; // If submitted as part of a group with 1 shared receipt
  updatedAt?: string;
}

export type UserRole = 'STAFF' | 'ADMIN';

export const STAFF_MEMBERS = [
  'Tiago',
  'Juan',
  'Bauti',
  'Rocco',
  'Eze',
  'Nico',
  'Renzo',
  'Lau',
] as const;

export type StaffMember = (typeof STAFF_MEMBERS)[number];

export interface AppConfig {
  spreadsheetId: string;
  spreadsheetUrl: string;
  sheetName: string;
  driveFolderId?: string;
  adminEmail: string;
}
