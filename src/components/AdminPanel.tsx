import React, { useState } from 'react';
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  ExternalLink, 
  Eye, 
  FileCheck2, 
  Filter, 
  RefreshCw, 
  Search, 
  ShieldCheck, 
  FileSpreadsheet,
  AlertCircle,
  Copy,
  Check,
  Users,
  ChevronDown,
  ChevronUp,
  FileText
} from 'lucide-react';
import { TransferRecord } from '../types';

export interface GroupedTransfer {
  key: string;
  isGroup: boolean;
  groupTransferId?: string;
  leadRecord: TransferRecord;
  allRecords: TransferRecord[];
}

interface AdminPanelProps {
  records: TransferRecord[];
  onUpdateApproval: (record: TransferRecord, newStatus: 'APROBADO' | 'RECHAZADO' | 'PENDIENTE') => Promise<void>;
  onBatchUpdateApproval?: (records: TransferRecord[], newStatus: 'APROBADO' | 'RECHAZADO' | 'PENDIENTE') => Promise<void>;
  onRefresh: () => Promise<void>;
  isLoading: boolean;
  spreadsheetUrl?: string;
  spreadsheetId?: string;
  adminEmail?: string;
  isAuthExpired?: boolean;
  onRenewGoogleAuth?: () => void;
  hasAccessToken?: boolean;
  syncFeedback?: { type: 'loading' | 'success' | 'error'; message: string } | null;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  records,
  onUpdateApproval,
  onBatchUpdateApproval,
  onRefresh,
  isLoading,
  spreadsheetUrl,
  adminEmail,
  isAuthExpired = false,
  onRenewGoogleAuth,
  hasAccessToken = true,
  syncFeedback = null,
}) => {
  const [filter, setFilter] = useState<'ALL' | 'PENDIENTE' | 'APROBADO' | 'RECHAZADO'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReceipt, setSelectedReceipt] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [viewMode, setViewMode] = useState<'GROUPED' | 'INDIVIDUAL'>('GROUPED');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const toggleGroupExpand = (key: string) => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Group transfers:
  // 1. Records with explicit groupTransferId are grouped together.
  // 2. Records sharing the EXACT SAME valid receipt link/URL belong to the same payment transfer.
  // 3. Otherwise, they are single individual transfers.
  const groupedTransfers = React.useMemo(() => {
    const groupsMap = new Map<string, TransferRecord[]>();

    records.forEach((record) => {
      let groupKey: string;
      const cleanReceipt = (record.receiptDriveUrl || '').trim();
      const hasValidReceipt =
        cleanReceipt &&
        cleanReceipt.toLowerCase() !== 'sin comprobante' &&
        cleanReceipt !== '-' &&
        cleanReceipt.length > 5;

      if (record.groupTransferId && record.groupTransferId.trim()) {
        groupKey = `GRP_${record.groupTransferId.trim()}`;
      } else if (hasValidReceipt) {
        // Shared payment receipt means shared bank transfer
        groupKey = `RCP_${cleanReceipt}`;
      } else {
        groupKey = `SINGLE_${record.id || record.indexNumber}`;
      }

      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, []);
      }
      groupsMap.get(groupKey)!.push(record);
    });

    const result: GroupedTransfer[] = [];
    groupsMap.forEach((groupRecords, key) => {
      // Sort by indexNumber ascending so the first registered person is always leadRecord
      groupRecords.sort((a, b) => a.indexNumber - b.indexNumber);
      result.push({
        key,
        isGroup: groupRecords.length > 1,
        groupTransferId: groupRecords[0].groupTransferId,
        leadRecord: groupRecords[0],
        allRecords: groupRecords,
      });
    });

    // Sort by lead record's indexNumber descending (newest transfer first)
    return result.sort((a, b) => b.leadRecord.indexNumber - a.leadRecord.indexNumber);
  }, [records]);

  // Map each record id to its group for individual view
  const recordGroupMap = React.useMemo(() => {
    const map = new Map<string, GroupedTransfer>();
    groupedTransfers.forEach((g) => {
      g.allRecords.forEach((r) => {
        map.set(r.id, g);
      });
    });
    return map;
  }, [groupedTransfers]);

  // Filter grouped transfers according to status and search query
  const filteredGroups = React.useMemo(() => {
    return groupedTransfers.filter((group) => {
      if (filter !== 'ALL' && group.leadRecord.isApproved !== filter) {
        return false;
      }

      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        // Match against any person in the transfer group
        const matches = group.allRecords.some(
          (rec) =>
            rec.fullName.toLowerCase().includes(q) ||
            rec.dni.toLowerCase().includes(q) ||
            rec.staffMemberName.toLowerCase().includes(q) ||
            rec.indexNumber.toString().includes(q)
        );
        if (!matches) return false;
      }

      return true;
    });
  }, [groupedTransfers, filter, searchQuery]);

  // Filter individual records for detailed view
  const filteredIndividualRecords = React.useMemo(() => {
    const sorted = [...records].sort((a, b) => b.indexNumber - a.indexNumber);
    return sorted.filter((rec) => {
      if (filter !== 'ALL' && rec.isApproved !== filter) return false;
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        return (
          rec.fullName.toLowerCase().includes(q) ||
          rec.dni.toLowerCase().includes(q) ||
          rec.staffMemberName.toLowerCase().includes(q) ||
          rec.indexNumber.toString().includes(q)
        );
      }
      return true;
    });
  }, [records, filter, searchQuery]);

  const counts = {
    allPersons: records.length,
    allTransfers: groupedTransfers.length,
    multiPersonTransfers: groupedTransfers.filter((g) => g.isGroup).length,
    aprobados: groupedTransfers.filter((g) => g.leadRecord.isApproved === 'APROBADO').length,
    pendientes: groupedTransfers.filter((g) => g.leadRecord.isApproved === 'PENDIENTE').length,
    rechazados: groupedTransfers.filter((g) => g.leadRecord.isApproved === 'RECHAZADO').length,
  };

  // Handle status change strictly for this transfer group
  const handleGroupStatusChange = async (
    group: GroupedTransfer,
    status: 'APROBADO' | 'RECHAZADO' | 'PENDIENTE'
  ) => {
    if (!hasAccessToken) {
      if (onRenewGoogleAuth) onRenewGoogleAuth();
      return;
    }

    try {
      setProcessingId(group.key);
      if (onBatchUpdateApproval) {
        await onBatchUpdateApproval(group.allRecords, status);
      } else {
        for (const rec of group.allRecords) {
          await onUpdateApproval(rec, status);
        }
      }
    } catch (err) {
      console.error('Error updating group status:', err);
    } finally {
      setProcessingId(null);
    }
  };

  const handleCopyLink = () => {
    if (spreadsheetUrl) {
      navigator.clipboard.writeText(spreadsheetUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* Live Real-Time Google Sheets Sync Feedback Banner */}
      {syncFeedback && (
        <div
          className={`rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm border transition-all ${
            syncFeedback.type === 'loading'
              ? 'bg-sky-50 border-sky-200 text-sky-950'
              : syncFeedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
              : 'bg-rose-50 border-rose-200 text-rose-950'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-xl shrink-0 ${
                syncFeedback.type === 'loading'
                  ? 'bg-sky-600 text-white'
                  : syncFeedback.type === 'success'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-rose-600 text-white'
              }`}
            >
              {syncFeedback.type === 'loading' ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : syncFeedback.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : (
                <AlertCircle className="w-5 h-5" />
              )}
            </div>
            <div>
              <p className="text-xs sm:text-sm font-semibold">{syncFeedback.message}</p>
            </div>
          </div>
          {syncFeedback.type === 'error' && onRenewGoogleAuth && (
            <button
              type="button"
              onClick={onRenewGoogleAuth}
              className="shrink-0 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold text-xs transition-all shadow cursor-pointer flex items-center justify-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reconectar Google</span>
            </button>
          )}
        </div>
      )}

      {/* Session Expired / Token Warning */}
      {(isAuthExpired || !hasAccessToken) && !syncFeedback && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500 text-slate-950 shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900">
                {isAuthExpired ? 'Sesión de Google Sheets expirada' : 'Cuenta de Google no vinculada'}
              </h4>
              <p className="text-xs text-slate-600 mt-0.5">
                Por seguridad de Google las credenciales caducan tras 1 hora. Conéctate nuevamente para que las aprobaciones se escriban en Google Sheets en vivo.
              </p>
            </div>
          </div>
          {onRenewGoogleAuth && (
            <button
              type="button"
              onClick={onRenewGoogleAuth}
              className="shrink-0 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold text-xs transition-all shadow cursor-pointer flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reconectar Google</span>
            </button>
          )}
        </div>
      )}

      {/* Admin Header & Google Sheet quick launch */}
      <div className="bg-slate-900 rounded-2xl p-5 sm:p-6 text-white border border-slate-800 shadow-xl flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="bg-amber-500/20 text-amber-400 text-xs font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              Panel de Administrador Exclusivo
            </span>
            <span className="bg-emerald-500/20 text-emerald-300 text-[11px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
              Sincronización en vivo activa
            </span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Validación de Transferencias</h2>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">
            Revisión de comprobantes y validación unificada: aceptar o rechazar aplica a todas las personas del comprobante.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {spreadsheetUrl ? (
            <div className="flex items-center gap-2">
              <a
                id="link-open-spreadsheet"
                href={spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold transition-all shadow-md shadow-emerald-600/20 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Abrir Google Sheets</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <button
                type="button"
                onClick={handleCopyLink}
                title="Copiar enlace directo de Google Sheets"
                className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5"
              >
                {copiedUrl ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                <span className="hidden sm:inline">{copiedUrl ? 'Copiado' : 'Copiar enlace'}</span>
              </button>
            </div>
          ) : (
            <div className="text-xs bg-slate-800 text-slate-300 px-3 py-2 rounded-xl border border-slate-700">
              Vincular cuenta arriba para crear o abrir la hoja
            </div>
          )}

          <button
            type="button"
            id="btn-refresh-sheets"
            onClick={onRefresh}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs sm:text-sm font-medium border border-slate-700 transition-all cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-teal-400' : ''}`} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>
        </div>
      </div>

      {/* Spreadsheet URL info banner */}
      {spreadsheetUrl && (
        <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-emerald-300">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-medium">
              Hoja de cálculo en vivo: <strong className="text-white font-mono">{spreadsheetUrl}</strong>
            </span>
          </div>
          <a
            href={spreadsheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-400 font-bold hover:underline inline-flex items-center gap-1 shrink-0"
          >
            Abrir en pestaña nueva <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 block uppercase">Transferencias</span>
          <div className="text-2xl font-bold text-slate-900 mt-1">{counts.allTransfers}</div>
          <span className="text-[11px] text-slate-400 mt-0.5 block">{counts.allPersons} personas registradas</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-amber-200 bg-amber-50/20 shadow-sm">
          <span className="text-xs font-semibold text-amber-700 block uppercase">Pendientes</span>
          <div className="text-2xl font-bold text-amber-800 mt-1">{counts.pendientes}</div>
          <span className="text-[11px] text-amber-600/80 mt-0.5 block">Por revisar comprobante</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-emerald-200 bg-emerald-50/20 shadow-sm">
          <span className="text-xs font-semibold text-emerald-700 block uppercase">Aprobadas</span>
          <div className="text-2xl font-bold text-emerald-800 mt-1">{counts.aprobados}</div>
          <span className="text-[11px] text-emerald-600/80 mt-0.5 block">Fondos acreditados</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-rose-200 bg-rose-50/20 shadow-sm">
          <span className="text-xs font-semibold text-rose-700 block uppercase">Rechazadas</span>
          <div className="text-2xl font-bold text-rose-800 mt-1">{counts.rechazados}</div>
          <span className="text-[11px] text-rose-600/80 mt-0.5 block">Sin acreditar / inválidas</span>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nombre, DNI o staff..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 text-slate-900"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <span className="text-xs text-slate-400 mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" />
            Estado:
          </span>
          {(['ALL', 'PENDIENTE', 'APROBADO', 'RECHAZADO'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                filter === st
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st === 'ALL' ? 'Todos' : st}
            </button>
          ))}
        </div>
      </div>

      {/* Main Transfer List View */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              {viewMode === 'GROUPED' ? 'Transferencias para Validación' : 'Registros Individuales (Filas Sheet)'}
            </h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-bold">
              {viewMode === 'GROUPED' ? filteredGroups.length : filteredIndividualRecords.length}
            </span>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center bg-slate-200/70 p-1 rounded-xl border border-slate-200 text-xs font-semibold self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setViewMode('GROUPED')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'GROUPED'
                  ? 'bg-white text-teal-800 font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5 text-teal-600" />
              <span>Vista Agrupada (Comprobantes)</span>
              <span className="text-[11px] px-1.5 py-0.2 rounded-md bg-teal-50 text-teal-700 font-bold">
                {filteredGroups.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('INDIVIDUAL')}
              className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                viewMode === 'INDIVIDUAL'
                  ? 'bg-white text-slate-900 font-bold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-slate-600" />
              <span>Vista Desglosada (Por Persona)</span>
              <span className="text-[11px] px-1.5 py-0.2 rounded-md bg-slate-100 text-slate-700 font-bold">
                {filteredIndividualRecords.length}
              </span>
            </button>
          </div>
        </div>

        {viewMode === 'GROUPED' ? (
          filteredGroups.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-3">
                <FileCheck2 className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-slate-700">No hay transferencias para mostrar</p>
              <p className="text-xs text-slate-400 mt-1">
                Las transferencias cargadas por el Staff aparecerán aquí.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredGroups.map((group) => {
                const lead = group.leadRecord;
                const isWorking = processingId === group.key;
                const otherRecords = group.allRecords.slice(1);

                return (
                  <div
                    key={group.key}
                    className={`p-4 sm:p-5 transition-colors hover:bg-slate-50/70 flex flex-col gap-3 ${
                      lead.isApproved === 'APROBADO'
                        ? 'border-l-4 border-l-emerald-500'
                        : lead.isApproved === 'RECHAZADO'
                        ? 'border-l-4 border-l-rose-500'
                        : 'border-l-4 border-l-amber-400'
                    }`}
                  >
                    {/* Multi-Person Transfer Banner */}
                    {group.isGroup && (
                      <div className="flex flex-wrap items-center justify-between px-3 py-1.5 bg-indigo-50/90 border border-indigo-200 text-indigo-900 rounded-lg text-xs font-bold gap-2">
                        <div className="flex items-center gap-1.5">
                          <Users className="w-4 h-4 text-indigo-600 shrink-0" />
                          <span>TRANSFERENCIA CONJUNTA • 1 SOLO COMPROBANTE ({group.allRecords.length} PERSONAS)</span>
                        </div>
                        <span className="text-[11px] text-indigo-700 font-normal">
                          Se aprueban/rechazan simultáneamente en Google Sheets
                        </span>
                      </div>
                    )}

                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      {/* Primary Registered Person Data */}
                      <div className="flex items-start gap-3.5">
                        {/* Enumerated Number #N */}
                        <div className="w-10 h-10 rounded-xl bg-slate-900 text-teal-400 font-mono font-bold flex items-center justify-center text-sm shrink-0 shadow-sm">
                          #{lead.indexNumber}
                        </div>

                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-base font-bold text-slate-900">{lead.fullName}</h4>
                            {group.isGroup && (
                              <span className="text-[11px] px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded-md font-bold">
                                Titular
                              </span>
                            )}
                            <span className="font-mono text-xs px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md border border-slate-200 font-bold">
                              DNI: {lead.dni}
                            </span>
                            <span className="text-[11px] px-2 py-0.5 bg-teal-50 text-teal-700 rounded-md border border-teal-200 font-medium">
                              Staff: {lead.staffMemberName}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                            <span className="flex items-center gap-1 font-medium">
                              {lead.hasTransferred ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                  Transfirió: SÍ
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                                  <XCircle className="w-3.5 h-3.5 text-rose-600" />
                                  Transfirió: NO
                                </span>
                              )}
                            </span>

                            {lead.timestamp && <span>Fecha: {lead.timestamp}</span>}
                          </div>
                        </div>
                      </div>

                      {/* Actions: View Receipt & Approve/Reject buttons */}
                      <div className="flex flex-wrap items-center gap-2.5 self-end lg:self-center">
                        {/* View Receipt Button */}
                        {lead.receiptDriveUrl && lead.receiptDriveUrl !== 'Sin comprobante' ? (
                          <button
                            type="button"
                            onClick={() => setSelectedReceipt(lead.receiptDriveUrl)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                            title={group.isGroup ? "Ver Comprobante Único de esta transferencia conjunta" : "Ver Comprobante de Pago"}
                          >
                            <Eye className="w-3.5 h-3.5 text-slate-600" />
                            <span>{group.isGroup ? 'Ver Comprobante Único' : 'Ver Comprobante'}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400 italic px-2">Sin comprobante</span>
                        )}

                        {/* Status Badge */}
                        <div className="mr-1">
                          {lead.isApproved === 'APROBADO' && (
                            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              APROBADA
                            </span>
                          )}
                          {lead.isApproved === 'RECHAZADO' && (
                            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
                              <XCircle className="w-4 h-4 text-rose-600" />
                              NO APROBADA
                            </span>
                          )}
                          {lead.isApproved === 'PENDIENTE' && (
                            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                              <Clock className="w-4 h-4 text-amber-600" />
                              PENDIENTE
                            </span>
                          )}
                        </div>

                        {/* Admin Decision Actions */}
                        <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200">
                          <button
                            type="button"
                            id={`btn-approve-group-${group.key}`}
                            disabled={isWorking || lead.isApproved === 'APROBADO'}
                            onClick={() => handleGroupStatusChange(group, 'APROBADO')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                              lead.isApproved === 'APROBADO'
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200'
                            } disabled:opacity-50`}
                            title={
                              group.isGroup
                                ? `Aprobar esta transferencia (${group.allRecords.length} personas en este comprobante)`
                                : `Aprobar transferencia de ${lead.fullName}`
                            }
                          >
                            {isWorking ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            )}
                            <span>{group.isGroup ? `Aprobar (${group.allRecords.length})` : 'Aprobar'}</span>
                          </button>

                          <button
                            type="button"
                            id={`btn-reject-group-${group.key}`}
                            disabled={isWorking || lead.isApproved === 'RECHAZADO'}
                            onClick={() => handleGroupStatusChange(group, 'RECHAZADO')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                              lead.isApproved === 'RECHAZADO'
                                ? 'bg-rose-600 text-white shadow-sm'
                                : 'bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-200'
                            } disabled:opacity-50`}
                            title={
                              group.isGroup
                                ? `Rechazar esta transferencia (${group.allRecords.length} personas en este comprobante)`
                                : `Rechazar transferencia de ${lead.fullName}`
                            }
                          >
                            {isWorking ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-600" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5" />
                            )}
                            <span>{group.isGroup ? `Rechazar (${group.allRecords.length})` : 'Rechazar'}</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Integrated Persons Box for Multi-Person Transfer */}
                    {group.isGroup && (
                      <div className="mt-1 pt-2.5 border-t border-slate-100 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                          <span className="flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 text-indigo-600" />
                            Personas registradas en esta transferencia conjunta ({group.allRecords.length}):
                          </span>
                          <span className="text-[11px] text-slate-400 font-normal">
                            1 solo comprobante de pago compartido
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {group.allRecords.map((person, pIdx) => (
                            <div
                              key={person.id}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs shadow-2xs ${
                                pIdx === 0
                                  ? 'bg-teal-50/80 border-teal-200 text-teal-900'
                                  : 'bg-white border-slate-200 text-slate-800'
                              }`}
                            >
                              <span className={`font-mono font-bold px-1.5 py-0.2 rounded text-[11px] ${
                                pIdx === 0 ? 'bg-teal-200/80 text-teal-900' : 'bg-slate-100 text-slate-700'
                              }`}>
                                #{person.indexNumber}
                              </span>
                              <span className="font-semibold">{person.fullName}</span>
                              <span className="text-slate-400 font-mono text-[11px]">(DNI: {person.dni})</span>
                              {pIdx === 0 && (
                                <span className="text-[10px] bg-teal-200/60 text-teal-800 px-1.5 py-0.2 rounded font-bold">
                                  Titular
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          /* Individual Records View (Row by Row) */
          filteredIndividualRecords.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-3">
                <FileCheck2 className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-slate-700">No hay registros para mostrar</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredIndividualRecords.map((rec) => {
                const group = recordGroupMap.get(rec.id);
                const isGroup = group && group.isGroup;
                const isWorking = processingId === rec.id;
                const otherPersonsInGroup = group?.allRecords.filter((r) => r.id !== rec.id) || [];

                return (
                  <div
                    key={rec.id}
                    className={`p-4 sm:p-5 transition-colors hover:bg-slate-50/70 flex flex-col gap-2.5 ${
                      rec.isApproved === 'APROBADO'
                        ? 'border-l-4 border-l-emerald-500'
                        : rec.isApproved === 'RECHAZADO'
                        ? 'border-l-4 border-l-rose-500'
                        : 'border-l-4 border-l-amber-400'
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      <div className="flex items-start gap-3.5">
                        <div className="w-10 h-10 rounded-xl bg-slate-900 text-teal-400 font-mono font-bold flex items-center justify-center text-sm shrink-0 shadow-sm">
                          #{rec.indexNumber}
                        </div>

                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-base font-bold text-slate-900">{rec.fullName}</h4>
                            <span className="font-mono text-xs px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md border border-slate-200 font-bold">
                              DNI: {rec.dni}
                            </span>
                            <span className="text-[11px] px-2 py-0.5 bg-teal-50 text-teal-700 rounded-md border border-teal-200 font-medium">
                              Staff: {rec.staffMemberName}
                            </span>

                            {isGroup && (
                              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold">
                                <Users className="w-3 h-3 text-indigo-600" />
                                Comprobante compartido con #{otherPersonsInGroup.map((o) => `${o.indexNumber} ${o.fullName}`).join(', #')}
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                            <span className="flex items-center gap-1 font-medium">
                              {rec.hasTransferred ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                  Transfirió: SÍ
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                                  <XCircle className="w-3.5 h-3.5 text-rose-600" />
                                  Transfirió: NO
                                </span>
                              )}
                            </span>

                            {rec.timestamp && <span>Fecha: {rec.timestamp}</span>}
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-wrap items-center gap-2.5 self-end lg:self-center">
                        {rec.receiptDriveUrl && rec.receiptDriveUrl !== 'Sin comprobante' ? (
                          <button
                            type="button"
                            onClick={() => setSelectedReceipt(rec.receiptDriveUrl)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5 text-slate-600" />
                            <span>Ver Comprobante</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400 italic px-2">Sin comprobante</span>
                        )}

                        <div className="mr-1">
                          {rec.isApproved === 'APROBADO' && (
                            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              APROBADA
                            </span>
                          )}
                          {rec.isApproved === 'RECHAZADO' && (
                            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
                              <XCircle className="w-4 h-4 text-rose-600" />
                              NO APROBADA
                            </span>
                          )}
                          {rec.isApproved === 'PENDIENTE' && (
                            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
                              <Clock className="w-4 h-4 text-amber-600" />
                              PENDIENTE
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200">
                          <button
                            type="button"
                            disabled={isWorking || rec.isApproved === 'APROBADO'}
                            onClick={() => onUpdateApproval(rec, 'APROBADO')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                              rec.isApproved === 'APROBADO'
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'bg-white hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200'
                            } disabled:opacity-50`}
                          >
                            {isWorking ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            )}
                            <span>Aprobar</span>
                          </button>

                          <button
                            type="button"
                            disabled={isWorking || rec.isApproved === 'RECHAZADO'}
                            onClick={() => onUpdateApproval(rec, 'RECHAZADO')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                              rec.isApproved === 'RECHAZADO'
                                ? 'bg-rose-600 text-white shadow-sm'
                                : 'bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-200'
                            } disabled:opacity-50`}
                          >
                            {isWorking ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-rose-600" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5" />
                            )}
                            <span>Rechazar</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* Modal for previewing Receipt */}
      {selectedReceipt && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Eye className="w-4 h-4 text-teal-600" />
                Comprobante de Transferencia
              </h4>
              <div className="flex items-center gap-2">
                <a
                  href={selectedReceipt}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-teal-600 hover:underline flex items-center gap-1 mr-2"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir original
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedReceipt(null)}
                  className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto flex-1 flex items-center justify-center bg-slate-950">
              {selectedReceipt.startsWith('data:image') || selectedReceipt.includes('.google.com') ? (
                <img
                  src={selectedReceipt}
                  alt="Comprobante"
                  className="max-h-[60vh] object-contain rounded-lg shadow-md"
                  onError={(e) => {
                    const target = e.currentTarget;
                    target.style.display = 'none';
                    const fallback = document.getElementById('receipt-fallback');
                    if (fallback) fallback.style.display = 'block';
                  }}
                />
              ) : null}

              <div id="receipt-fallback" className="text-center p-8 text-white hidden">
                <AlertCircle className="w-10 h-10 text-teal-400 mx-auto mb-2" />
                <p className="text-sm font-medium">Visualización de comprobante</p>
                <a
                  href={selectedReceipt}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 text-white text-xs font-semibold"
                >
                  Abrir en Google Drive <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border-t border-slate-100 text-right">
              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold cursor-pointer"
              >
                Cerrar Visor
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
