/**
 * Google Sheets and Google Drive API Integration Services
 */

import { TransferRecord, AppConfig } from '../types';
import { getAccessToken, refreshGoogleToken } from './firebaseAuth';

declare global {
  interface Window {
    google?: any;
  }
}

export class AuthExpiredError extends Error {
  readonly isAuthExpired = true;
  constructor(message = 'Las credenciales de Google requieren reconexión.') {
    super(message);
    this.name = 'AuthExpiredError';
  }
}

let authExpiredListener: (() => void) | null = null;

export function setAuthExpiredListener(listener: (() => void) | null) {
  authExpiredListener = listener;
}

export function notifyAuthExpired() {
  if (authExpiredListener) {
    try {
      authExpiredListener();
    } catch (e) {
      console.error('Error invoking authExpiredListener:', e);
    }
  }
}

/**
 * Universal authenticated fetch with automatic silent token refresh & retry on 401.
 * Ensures the Google Sheets connection remains permanently active without user disconnects.
 */
export async function fetchWithGoogleAuth(
  url: string,
  init: RequestInit = {},
  fallbackToken?: string
): Promise<Response> {
  const token = (await getAccessToken()) || fallbackToken || (typeof window !== 'undefined' ? localStorage.getItem('google_access_token') : '') || '';
  
  const headers = new Headers(init.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let res = await fetch(url, { ...init, headers });

  // If 401 Unauthorized, automatically renew token silently and retry once
  if (res.status === 401) {
    console.log('Google Auth token expired (401). Performing automatic silent refresh...');
    try {
      const freshToken = await refreshGoogleToken(true);
      if (freshToken) {
        const retryHeaders = new Headers(init.headers || {});
        retryHeaders.set('Authorization', `Bearer ${freshToken}`);
        res = await fetch(url, { ...init, headers: retryHeaders });
      }
    } catch (refreshErr) {
      console.warn('Silent token refresh failed:', refreshErr);
    }
  }

  return res;
}

export function checkResponseAuth(status: number, responseBody?: string) {
  if (status === 401 || (responseBody && (responseBody.includes('UNAUTHENTICATED') || responseBody.includes('invalid authentication credentials')))) {
    notifyAuthExpired();
    throw new AuthExpiredError();
  }
}

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const SCOPES = `${SHEETS_SCOPE} ${DRIVE_SCOPE}`;

const DEFAULT_SHEET_NAME = 'Transferencias';
let cachedSheetTitle = DEFAULT_SHEET_NAME;
let hasResolvedSheetTitle = false;

// Helper to escape sheet name in Google Sheets A1 notation: 'Sheet Name'!Range
export function formatA1Range(sheetTitle: string, cellOrRange: string): string {
  const safeTitle = (sheetTitle || DEFAULT_SHEET_NAME).replace(/'/g, "''");
  return `'${safeTitle}'!${cellOrRange}`;
}

// Helper for URL parameters
export function encodeA1Range(sheetTitle: string, cellOrRange: string): string {
  return encodeURIComponent(formatA1Range(sheetTitle, cellOrRange));
}

const HEADERS = [
  'N°',
  'Nombre y Apellido',
  'DNI',
  '¿Transfirió?',
  'Comprobante (Enlace)',
  'Estado Aprobación',
  'Fecha de Carga',
  'Cargado Por (Staff)',
  'ID Registro',
  'ID Grupo'
];

// Helper to convert 0-based column index to A1 letter (0 -> A, 1 -> B, etc.)
function colIndexToLetter(idx: number): string {
  let letter = '';
  let temp = idx;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter || 'F';
}

// Cached dynamic column configuration
let cachedStatusColIdx = 5; // Default Column F
let cachedIdColIdx = 8;     // Default Column I
let cachedDniColIdx = 2;    // Default Column C
let cachedIndexColIdx = 0;  // Default Column A
let cachedNameColIdx = 1;   // Default Column B
let cachedGroupColIdx = 9;  // Default Column J
let sheetPrefersFeminine = false; // Whether the sheet uses "APROBADA / NO APROBADA"

function updateDynamicColumnIndices(headerRow: any[]) {
  if (!headerRow || headerRow.length === 0) return;
  const headers = headerRow.map((h) => String(h || '').toUpperCase().trim());

  const statusIdx = headers.findIndex(
    (h) => h.includes('ESTADO') || h.includes('APROBA') || h.includes('STATUS') || h.includes('VALIDA')
  );
  if (statusIdx !== -1) cachedStatusColIdx = statusIdx;

  const idIdx = headers.findIndex((h) => h.includes('ID') && !h.includes('GRUPO'));
  if (idIdx !== -1) cachedIdColIdx = idIdx;

  const groupIdx = headers.findIndex((h) => h.includes('GRUPO') || h.includes('GROUP'));
  if (groupIdx !== -1) cachedGroupColIdx = groupIdx;

  const dniIdx = headers.findIndex((h) => h.includes('DNI') || h.includes('DOC') || h.includes('IDENT'));
  if (dniIdx !== -1) cachedDniColIdx = dniIdx;

  const numIdx = headers.findIndex((h) => h.includes('N°') || h.includes('NUM') || h === '#' || h.includes('ORDEN'));
  if (numIdx !== -1) cachedIndexColIdx = numIdx;

  const nameIdx = headers.findIndex((h) => h.includes('NOMBRE') || h.includes('APELLIDO'));
  if (nameIdx !== -1) cachedNameColIdx = nameIdx;
}

/**
 * Dynamically resolves the actual sheet tab title from the spreadsheet metadata.
 * Works seamlessly whether the tab is named "Transferencias", "Hoja 1", "Sheet1", etc.
 */
export async function getOrResolveSheetTitle(
  accessToken: string,
  spreadsheetId: string,
  forceRefresh = false
): Promise<string> {
  if (hasResolvedSheetTitle && !forceRefresh && cachedSheetTitle) {
    return cachedSheetTitle;
  }

  try {
    const res = await fetchWithGoogleAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
      {},
      accessToken
    );
    if (res.status === 401) {
      checkResponseAuth(401);
    }
    if (res.ok) {
      const data = await res.json();
      const sheetsList: any[] = data.sheets || [];
      if (sheetsList.length > 0) {
        // Look for 'Transferencias' tab first
        const transferSheet = sheetsList.find((s) => {
          const t = String(s.properties?.title || '').trim().toLowerCase();
          return t === 'transferencias' || t.includes('transferencia');
        });

        if (transferSheet?.properties?.title) {
          cachedSheetTitle = transferSheet.properties.title;
        } else {
          // Use the first sheet tab
          cachedSheetTitle = sheetsList[0].properties?.title || DEFAULT_SHEET_NAME;
        }
        hasResolvedSheetTitle = true;
      }
    }
  } catch (e: any) {
    if (e?.name === 'AuthExpiredError' || e?.isAuthExpired) throw e;
    console.warn('Could not inspect sheet properties, using fallback title:', e);
  }

  return cachedSheetTitle;
}

/**
 * Upload an image or file (Blob / Base64) to Google Drive and return webViewLink
 */
export async function uploadReceiptToDrive(
  accessToken: string,
  file: File | Blob,
  fileName: string,
  folderId?: string
): Promise<{ fileId: string; webViewLink: string; webContentLink?: string }> {
  const metadata: any = {
    name: fileName,
    mimeType: file.type || 'image/jpeg',
  };

  if (folderId) {
    metadata.parents = [folderId];
  }

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', file);

  const res = await fetchWithGoogleAuth(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink',
    {
      method: 'POST',
      body: form,
    },
    accessToken
  );

  if (!res.ok) {
    const errText = await res.text();
    checkResponseAuth(res.status, errText);
    console.error('Error uploading to Drive:', errText);
    throw new Error(`Error al subir comprobante a Google Drive: ${res.statusText}`);
  }

  const data = await res.json();

  // Try to set permissions so the file link is viewable
  try {
    await fetchWithGoogleAuth(
      `https://www.googleapis.com/drive/v3/files/${data.id}/permissions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'reader',
          type: 'anyone',
        }),
      },
      accessToken
    );
  } catch (permErr) {
    console.warn('Could not set public permission on file, viewable by owner only', permErr);
  }

  return {
    fileId: data.id,
    webViewLink: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`,
    webContentLink: data.webContentLink,
  };
}

/**
 * Initialize or get Google Spreadsheet for Transferencias
 */
export async function getOrCreateSpreadsheet(
  accessToken: string,
  existingSpreadsheetId?: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  if (existingSpreadsheetId) {
    // Verify it exists
    const checkRes = await fetchWithGoogleAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${existingSpreadsheetId}?fields=spreadsheetId,properties.title`,
      {},
      accessToken
    );
    if (checkRes.status === 401) {
      checkResponseAuth(401);
    }
    if (checkRes.ok) {
      return {
        spreadsheetId: existingSpreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${existingSpreadsheetId}/edit`,
      };
    }
  }

  // Create a new spreadsheet with the requested enumerated structure
  const createRes = await fetchWithGoogleAuth(
    'https://sheets.googleapis.com/v4/spreadsheets',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          title: 'Lewis Control - Control de Transferencias',
        },
        sheets: [
          {
            properties: {
              title: DEFAULT_SHEET_NAME,
              gridProperties: {
                frozenRowCount: 1,
              },
            },
          },
        ],
      }),
    },
    accessToken
  );

  if (!createRes.ok) {
    const errorText = await createRes.text();
    checkResponseAuth(createRes.status, errorText);
    throw new Error(`Error al crear Google Sheet: ${errorText}`);
  }

  const created = await createRes.json();
  const spreadsheetId = created.spreadsheetId;
  cachedSheetTitle = DEFAULT_SHEET_NAME;
  hasResolvedSheetTitle = true;

  // Insert headers and format header row
  const headerRangeUrl = encodeA1Range(DEFAULT_SHEET_NAME, 'A1:I1');
  await fetchWithGoogleAuth(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${headerRangeUrl}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [HEADERS],
      }),
    },
    accessToken
  );

  // Apply visual styling to the headers
  try {
    await fetchWithGoogleAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 1,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.08, green: 0.12, blue: 0.18 },
                    textFormat: {
                      bold: true,
                      foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                      fontSize: 11,
                    },
                    horizontalAlignment: 'CENTER',
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
              },
            },
            {
              autoResizeDimensions: {
                dimensions: {
                  sheetId: 0,
                  dimension: 'COLUMNS',
                  startIndex: 0,
                  endIndex: 9,
                },
              },
            },
          ],
        }),
      },
      accessToken
    );
  } catch (styleErr) {
    console.warn('Could not style header row:', styleErr);
  }

  return {
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

/**
 * Fetch all transfer records from the Google Sheet
 */
export async function fetchTransferRecords(
  accessToken: string,
  spreadsheetId: string
): Promise<TransferRecord[]> {
  const sheetTitle = await getOrResolveSheetTitle(accessToken, spreadsheetId);
  const rangeUrl = encodeA1Range(sheetTitle, 'A1:Z3000');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${rangeUrl}?valueRenderOption=UNFORMATTED_VALUE`;
  
  const res = await fetchWithGoogleAuth(url, {}, accessToken);

  if (!res.ok) {
    if (res.status === 401) {
      checkResponseAuth(401);
    }
    if (res.status === 404) return [];
    const errText = await res.text();
    checkResponseAuth(res.status, errText);
    throw new Error(`Error al leer los datos de Google Sheets (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const allRows: any[][] = data.values || [];
  if (allRows.length === 0) return [];

  // Check if first row is header
  let dataRows = allRows;
  let startRowNumber = 1;
  const firstRowStr = (allRows[0] || []).join(' ').toUpperCase();
  if (
    firstRowStr.includes('NOMBRE') ||
    firstRowStr.includes('DNI') ||
    firstRowStr.includes('N°') ||
    firstRowStr.includes('TRANSF') ||
    firstRowStr.includes('ESTADO')
  ) {
    updateDynamicColumnIndices(allRows[0]);
    dataRows = allRows.slice(1);
    startRowNumber = 2;
  }

  // Scan sample of rows to detect if user's sheet prefers feminine "APROBADA" vs "APROBADO"
  for (let i = 0; i < Math.min(dataRows.length, 20); i++) {
    const val = String(dataRows[i][cachedStatusColIdx] || '').toUpperCase();
    if (val.includes('APROBADA') || val.includes('RECHAZADA')) {
      sheetPrefersFeminine = true;
      break;
    }
  }

  // Count receipt URLs to detect multi-person transfers sharing the same payment receipt
  const receiptCounts = new Map<string, number>();
  dataRows.forEach((r) => {
    const rc = String(r[4] || '').trim();
    if (rc && rc.toLowerCase() !== 'sin comprobante' && rc !== '-' && rc.length > 5) {
      receiptCounts.set(rc, (receiptCounts.get(rc) || 0) + 1);
    }
  });

  return dataRows.map((row, index) => {
    const indexNumber = Number(row[cachedIndexColIdx]) || index + 1;
    const fullName = String(row[cachedNameColIdx] || row[1] || '').trim();
    const dni = String(row[cachedDniColIdx] || '').trim();
    const hasTransferredStr = String(row[3] || '').toUpperCase();
    const hasTransferred =
      hasTransferredStr.includes('SÍ') ||
      hasTransferredStr.includes('SI') ||
      hasTransferredStr === 'YES' ||
      hasTransferredStr === 'TRUE';
    const receiptDriveUrl = String(row[4] || '');

    // Approval status from dynamic column
    const isApprovedRaw = String(row[cachedStatusColIdx] || 'PENDIENTE').toUpperCase().trim();
    let isApproved: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' = 'PENDIENTE';

    // IMPORTANT: Check rejection first. "NO APROBADO" or "NO APROBADA" contains "APROB"
    // so checking approval first would falsely approve rejections!
    // Also, never treat "SÍ" or "SI" as approval (that is the answer to ¿Transfirió?).
    if (
      isApprovedRaw.includes('RECHAZ') ||
      isApprovedRaw.includes('NO APROB') ||
      isApprovedRaw.includes('REJECT') ||
      isApprovedRaw === 'NO' ||
      isApprovedRaw === 'DENEGADO'
    ) {
      isApproved = 'RECHAZADO';
    } else if (
      isApprovedRaw === 'APROBADO' ||
      isApprovedRaw === 'APROBADA' ||
      isApprovedRaw === 'APPROVED' ||
      isApprovedRaw.startsWith('APROB')
    ) {
      isApproved = 'APROBADO';
    } else {
      isApproved = 'PENDIENTE';
    }

    const timestamp = String(row[6] || '');
    const staffMemberName = String(row[7] || 'Staff');
    const id = String(row[cachedIdColIdx] || `rec-${index + 1}`);

    const rawGroup = String(row[cachedGroupColIdx] || row[9] || '').trim();
    const cleanReceipt = receiptDriveUrl.trim();
    const isSharedReceipt =
      cleanReceipt &&
      cleanReceipt.toLowerCase() !== 'sin comprobante' &&
      cleanReceipt !== '-' &&
      cleanReceipt.length > 5 &&
      (receiptCounts.get(cleanReceipt) || 0) > 1;

    const groupTransferId = rawGroup || (isSharedReceipt ? `rcp_${cleanReceipt}` : undefined);

    return {
      id,
      rowNumber: index + startRowNumber,
      indexNumber,
      fullName,
      dni,
      hasTransferred,
      receiptDriveUrl,
      isApproved,
      timestamp,
      staffMemberName,
      groupTransferId,
    };
  });
}

/**
 * Append a new record row to the Google Sheet and return the assigned row number
 */
export async function appendTransferRecord(
  accessToken: string,
  spreadsheetId: string,
  record: Omit<TransferRecord, 'rowNumber'>
): Promise<number> {
  const sheetTitle = await getOrResolveSheetTitle(accessToken, spreadsheetId);
  const rowValues = [
    record.indexNumber,
    record.fullName,
    record.dni,
    record.hasTransferred ? 'SÍ' : 'NO',
    record.receiptDriveUrl || 'Sin comprobante',
    record.isApproved,
    record.timestamp,
    record.staffMemberName,
    record.id,
    record.groupTransferId || '',
  ];

  const appendRangeUrl = encodeA1Range(sheetTitle, 'A:J');
  const res = await fetchWithGoogleAuth(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${appendRangeUrl}:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [rowValues],
      }),
    },
    accessToken
  );

  if (!res.ok) {
    const errText = await res.text();
    checkResponseAuth(res.status, errText);
    throw new Error(`Error al agregar fila en Google Sheets: ${errText}`);
  }

  const result = await res.json();
  let rowNumber = record.indexNumber + 1;
  const updatedRange = result.updates?.updatedRange || '';
  const match = updatedRange.match(/!A(\d+):/);
  if (match && match[1]) {
    rowNumber = parseInt(match[1], 10);
  }

  return rowNumber;
}

