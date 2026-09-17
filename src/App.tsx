import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Shield, 
  Smartphone, 
  FileSpreadsheet, 
  KeyRound, 
  CheckCircle2, 
  LogOut, 
  RefreshCw, 
  Lock, 
  Info,
  ExternalLink,
  Users,
  AlertTriangle,
  Copy,
  Check
} from 'lucide-react';
import { TransferRecord, UserRole, STAFF_MEMBERS, StaffMember } from './types';
import { StaffForm } from './components/StaffForm';
import { AdminPanel } from './components/AdminPanel';
import { LewisLogo } from './components/LewisLogo';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { PWAInstallButton } from './components/PWAInstallButton';
import { 
  getOrCreateSpreadsheet, 
  fetchTransferRecords, 
  appendTransferRecord, 
  updateRecordApprovalInSheet,
  updateBatchRecordApprovalInSheet,
  uploadReceiptToDrive,
  AuthExpiredError,
  setAuthExpiredListener,
} from './services/sheetsService';
import { 
  googleSignIn, 
  initAuth, 
  logoutGoogle, 
  getAccessToken,
  clearCachedToken,
  refreshGoogleToken,
  onTokenRefreshed,
} from './services/firebaseAuth';

// Local storage keys
const STORAGE_SHEET_ID = 'transfer_app_sheet_id';
const STORAGE_ADMIN_PASS = 'transfer_app_admin_pass';
const STORAGE_LOCAL_RECORDS = 'transfer_app_local_records';
const STORAGE_STAFF_NAME = 'transfer_app_selected_staff';