/**
 * Update approval status for multiple records in Google Sheets in batch or parallel,
 * ensuring correct rows are targeted even if row numbers shifted.
 */
export async function updateBatchRecordApprovalInSheet(
  accessToken: string,
  spreadsheetId: string,
  records: TransferRecord[],
  newStatus: 'APROBADO' | 'RECHAZADO' | 'PENDIENTE'
): Promise<{ id: string; rowNumber: number }[]> {
  if (records.length === 0) return [];

  const sheetTitle = await getOrResolveSheetTitle(accessToken, spreadsheetId);

  // Fetch current rows from sheet once to find row numbers accurately
  let allRows: any[][] = [];
  let startIdx = 0;
  try {
    const searchRangeUrl = encodeA1Range(sheetTitle, 'A:Z');
    const searchRes = await fetchWithGoogleAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${searchRangeUrl}?valueRenderOption=UNFORMATTED_VALUE`,
      {},
      accessToken
    );
    if (searchRes.status === 401) {
      checkResponseAuth(401);
    }
    if (searchRes.ok) {
      const data = await searchRes.json();
      allRows = data.values || [];
      if (allRows.length > 0) {
        const firstRowStr = (allRows[0] || []).join(' ').toUpperCase();
        if (
          firstRowStr.includes('NOMBRE') ||
          firstRowStr.includes('DNI') ||
          firstRowStr.includes('N°') ||
          firstRowStr.includes('TRANSF') ||
          firstRowStr.includes('ESTADO')
        ) {
          updateDynamicColumnIndices(allRows[0]);
          startIdx = 1;
        }
      }
    }
  } catch (e: any) {
    if (e?.name === 'AuthExpiredError' || e?.isAuthExpired) throw e;
    console.warn('Error reading sheet rows for batch update:', e);
  }

  const updates: { range: string; values: string[][] }[] = [];
  const results: { id: string; rowNumber: number }[] = [];

  // Determine written status value
  const writtenStatus =
    newStatus === 'APROBADO'
      ? sheetPrefersFeminine
        ? 'APROBADA'
        : 'APROBADO'
      : newStatus === 'RECHAZADO'
      ? sheetPrefersFeminine
        ? 'RECHAZADA'
        : 'RECHAZADO'
      : 'PENDIENTE';

  for (const rec of records) {
    let targetRow: number | null = null;

    // 1. Verify if rec.rowNumber is directly valid in allRows
    if (rec.rowNumber && rec.rowNumber >= 2 && allRows.length >= rec.rowNumber) {
      const rowAtExpected = allRows[rec.rowNumber - 1];
      const rId = String(rowAtExpected[cachedIdColIdx] || rowAtExpected[8] || '').trim();
      const rIdx = Number(rowAtExpected[cachedIndexColIdx] || rowAtExpected[0]);
      const rDni = String(rowAtExpected[cachedDniColIdx] || rowAtExpected[2] || '').trim();

      if (
        (rec.id && rId === rec.id.trim()) ||
        (rec.indexNumber && rIdx === rec.indexNumber) ||
        (rec.dni && rDni === rec.dni.trim())
      ) {
        targetRow = rec.rowNumber;
      }
    }

    // 2. Pass 1: Match by exact ID
    if (!targetRow && rec.id && allRows.length > 0) {
      const targetId = rec.id.trim();
      for (let i = startIdx; i < allRows.length; i++) {
        const rowId = String(allRows[i][cachedIdColIdx] || allRows[i][8] || '').trim();
        if (rowId && rowId === targetId) {
          targetRow = i + 1;
          break;
        }
      }
    }

    // 3. Pass 2: Match by exact DNI and Index together
    if (!targetRow && rec.dni && rec.indexNumber && allRows.length > 0) {
      const targetDni = rec.dni.trim();
      for (let i = startIdx; i < allRows.length; i++) {
        const rowDni = String(allRows[i][cachedDniColIdx] || allRows[i][2] || '').trim();
        const rowIdx = Number(allRows[i][cachedIndexColIdx] || allRows[i][0]);
        if (rowDni === targetDni && rowIdx === rec.indexNumber) {
          targetRow = i + 1;
          break;
        }
      }
    }

    // 4. Pass 3: Match by DNI
    if (!targetRow && rec.dni && allRows.length > 0) {
      const targetDni = rec.dni.trim();
      for (let i = startIdx; i < allRows.length; i++) {
        const rowDni = String(allRows[i][cachedDniColIdx] || allRows[i][2] || '').trim();
        if (rowDni && rowDni === targetDni) {
          targetRow = i + 1;
          break;
        }
      }
    }

    // 5. Pass 4: Match by Index Number (#1, #2, etc.)
    if (!targetRow && rec.indexNumber && allRows.length > 0) {
      for (let i = startIdx; i < allRows.length; i++) {
        const rowIdx = Number(allRows[i][cachedIndexColIdx] || allRows[i][0]);
        if (rowIdx === rec.indexNumber) {
          targetRow = i + 1;
          break;
        }
      }
    }

    // Fallback estimate
    if (!targetRow) {
      targetRow = rec.rowNumber && rec.rowNumber >= 2 ? rec.rowNumber : rec.indexNumber + 1;
    }

    const statusLetter = colIndexToLetter(cachedStatusColIdx);
    const range = formatA1Range(sheetTitle, `${statusLetter}${targetRow}`);
    updates.push({
      range,
      values: [[writtenStatus]],
    });
    results.push({ id: rec.id, rowNumber: targetRow });
  }

  // Use batchUpdate endpoint to send all row updates in a single round-trip HTTP call
  const batchRes = await fetchWithGoogleAuth(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: updates,
      }),
    },
    accessToken
  );

  if (!batchRes.ok) {
    const errText = await batchRes.text();
    checkResponseAuth(batchRes.status, errText);
    throw new Error(`Error al actualizar estado en Google Sheets (batch): ${errText}`);
  }

  return results;
}

/**
 * Update the approval status of a single record in Google Sheets.
 * If rowNumber is provided it updates directly.
 * If rowNumber is missing or out of sync, it looks up the record by ID (Col I) or DNI/Index.
 */
export async function updateRecordApprovalInSheet(
  accessToken: string,
  spreadsheetId: string,
  recordOrRowNumber: number | { id?: string; rowNumber?: number; dni?: string; indexNumber?: number; fullName?: string },
  newStatus: 'APROBADO' | 'RECHAZADO' | 'PENDIENTE'
): Promise<number> {
  const sheetTitle = await getOrResolveSheetTitle(accessToken, spreadsheetId);
  let targetRow: number | null = null;

  if (typeof recordOrRowNumber === 'number') {
    targetRow = recordOrRowNumber;
  } else if (typeof recordOrRowNumber === 'object') {
    // Search the Google Sheet dynamically to pinpoint the exact row for this record
    try {
      const searchRangeUrl = encodeA1Range(sheetTitle, 'A:Z');
      const searchRes = await fetchWithGoogleAuth(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${searchRangeUrl}?valueRenderOption=UNFORMATTED_VALUE`,
        {},
        accessToken
      );
      if (searchRes.status === 401) {
        checkResponseAuth(401);
      }
      if (searchRes.ok) {
        const data = await searchRes.json();
        const allRows: any[][] = data.values || [];

        let startIdx = 0;
        if (allRows.length > 0) {
          const firstRowStr = (allRows[0] || []).join(' ').toUpperCase();
          if (
            firstRowStr.includes('NOMBRE') ||
            firstRowStr.includes('DNI') ||
            firstRowStr.includes('N°') ||
            firstRowStr.includes('TRANSF') ||
            firstRowStr.includes('ESTADO')
          ) {
            updateDynamicColumnIndices(allRows[0]);
            startIdx = 1;
          }
        }

        // Check if recordOrRowNumber.rowNumber directly matches at its expected position
        if (
          recordOrRowNumber.rowNumber &&
          recordOrRowNumber.rowNumber >= 2 &&
          allRows.length >= recordOrRowNumber.rowNumber
        ) {
          const rowAtExpected = allRows[recordOrRowNumber.rowNumber - 1];
          const rId = String(rowAtExpected[cachedIdColIdx] || rowAtExpected[8] || '').trim();
          const rIdx = Number(rowAtExpected[cachedIndexColIdx] || rowAtExpected[0]);
          const rDni = String(rowAtExpected[cachedDniColIdx] || rowAtExpected[2] || '').trim();

          if (
            (recordOrRowNumber.id && rId === recordOrRowNumber.id.trim()) ||
            (recordOrRowNumber.indexNumber && rIdx === recordOrRowNumber.indexNumber) ||
            (recordOrRowNumber.dni && rDni === recordOrRowNumber.dni.trim())
          ) {
            targetRow = recordOrRowNumber.rowNumber;
          }
        }

        // Pass 1: Match by unique Record ID
        if (!targetRow && recordOrRowNumber.id) {
          const targetId = recordOrRowNumber.id.trim();
          for (let i = startIdx; i < allRows.length; i++) {
            const rowId = String(allRows[i][cachedIdColIdx] || allRows[i][8] || '').trim();
            if (rowId && rowId === targetId) {
              targetRow = i + 1;
              break;
            }
          }
        }

        // Pass 2: Match by exact DNI and Index together
        if (!targetRow && recordOrRowNumber.dni && recordOrRowNumber.indexNumber) {
          const targetDni = recordOrRowNumber.dni.trim();
          for (let i = startIdx; i < allRows.length; i++) {
            const rowDni = String(allRows[i][cachedDniColIdx] || allRows[i][2] || '').trim();
            const rowIdx = Number(allRows[i][cachedIndexColIdx] || allRows[i][0]);
            if (rowDni === targetDni && rowIdx === recordOrRowNumber.indexNumber) {
              targetRow = i + 1;
              break;
            }
          }
        }

        // Pass 3: Match by DNI
        if (!targetRow && recordOrRowNumber.dni) {
          const targetDni = recordOrRowNumber.dni.trim();
          for (let i = startIdx; i < allRows.length; i++) {
            const rowDni = String(allRows[i][cachedDniColIdx] || allRows[i][2] || '').trim();
            if (rowDni && rowDni === targetDni) {
              targetRow = i + 1;
              break;
            }
          }
        }

        // Pass 4: Match by Index Number (#1, #2, etc.)
        if (!targetRow && recordOrRowNumber.indexNumber) {
          for (let i = startIdx; i < allRows.length; i++) {
            const rowIdx = Number(allRows[i][cachedIndexColIdx] || allRows[i][0]);
            if (rowIdx === recordOrRowNumber.indexNumber) {
              targetRow = i + 1;
              break;
            }
          }
        }
      }
    } catch (e: any) {
      if (e?.name === 'AuthExpiredError' || e?.isAuthExpired) throw e;
      console.warn('Could not locate row dynamically:', e);
    }

    // Fallback if not found dynamically in sheet
    if (!targetRow) {
      if (recordOrRowNumber.rowNumber && recordOrRowNumber.rowNumber >= 2) {
        targetRow = recordOrRowNumber.rowNumber;
      } else if (recordOrRowNumber.indexNumber) {
        targetRow = recordOrRowNumber.indexNumber + 1;
      } else {
        throw new Error('No se pudo determinar la fila correspondiente en Google Sheets.');
      }
    }
  }

  if (!targetRow) {
    throw new Error('No se pudo determinar la fila correspondiente en Google Sheets.');
  }

  // Dynamic status column (e.g. Column F or detected)
  const statusLetter = colIndexToLetter(cachedStatusColIdx);
  const writtenStatus =
    newStatus === 'APROBADO'
      ? sheetPrefersFeminine
        ? 'APROBADA'
        : 'APROBADO'
      : newStatus === 'RECHAZADO'
      ? sheetPrefersFeminine
        ? 'RECHAZADA'
        : 'RECHAZADO'
      : 'PENDIENTE';

  const rangeUrl = encodeA1Range(sheetTitle, `${statusLetter}${targetRow}`);
  const res = await fetchWithGoogleAuth(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${rangeUrl}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [[writtenStatus]],
      }),
    },
    accessToken
  );

  if (!res.ok) {
    const err = await res.text();
    checkResponseAuth(res.status, err);
    throw new Error(`Error al actualizar estado en Google Sheet: ${err}`);
  }

  return targetRow;
}