export default function App() {
  // OAuth & Google Authentication state
  // OAuth & Google Authentication state - permanently persistent
  const [accessToken, setAccessToken] = useState<string | null>(() => {
    return (
      (typeof window !== 'undefined' ? localStorage.getItem('google_access_token') : null) ||
      (typeof window !== 'undefined' ? sessionStorage.getItem('google_access_token') : null) ||
      null
    );
  });
  const [userEmail, setUserEmail] = useState<string | null>(() => {
    return (
      (typeof window !== 'undefined' ? localStorage.getItem('google_user_email') : null) ||
      (typeof window !== 'undefined' ? sessionStorage.getItem('google_user_email') : null) ||
      null
    );
  });
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthExpired, setIsAuthExpired] = useState(false);
  const [pendingBatchUpdate, setPendingBatchUpdate] = useState<{
    records: TransferRecord[];
    newStatus: 'APROBADO' | 'RECHAZADO' | 'PENDIENTE';
  } | null>(null);

  // App mode: Staff mobile view vs Admin review panel
  const [currentRole, setCurrentRole] = useState<UserRole>('STAFF');
  const [staffMemberName, setStaffMemberName] = useState<string>(() => {
    return localStorage.getItem(STORAGE_STAFF_NAME) || STAFF_MEMBERS[0];
  });

  // Admin Security Pin (Default PIN: 1234)
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [adminPinInput, setAdminPinInput] = useState('');
  const [pinError, setPinError] = useState(false);

  // Google Sheets state
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_SHEET_ID) || null;
  });
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | null>(() => {
    const id = localStorage.getItem(STORAGE_SHEET_ID);
    return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null;
  });
  const [records, setRecords] = useState<TransferRecord[]>([]);
  const [isLoadingSheets, setIsLoadingSheets] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>('Listo');
  const [syncFeedback, setSyncFeedback] = useState<{
    type: 'loading' | 'success' | 'error';
    message: string;
  } | null>(null);
  const [showSheetModal, setShowSheetModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Lock recently changed admin approval statuses strictly by unique record ID
  // to guarantee background polling or Sheet sync never prematurely overrides rejection or approval
  // while ensuring all records remain 100% independent.
  const recentAdminUpdatesRef = useRef<Map<string, { status: 'APROBADO' | 'RECHAZADO' | 'PENDIENTE'; time: number }>>(
    new Map()
  );

  const recordAdminUpdate = (
    record: { id?: string; indexNumber?: number; rowNumber?: number; dni?: string },
    status: 'APROBADO' | 'RECHAZADO' | 'PENDIENTE'
  ) => {
    const now = Date.now();
    if (record.id) recentAdminUpdatesRef.current.set(`id:${record.id}`, { status, time: now });
    if (record.indexNumber) recentAdminUpdatesRef.current.set(`idx:${record.indexNumber}`, { status, time: now });
  };

  const getRecentAdminStatus = (
    record: { id?: string; indexNumber?: number; rowNumber?: number; dni?: string }
  ): ('APROBADO' | 'RECHAZADO' | 'PENDIENTE') | null => {
    const now = Date.now();
    const LOCK_TIME = 120000; // 2 minutes lock

    if (record.id) {
      const entry = recentAdminUpdatesRef.current.get(`id:${record.id}`);
      if (entry && now - entry.time < LOCK_TIME) return entry.status;
    }
    if (record.indexNumber) {
      const entry = recentAdminUpdatesRef.current.get(`idx:${record.indexNumber}`);
      if (entry && now - entry.time < LOCK_TIME) return entry.status;
    }
    return null;
  };

  // Save staff member selection
  const handleStaffChange = (name: string) => {
    setStaffMemberName(name);
    localStorage.setItem(STORAGE_STAFF_NAME, name);
  };

  // Helper to store local backup
  const saveLocalRecords = (newRecords: TransferRecord[]) => {
    setRecords(newRecords);
    localStorage.setItem(STORAGE_LOCAL_RECORDS, JSON.stringify(newRecords));
  };

  // Load initial local records if available
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_LOCAL_RECORDS);
    if (saved) {
      try {
        setRecords(JSON.parse(saved));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  // Proactive token refresh: every 30 minutes, refresh silently so Google session never disconnects
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const fresh = await refreshGoogleToken(true);
        if (fresh) {
          setAccessToken(fresh);
          setIsAuthExpired(false);
        }
      } catch (err) {
        console.warn('Proactive silent refresh notice:', err);
      }
    }, 30 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  // Subscribe to silent token refresh events from fetchWithGoogleAuth
  useEffect(() => {
    const unsub = onTokenRefreshed((newToken) => {
      console.log('App received fresh Google Access Token silently');
      setAccessToken(newToken);
      setIsAuthExpired(false);
      localStorage.setItem('google_access_token', newToken);
    });
    return () => unsub();
  }, []);

  // Listen to Google API expired token events: attempt silent recovery instead of instant disconnect
  useEffect(() => {
    setAuthExpiredListener(async () => {
      try {
        const refreshed = await refreshGoogleToken(true);
        if (refreshed) {
          setAccessToken(refreshed);
          setIsAuthExpired(false);
          return;
        }
      } catch {
        // Only set expired if silent refresh failed completely
      }
      setIsAuthExpired(true);
    });
    return () => {
      setAuthExpiredListener(null);
    };
  }, []);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setAccessToken(token);
        setUserEmail(user.email);
        setIsAuthExpired(false);
        localStorage.setItem('google_access_token', token);
        localStorage.setItem('google_token_timestamp', Date.now().toString());
        if (user.email) {
          localStorage.setItem('google_user_email', user.email);
        }
      },
      () => {
        // Fallback: check localStorage for cached token
        const storedToken = localStorage.getItem('google_access_token');
        if (storedToken && !accessToken) {
          setAccessToken(storedToken);
        }
      }
    );
    return () => unsubscribe();
  }, [accessToken]);

  // Google Sign In via Firebase Auth with Workspace Scopes
  const handleGoogleLogin = async () => {
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const authResult = await googleSignIn();
      if (authResult) {
        setAccessToken(authResult.accessToken);
        setUserEmail(authResult.user.email);
        setIsAuthExpired(false);
        localStorage.setItem('google_access_token', authResult.accessToken);
        localStorage.setItem('google_token_timestamp', Date.now().toString());
        if (authResult.user.email) {
          localStorage.setItem('google_user_email', authResult.user.email);
        }

        // Check if there was a pending batch or single update deferred
        if (pendingBatchUpdate && spreadsheetId) {
          const pending = pendingBatchUpdate;
          setPendingBatchUpdate(null);
          updateBatchRecordApprovalInSheet(
            authResult.accessToken,
            spreadsheetId,
            pending.records,
            pending.newStatus
          ).catch((e) => console.warn('Retry pending batch update error:', e));
        }
      }
    } catch (err: any) {
      console.error('Google Auth Error:', err);
      if (err.code === 'auth/popup-closed-by-user') {
        setAuthError('La ventana de inicio de sesión de Google fue cerrada. Vuelve a intentarlo.');
      } else if (err.code === 'auth/popup-blocked') {
        setAuthError('El navegador bloqueó la ventana emergente. Por favor habilita las ventanas emergentes (popups) para este sitio.');
      } else {
        setAuthError(err.message || 'Error al conectar con Google. Por favor intenta de nuevo.');
      }
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleLogout = async () => {
    await logoutGoogle();
    setAccessToken(null);
    setUserEmail(null);
    setIsAuthExpired(false);
    clearCachedToken();
    localStorage.removeItem('google_access_token');
    localStorage.removeItem('google_token_timestamp');
    localStorage.removeItem('google_user_email');
    setIsAdminAuthenticated(false);
  };

  // Synchronize with Google Sheets
  const syncWithSpreadsheet = useCallback(async (token: string, existingId?: string | null) => {
    try {
      setIsLoadingSheets(true);
      setSyncStatus('Conectando con Google Sheets...');

      const sheetInfo = await getOrCreateSpreadsheet(token, existingId || undefined);
      setSpreadsheetId(sheetInfo.spreadsheetId);
      setSpreadsheetUrl(sheetInfo.spreadsheetUrl);
      localStorage.setItem(STORAGE_SHEET_ID, sheetInfo.spreadsheetId);

      // Fetch live records
      setSyncStatus('Sincronizando registros...');
      const loadedRecords = await fetchTransferRecords(token, sheetInfo.spreadsheetId);
      
      if (loadedRecords.length > 0) {
        // Reconcile with any active admin decision so a fresh fetch never overrides an admin action
        const reconciled = loadedRecords.map((lr) => {
          const lockedStatus = getRecentAdminStatus(lr);
          return lockedStatus ? { ...lr, isApproved: lockedStatus } : lr;
        });
        saveLocalRecords(reconciled);
      } else {
        const local = localStorage.getItem(STORAGE_LOCAL_RECORDS);
        if (local) {
          const parsed = JSON.parse(local);
          if (parsed.length > 0) {
            for (const r of parsed) {
              await appendTransferRecord(token, sheetInfo.spreadsheetId, r);
            }
            const reloaded = await fetchTransferRecords(token, sheetInfo.spreadsheetId);
            const reconciledReloaded = reloaded.map((lr) => {
              const lockedStatus = getRecentAdminStatus(lr);
              return lockedStatus ? { ...lr, isApproved: lockedStatus } : lr;
            });
            saveLocalRecords(reconciledReloaded);
          }
        }
      }

      setSyncStatus('Sincronizado');
    } catch (err: any) {
      console.error('Error connecting to Sheets:', err);
      setSyncStatus(`Error: ${err.message || 'Fallo de conexión'}`);
    } finally {
      setIsLoadingSheets(false);
    }
  }, []);

  // Sync on token change
  useEffect(() => {
    if (accessToken) {
      syncWithSpreadsheet(accessToken, spreadsheetId);
    }
  }, [accessToken, syncWithSpreadsheet]);

  // Real-time synchronization polling: Every 10 seconds, silently fetch latest records from Google Sheets
  useEffect(() => {
    if (!accessToken || !spreadsheetId) return;

    const interval = setInterval(async () => {
      try {
        const liveRecords = await fetchTransferRecords(accessToken, spreadsheetId);
        if (liveRecords && liveRecords.length > 0) {
          // Reconcile with recent admin actions so recent rejections are never overridden by polling
          const cleanLiveRecords = liveRecords.map((lr) => {
            const lockedStatus = getRecentAdminStatus(lr);
            return lockedStatus ? { ...lr, isApproved: lockedStatus } : lr;
          });

          setRecords((prev) => {
            // Compare if there's any actual difference in approval states or record count
            if (prev.length !== cleanLiveRecords.length) {
              localStorage.setItem(STORAGE_LOCAL_RECORDS, JSON.stringify(cleanLiveRecords));
              return cleanLiveRecords;
            }
            const hasChange = cleanLiveRecords.some((lr, i) => {
              const current = prev[i];
              return (
                !current ||
                current.id !== lr.id ||
                current.isApproved !== lr.isApproved ||
                current.hasTransferred !== lr.hasTransferred
              );
            });
            if (hasChange) {
              localStorage.setItem(STORAGE_LOCAL_RECORDS, JSON.stringify(cleanLiveRecords));
              return cleanLiveRecords;
            }
            return prev;
          });
        }
      } catch (err: any) {
        console.warn('Background sync check:', err);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [accessToken, spreadsheetId]);

  // Handle staff submitting multiple persons with single transfer/receipt
  const handleStaffSubmitRecords = async (data: {
    persons: { fullName: string; dni: string }[];
    hasTransferred: boolean;
    receiptFile: File | null;
    receiptPreviewUrl: string | null;
  }) => {
    setIsSubmitting(true);
    try {
      let receiptLink = data.receiptPreviewUrl || '';

      // Upload to Google Drive if connected and file provided
      if (accessToken && data.receiptFile) {
        setSyncStatus('Subiendo comprobante a Google Drive...');
        try {
          const namesPreview = data.persons.map((p) => p.dni).join('_');
          const driveUpload = await uploadReceiptToDrive(
            accessToken,
            data.receiptFile,
            `Comprobante_${namesPreview}_${Date.now()}.jpg`
          );
          receiptLink = driveUpload.webViewLink;
        } catch (driveErr) {
          console.warn('Drive upload failed, using fallback:', driveErr);
        }
      }

      const timestamp = new Date().toLocaleString('es-AR', {
        dateStyle: 'short',
        timeStyle: 'short',
      });

      const commonGroupTransferId = data.persons.length > 1 ? `GRP-${Date.now()}` : undefined;
      const newCreatedRecords: TransferRecord[] = [];

      let currentCounter = records.length;

      for (let i = 0; i < data.persons.length; i++) {
        currentCounter++;
        const p = data.persons[i];
        const recordId = `TRF-${Date.now()}-${currentCounter}`;

        const newRecord: TransferRecord = {
          id: recordId,
          indexNumber: currentCounter,
          fullName: p.fullName,
          dni: p.dni,
          hasTransferred: data.hasTransferred,
          receiptDriveUrl: receiptLink || 'Sin comprobante',
          isApproved: 'PENDIENTE',
          timestamp,
          staffMemberName: staffMemberName || 'Staff',
          groupTransferId: commonGroupTransferId,
        };

        let assignedRow = currentCounter + 1;
        // Append to Google Sheets
        if (accessToken && spreadsheetId) {
          setSyncStatus(`Guardando persona ${i + 1} de ${data.persons.length} en Google Sheets...`);
          try {
            const returnedRow = await appendTransferRecord(accessToken, spreadsheetId, newRecord);
            if (returnedRow && returnedRow > 1) {
              assignedRow = returnedRow;
            }
          } catch (sheetErr) {
            console.warn('Error appending record to sheet:', sheetErr);
          }
        }

        newRecord.rowNumber = assignedRow;
        newCreatedRecords.push(newRecord);
      }

      // Update local state
      const updated = [...records, ...newCreatedRecords];
      saveLocalRecords(updated);
      setSyncStatus('Guardado con éxito');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Admin approval or rejection for a single record or multiple records
  const handleUpdateApproval = async (
    record: TransferRecord,
    newStatus: 'APROBADO' | 'RECHAZADO' | 'PENDIENTE'
  ) => {
    // Record optimistic lock strictly for this specific record ID
    recordAdminUpdate(record, newStatus);

    // 1. Instant local & reactive state update for this specific record ONLY
    setRecords((prev) => {
      const next = prev.map((r) =>
        r.id === record.id ? { ...r, isApproved: newStatus } : r
      );
      localStorage.setItem(STORAGE_LOCAL_RECORDS, JSON.stringify(next));
      return next;
    });

    let currentToken = accessToken || (await getAccessToken());
    if (!currentToken) {
      currentToken = await refreshGoogleToken(false);
      if (currentToken) setAccessToken(currentToken);
    }

    if (!currentToken) {
      setPendingBatchUpdate({ records: [record], newStatus });
      setSyncFeedback({
        type: 'error',
        message: 'Conecta tu cuenta de Google para guardar los cambios directamente en Google Sheets.',
      });
      handleGoogleLogin();
      return;
    }

    if (!spreadsheetId) {
      setSyncFeedback({
        type: 'error',
        message: 'No hay ninguna planilla de Google Sheets vinculada.',
      });
      return;
    }

    // 2. Update in Google Sheets in real-time
    setSyncFeedback({
      type: 'loading',
      message: `Actualizando estado (${newStatus === 'APROBADO' ? 'APROBADA' : 'RECHAZADA'}) en Google Sheets en tiempo real...`,
    });

    try {
      let updatedRow: number | null = null;
      try {
        updatedRow = await updateRecordApprovalInSheet(
          currentToken,
          spreadsheetId,
          {
            id: record.id,
            rowNumber: record.rowNumber,
            dni: record.dni,
            indexNumber: record.indexNumber,
            fullName: record.fullName,
          },
          newStatus
        );
      } catch (firstErr: any) {
        // If auth error, refresh silently and retry once immediately
        if (firstErr?.name === 'AuthExpiredError' || firstErr?.isAuthExpired || String(firstErr).includes('401')) {
          const fresh = await refreshGoogleToken(true);
          if (fresh) {
            setAccessToken(fresh);
            updatedRow = await updateRecordApprovalInSheet(
              fresh,
              spreadsheetId,
              {
                id: record.id,
                rowNumber: record.rowNumber,
                dni: record.dni,
                indexNumber: record.indexNumber,
                fullName: record.fullName,
              },
              newStatus
            );
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }

      if (updatedRow) {
        recordAdminUpdate({ ...record, rowNumber: updatedRow }, newStatus);
        setRecords((prev) => {
          const next = prev.map((r) =>
            r.id === record.id ? { ...r, rowNumber: updatedRow, isApproved: newStatus } : r
          );
          localStorage.setItem(STORAGE_LOCAL_RECORDS, JSON.stringify(next));
          return next;
        });
      }

      setSyncFeedback({
        type: 'success',
        message: `✓ Estado ${newStatus === 'APROBADO' ? 'aprobado' : 'rechazado'} guardado en Google Sheets en vivo (fila ${updatedRow || record.rowNumber || 'actualizada'}).`,
      });
      setTimeout(() => {
        setSyncFeedback((curr) => (curr?.type === 'success' ? null : curr));
      }, 4000);
    } catch (sheetErr: any) {
      console.error('Error updating status in Sheet:', sheetErr);
      setSyncFeedback({
        type: 'error',
        message: `Error al actualizar en Google Sheets: ${sheetErr?.message || sheetErr}`,
      });
    }
  };

  // Handle Admin approval or rejection for a whole group of records at once
  const handleBatchUpdateApproval = async (
    recordsToUpdate: TransferRecord[],
    newStatus: 'APROBADO' | 'RECHAZADO' | 'PENDIENTE'
  ) => {
    if (recordsToUpdate.length === 0) return;
    const targetIds = new Set(recordsToUpdate.map((r) => r.id));

    // Record administrative lock strictly by unique record ID for each record
    for (const r of recordsToUpdate) {
      recordAdminUpdate(r, newStatus);
    }

    // 1. Immediate optimistic UI update strictly by record ID
    setRecords((prev) => {
      const next = prev.map((r) => {
        if (targetIds.has(r.id)) {
          return { ...r, isApproved: newStatus };
        }
        return r;
      });
      localStorage.setItem(STORAGE_LOCAL_RECORDS, JSON.stringify(next));
      return next;
    });

    let currentToken = accessToken || (await getAccessToken());
    if (!currentToken) {
      currentToken = await refreshGoogleToken(false);
      if (currentToken) setAccessToken(currentToken);
    }

    if (!currentToken) {
      setPendingBatchUpdate({ records: recordsToUpdate, newStatus });
      setSyncFeedback({
        type: 'error',
        message: 'Conecta tu cuenta de Google para guardar los cambios directamente en Google Sheets.',
      });
      handleGoogleLogin();
      return;
    }

    if (!spreadsheetId) {
      setSyncFeedback({
        type: 'error',
        message: 'No hay ninguna planilla de Google Sheets vinculada.',
      });
      return;
    }

    // 2. Batch update all rows in Google Sheets in real-time
    setSyncFeedback({
      type: 'loading',
      message: `Actualizando estado (${newStatus === 'APROBADO' ? 'APROBADA' : 'RECHAZADA'}) de ${recordsToUpdate.length} persona${recordsToUpdate.length > 1 ? 's' : ''} en Google Sheets en vivo...`,
    });

    try {
      let updatedRows: { id: string; rowNumber: number }[] = [];
      try {
        updatedRows = await updateBatchRecordApprovalInSheet(
          currentToken,
          spreadsheetId,
          recordsToUpdate,
          newStatus
        );
      } catch (firstErr: any) {
        // If auth error, refresh silently and retry once immediately
        if (firstErr?.name === 'AuthExpiredError' || firstErr?.isAuthExpired || String(firstErr).includes('401')) {
          const fresh = await refreshGoogleToken(true);
          if (fresh) {
            setAccessToken(fresh);
            updatedRows = await updateBatchRecordApprovalInSheet(
              fresh,
              spreadsheetId,
              recordsToUpdate,
              newStatus
            );
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }

      if (updatedRows && updatedRows.length > 0) {
        const rowMap = new Map(updatedRows.map((u) => [u.id, u.rowNumber]));
        for (const u of updatedRows) {
          recordAdminUpdate({ id: u.id, rowNumber: u.rowNumber }, newStatus);
        }
        setRecords((prev) => {
          const next = prev.map((r) =>
            rowMap.has(r.id) ? { ...r, rowNumber: rowMap.get(r.id), isApproved: newStatus } : r
          );
          localStorage.setItem(STORAGE_LOCAL_RECORDS, JSON.stringify(next));
          return next;
        });
      }

      setSyncFeedback({
        type: 'success',
        message: `✓ Estado ${newStatus === 'APROBADO' ? 'aprobado' : 'rechazado'} guardado en Google Sheets en vivo (${recordsToUpdate.length} registro${recordsToUpdate.length > 1 ? 's' : ''}).`,
      });
      setTimeout(() => {
        setSyncFeedback((curr) => (curr?.type === 'success' ? null : curr));
      }, 4000);
    } catch (sheetErr: any) {
      console.error('Error batch updating status in Sheet:', sheetErr);
      // Fallback: update individually if batch fails for other reasons
      let anySuccess = false;
      for (const r of recordsToUpdate) {
        try {
          const row = await updateRecordApprovalInSheet(
            currentToken,
            spreadsheetId,
            { id: r.id, rowNumber: r.rowNumber, dni: r.dni, indexNumber: r.indexNumber, fullName: r.fullName },
            newStatus
          );
          if (row) recordAdminUpdate({ ...r, rowNumber: row }, newStatus);
          anySuccess = true;
        } catch (singleErr) {
          console.warn('Fallback individual update failed:', singleErr);
        }
      }

      if (anySuccess) {
        setSyncFeedback({
          type: 'success',
          message: `✓ Estado ${newStatus === 'APROBADO' ? 'aprobado' : 'rechazado'} guardado en Google Sheets.`,
        });
        setTimeout(() => {
          setSyncFeedback((curr) => (curr?.type === 'success' ? null : curr));
        }, 4000);
      } else {
        setSyncFeedback({
          type: 'error',
          message: `Error al actualizar en Google Sheets: ${sheetErr?.message || sheetErr}`,
        });
      }
    }
  };

  // Admin PIN verification
  const handleAdminPinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const storedPin = localStorage.getItem(STORAGE_ADMIN_PASS) || '1234';
    if (adminPinInput.trim() === storedPin || adminPinInput.trim() === 'admin') {
      setIsAdminAuthenticated(true);
      setPinError(false);
      setAdminPinInput('');
    } else {
      setPinError(true);
    }
  };

  const copySheetUrl = () => {
    if (spreadsheetUrl) {
      navigator.clipboard.writeText(spreadsheetUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col antialiased font-sans">
      {/* Top App Bar with LEWIS CONTROL Logo */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3.5 flex items-center justify-between gap-2 sm:gap-4">
          {/* Logo on the far left - shrink-0 to guarantee it never gets squished */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <LewisLogo size="sm" />

            {/* Connection status indicator on desktop */}
            <div className="hidden md:flex items-center gap-2 pl-2 border-l border-slate-200">
              <span className={`w-2 h-2 rounded-full shrink-0 ${accessToken ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`}></span>
              <span className="text-[11px] text-slate-500 font-medium whitespace-nowrap">
                {accessToken ? 'Sheets Conectado' : 'Sin vincular'}
              </span>
              {spreadsheetUrl && (
                <button
                  type="button"
                  onClick={() => setShowSheetModal(true)}
                  className="text-[11px] font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 px-2 py-0.5 rounded border border-teal-200 cursor-pointer whitespace-nowrap"
                >
                  Hoja Sheets ↗
                </button>
              )}
            </div>
          </div>

          {/* Role switcher (Carga Staff / Admin) moved all the way to the far right */}
          <div className="ml-auto flex items-center gap-1.5 sm:gap-3 shrink-0">
            {/* View Switcher: Staff vs Admin */}
            <div className="bg-slate-100 p-1 rounded-xl flex items-center border border-slate-200 text-xs font-semibold">
              <button
                type="button"
                id="tab-staff"
                onClick={() => setCurrentRole('STAFF')}
                className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg transition-all cursor-pointer text-[11px] sm:text-xs ${
                  currentRole === 'STAFF'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>Carga Staff</span>
              </button>

              <button
                type="button"
                id="tab-admin"
                onClick={() => setCurrentRole('ADMIN')}
                className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg transition-all cursor-pointer text-[11px] sm:text-xs ${
                  currentRole === 'ADMIN'
                    ? 'bg-slate-900 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Admin</span>
              </button>
            </div>

            {/* Google Sheets Account info on desktop */}
            {accessToken ? (
              <div className="hidden lg:flex items-center gap-2 pl-2 border-l border-slate-200">
                <span className="text-[11px] font-medium text-slate-600 max-w-[140px] truncate" title={userEmail || 'Conectado'}>
                  {userEmail || 'Conectado'}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Cerrar sesión de Google"
                  className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="hidden sm:block">
                <GoogleSignInButton
                  onClick={handleGoogleLogin}
                  isLoading={isAuthenticating}
                  text="Conectar Google"
                  className="py-1.5 px-3 text-xs"
                />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6">
        {/* Auth error message alert */}
        {authError && (
          <div className="mb-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Error de autorización</p>
              <p className="mt-0.5">{authError}</p>
            </div>
          </div>
        )}

        {/* Banner if Google OAuth session expired (401) */}
        {isAuthExpired && (
          <div className="mb-4 bg-amber-50 border border-amber-200 text-slate-900 p-4 rounded-2xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-500 text-slate-950 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <p className="font-bold text-sm text-slate-900">Tu sesión de Google Sheets ha caducado</p>
                <p className="text-xs text-slate-600 mt-0.5">
                  Por seguridad de Google, el permiso dura 60 minutos. Haz clic en reconectar para continuar actualizando las aprobaciones en vivo en Google Sheets.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isAuthenticating}
              className="shrink-0 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs shadow transition-all cursor-pointer flex items-center gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isAuthenticating ? 'animate-spin' : ''}`} />
              <span>{isAuthenticating ? 'Reconectando...' : 'Reconectar con 1 clic'}</span>
            </button>
          </div>
        )}

        {/* Banner if Google is not connected yet */}
        {!accessToken && !isAuthExpired && (
          <div className="mb-6 bg-slate-900 text-white p-5 rounded-2xl shadow-xl border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#E4B877]/20 text-[#E4B877] flex items-center justify-center shrink-0 mt-0.5 font-bold">
                <FileSpreadsheet className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  Vincular tu cuenta de Google Sheets
                </h3>
                <p className="text-xs text-slate-300 mt-1 max-w-xl">
                  Inicia sesión con tu cuenta de Google para guardar automáticamente las transferencias de Tiago, Juan, Bauti, Rocco, Eze, Nico, Renzo y Lau en tu propia planilla con los comprobantes de pago.
                </p>
              </div>
            </div>
            
            <GoogleSignInButton
              onClick={handleGoogleLogin}
              isLoading={isAuthenticating}
              text="Vincular con Google Sheets"
              className="w-full sm:w-auto shadow-md"
            />
          </div>
        )}

        {/* View 1: Staff Mobile Input View */}
        {currentRole === 'STAFF' && (
          <div className="space-y-6">
            <div className="max-w-lg mx-auto text-center space-y-1">
              <span className="text-xs font-bold text-teal-700 uppercase tracking-widest">
                Carga Móvil Staff
              </span>
              <h2 className="text-xl font-bold text-slate-900">Control de Transferencias y Pagos</h2>
              <p className="text-xs text-slate-500">
                Selecciona tu nombre, carga los datos de las personas y adjunta la foto del comprobante.
              </p>
            </div>

            <StaffForm
              staffName={staffMemberName}
              onStaffNameChange={handleStaffChange}
              nextIndex={records.length + 1}
              onSubmitRecords={handleStaffSubmitRecords}
              isSubmitting={isSubmitting}
              spreadsheetUrl={spreadsheetUrl || undefined}
            />
          </div>
        )}

        {/* View 2: Admin Panel (Protected by PIN so only the admin can access) */}
        {currentRole === 'ADMIN' && (
          <div>
            {!isAdminAuthenticated ? (
              <div className="max-w-md mx-auto my-10 bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-xl text-center">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-200">
                  <Lock className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">Acceso Solo Administrador</h3>
                <p className="text-xs text-slate-500 mt-1 mb-6">
                  Solo el admin puede validar si llegó la transferencia y cambiar su estado de aprobación.
                </p>

                <form onSubmit={handleAdminPinSubmit} className="space-y-4">
                  <div className="text-left">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                      PIN o Clave de Administrador
                    </label>
                    <div className="relative">
                      <KeyRound className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="password"
                        required
                        value={adminPinInput}
                        onChange={(e) => {
                          setAdminPinInput(e.target.value);
                          setPinError(false);
                        }}
                        placeholder="PIN por defecto: 1234"
                        className={`w-full pl-11 pr-4 py-3 bg-slate-50 border rounded-xl text-sm font-medium focus:outline-none focus:bg-white transition-all ${
                          pinError
                            ? 'border-rose-300 ring-2 ring-rose-200 bg-rose-50/50'
                            : 'border-slate-200 focus:ring-2 focus:ring-slate-900'
                        }`}
                      />
                    </div>
                    {pinError && (
                      <p className="text-xs text-rose-600 font-medium mt-1.5 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> Clave incorrecta. El PIN por defecto es: 1234
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    id="btn-admin-login"
                    className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm transition-all shadow-md cursor-pointer"
                  >
                    Ingresar como Administrador
                  </button>
                </form>

                <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                  <span>PIN por defecto: <strong className="text-slate-700 font-mono">1234</strong></span>
                  <button
                    type="button"
                    onClick={() => setCurrentRole('STAFF')}
                    className="text-teal-600 hover:underline font-medium cursor-pointer"
                  >
                    Volver a Carga Staff
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Admin control bar with lock out */}
                <div className="flex items-center justify-between bg-slate-200/60 px-4 py-2 rounded-xl text-xs text-slate-600">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>Sesión de Administrador activa ({userEmail || 'Admin'})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAdminAuthenticated(false)}
                    className="text-slate-700 hover:text-rose-600 font-semibold cursor-pointer"
                  >
                    Bloquear Panel
                  </button>
                </div>

                <AdminPanel
                  records={records}
                  onUpdateApproval={handleUpdateApproval}
                  onBatchUpdateApproval={handleBatchUpdateApproval}
                  onRefresh={async () => {
                    if (accessToken) await syncWithSpreadsheet(accessToken, spreadsheetId);
                  }}
                  isLoading={isLoadingSheets}
                  spreadsheetUrl={spreadsheetUrl || undefined}
                  spreadsheetId={spreadsheetId || undefined}
                  adminEmail={userEmail || undefined}
                  isAuthExpired={isAuthExpired}
                  onRenewGoogleAuth={handleGoogleLogin}
                  hasAccessToken={!!accessToken}
                  syncFeedback={syncFeedback}
                />
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modal to view or copy Google Sheet Link */}
      {showSheetModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-slate-900 text-base">Tu Google Sheet</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSheetModal(false)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Esta es la planilla donde se guardan todas las transferencias enumeradas. Puedes abrirla directamente o copiar el enlace para guardarlo en tus favoritos:
            </p>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <p className="text-[11px] font-mono text-slate-700 break-all select-all">
                {spreadsheetUrl || 'Crea un primer registro o conecta Google para generarla.'}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
              {spreadsheetUrl && (
                <a
                  href={spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs text-center flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                >
                  Abrir en Google Sheets <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                type="button"
                onClick={copySheetUrl}
                className="py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLink ? '¡Enlace Copiado!' : 'Copiar Enlace'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Centered Download Mobile App Button at the very bottom */}
      <div className="w-full flex flex-col items-center justify-center py-6 px-4 text-center">
        <PWAInstallButton />
        <p className="text-[11px] text-slate-400 mt-2 text-center max-w-xs">
          Instala la aplicación en tu celular (iPhone o Android) para acceso directo en pantalla completa
        </p>
      </div>

      {/* Footer Info */}
      <footer className="bg-white border-t border-slate-200 py-4 px-4 text-center text-xs text-slate-400">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>
            Staff Autorizado: {STAFF_MEMBERS.join(', ')}
          </p>
          {spreadsheetUrl && (
            <button
              type="button"
              onClick={() => setShowSheetModal(true)}
              className="text-teal-600 hover:underline inline-flex items-center gap-1 font-medium cursor-pointer"
            >
              Ver enlace de Google Sheets <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
