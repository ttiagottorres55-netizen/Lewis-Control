import React, { useState } from 'react';
import { 
  Users, 
  Plus, 
  Trash2, 
  UploadCloud, 
  CheckCircle2, 
  XCircle, 
  ArrowRight, 
  FileText, 
  Loader2, 
  CreditCard,
  User,
  Hash,
  Sparkles
} from 'lucide-react';
import { PersonEntry, STAFF_MEMBERS } from '../types';

interface StaffFormProps {
  staffName: string;
  onStaffNameChange: (name: string) => void;
  nextIndex: number;
  onSubmitRecords: (data: {
    persons: { fullName: string; dni: string }[];
    hasTransferred: boolean;
    receiptFile: File | null;
    receiptPreviewUrl: string | null;
  }) => Promise<void>;
  isSubmitting: boolean;
  spreadsheetUrl?: string;
}

export const StaffForm: React.FC<StaffFormProps> = ({
  staffName,
  onStaffNameChange,
  nextIndex,
  onSubmitRecords,
  isSubmitting,
}) => {
  // Persons array: starts with 1 person, user can click "Agregar persona" without limit
  const [persons, setPersons] = useState<PersonEntry[]>([
    { id: '1', fullName: '', dni: '' }
  ]);

  const [hasTransferred, setHasTransferred] = useState<boolean>(true);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Add a new person to this transfer entry
  const handleAddPerson = () => {
    setPersons((prev) => [
      ...prev,
      {
        id: (Date.now() + Math.random()).toString(),
        fullName: '',
        dni: '',
      },
    ]);
  };

  // Remove a person (only allowed if more than 1)
  const handleRemovePerson = (id: string) => {
    if (persons.length <= 1) return;
    setPersons((prev) => prev.filter((p) => p.id !== id));
  };

  // Update specific person field
  const handlePersonChange = (id: string, field: 'fullName' | 'dni', value: string) => {
    setPersons((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size limit: 10MB
    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage('El comprobante supera los 10MB. Por favor sube una imagen más liviana.');
      return;
    }

    setReceiptFile(file);
    setErrorMessage(null);

    // Create preview
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        setReceiptPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setReceiptPreview('PDF_DOCUMENT');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    // Validate staff member selection
    if (!staffName) {
      setErrorMessage('Por favor selecciona qué integrante del staff está realizando la carga.');
      return;
    }

    // Validate each person
    const cleanedPersons: { fullName: string; dni: string }[] = [];
    for (let i = 0; i < persons.length; i++) {
      const p = persons[i];
      const cleanName = p.fullName.trim();
      const cleanDni = p.dni.trim();

      if (!cleanName) {
        setErrorMessage(`Debes ingresar el nombre y apellido para la persona #${i + 1}.`);
        return;
      }
      if (!cleanDni || cleanDni.length < 6) {
        setErrorMessage(`Ingresa un DNI válido (mínimo 6 dígitos) para la persona #${i + 1} (${cleanName}).`);
        return;
      }
      cleanedPersons.push({ fullName: cleanName, dni: cleanDni });
    }

    // Check receipt requirement if transferred
    if (hasTransferred && !receiptFile) {
      setErrorMessage(
        cleanedPersons.length > 1
          ? `Al registrar ${cleanedPersons.length} personas con transferencia, debes adjuntar la foto del comprobante único para que el admin lo verifique.`
          : 'Si la persona transfirió, debes adjuntar la foto del comprobante de pago.'
      );
      return;
    }

    try {
      await onSubmitRecords({
        persons: cleanedPersons,
        hasTransferred,
        receiptFile,
        receiptPreviewUrl: receiptPreview,
      });

      const count = cleanedPersons.length;
      setSuccessMessage(
        count === 1
          ? `¡Registro guardado exitosamente para ${cleanedPersons[0].fullName}!`
          : `¡${count} personas registradas con éxito con su comprobante de pago!`
      );

      // Reset form
      setPersons([{ id: Date.now().toString(), fullName: '', dni: '' }]);
      setReceiptFile(null);
      setReceiptPreview(null);
      setHasTransferred(true);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(`Ocurrió un error al registrar: ${err.message || 'Error de red'}`);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto pb-12">
      {/* Staff Selector Bar */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-sm mb-5">
        <div className="flex items-center justify-between mb-3">
          <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <Users className="w-4 h-4 text-teal-600" />
            ¿Quién carga este registro?
          </label>
          <span className="text-[11px] text-teal-700 font-bold bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200">
            {staffName || 'Selecciona'}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {STAFF_MEMBERS.map((member) => (
            <button
              key={member}
              type="button"
              onClick={() => onStaffNameChange(member)}
              className={`py-2 px-1 text-xs font-bold rounded-xl transition-all text-center cursor-pointer ${
                staffName === member
                  ? 'bg-teal-600 text-white shadow-md shadow-teal-600/20 ring-2 ring-teal-600 ring-offset-1'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {member}
            </button>
          ))}
        </div>
      </div>

      {/* Top Banner with Enumeration Counter */}
      <div className="bg-slate-900 text-white p-4 sm:p-5 rounded-2xl shadow-xl mb-5 border border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center font-mono font-bold text-sm">
              #{nextIndex}
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">Formulario de Celular</p>
              <h2 className="text-base font-semibold text-white">
                Carga de Transferencias
              </h2>
            </div>
          </div>
          <span className="text-xs px-3 py-1 rounded-full bg-teal-500/20 text-teal-300 font-bold border border-teal-500/30 flex items-center gap-1">
            <Users className="w-3.5 h-3.5" />
            Staff: {staffName}
          </span>
        </div>
      </div>

      {errorMessage && (
        <div className="mb-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-3 shadow-sm">
          <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="text-sm font-medium">{errorMessage}</div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6 space-y-6">
        {/* Persons Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div>
              <span className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-4 h-4 text-teal-600" />
                Personas Incluidas ({persons.length})
              </span>
              <p className="text-[11px] text-slate-500">
                Si una sola transferencia pagó por más de una persona, agrégalas con el botón de abajo.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {persons.map((person, index) => (
              <div
                key={person.id}
                className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 relative transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-teal-800 bg-teal-100/80 px-2.5 py-0.5 rounded-md flex items-center gap-1">
                    Persona #{index + 1}
                  </span>
                  {persons.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemovePerson(person.id)}
                      className="text-xs text-rose-600 hover:text-rose-700 font-semibold flex items-center gap-1 cursor-pointer p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Quitar</span>
                    </button>
                  )}
                </div>

                {/* Nombre y Apellido */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Nombre y Apellido *
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      required
                      value={person.fullName}
                      onChange={(e) => handlePersonChange(person.id, 'fullName', e.target.value)}
                      placeholder="Ej: Marcos Gómez"
                      className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-teal-600 focus:outline-none"
                    />
                  </div>
                </div>

                {/* DNI */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    DNI / Documento *
                  </label>
                  <div className="relative">
                    <Hash className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      required
                      inputMode="numeric"
                      value={person.dni}
                      onChange={(e) => handlePersonChange(person.id, 'dni', e.target.value)}
                      placeholder="Ej: 42899012"
                      className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-teal-600 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Button: Agregar Persona (Directly below DNI / person fields, no limit) */}
          <div className="pt-1">
            <button
              type="button"
              id="btn-add-person"
              onClick={handleAddPerson}
              className="w-full py-2.5 px-4 rounded-xl border-2 border-dashed border-teal-500 bg-teal-50/70 hover:bg-teal-100/70 text-teal-800 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs active:scale-[0.99]"
            >
              <Plus className="w-4 h-4 text-teal-600" />
              <span>+ Agregar Persona (Misma Transferencia)</span>
            </button>
            <p className="text-[11px] text-slate-400 text-center mt-1.5">
              Sin límite: puedes agregar a todas las personas que abonaron con un mismo comprobante.
            </p>
          </div>
        </div>

        {/* Question: ¿Hizo la transferencia o no? */}
        <div className="pt-2 border-t border-slate-100">
          <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
            ¿Hizo la Transferencia? *
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setHasTransferred(true)}
              className={`py-3 px-4 rounded-xl border flex items-center justify-center gap-2 font-semibold text-sm transition-all cursor-pointer ${
                hasTransferred
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm ring-2 ring-emerald-500/20'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>SÍ Transfirió</span>
            </button>

            <button
              type="button"
              onClick={() => setHasTransferred(false)}
              className={`py-3 px-4 rounded-xl border flex items-center justify-center gap-2 font-semibold text-sm transition-all cursor-pointer ${
                !hasTransferred
                  ? 'bg-amber-600 text-white border-amber-600 shadow-sm ring-2 ring-amber-500/20'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <XCircle className="w-4 h-4" />
              <span>NO Transfirió</span>
            </button>
          </div>
        </div>

        {/* Upload Receipt (Photo or PDF) */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
            Foto del Comprobante de Pago {hasTransferred ? '*' : '(Opcional)'}
          </label>

          <label
            htmlFor="receipt-upload"
            className={`border-2 border-dashed rounded-2xl p-4 sm:p-5 flex flex-col items-center justify-center cursor-pointer transition-all ${
              receiptPreview
                ? 'border-emerald-400 bg-emerald-50/30'
                : 'border-slate-300 hover:border-teal-500 bg-slate-50/50 hover:bg-teal-50/30'
            }`}
          >
            <input
              id="receipt-upload"
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              onChange={handleFileChange}
              className="sr-only"
            />
            <div className="w-10 h-10 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center mb-2">
              <UploadCloud className="w-5 h-5" />
            </div>
            <p className="text-xs sm:text-sm font-semibold text-slate-700 text-center">
              {receiptFile ? 'Cambiar foto del comprobante' : 'Sacar foto o subir comprobante'}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              JPG, PNG o PDF (cámara o galería del celular)
            </p>
          </label>

          {/* Receipt Preview if loaded */}
          {receiptPreview && (
            <div className="mt-3 rounded-xl overflow-hidden border border-slate-200 bg-slate-900">
              {receiptPreview === 'PDF_DOCUMENT' ? (
                <div className="p-4 flex items-center space-x-3 text-white">
                  <FileText className="w-8 h-8 text-teal-400" />
                  <div>
                    <p className="text-sm font-medium">{receiptFile?.name}</p>
                    <p className="text-xs text-slate-400">Documento PDF cargado</p>
                  </div>
                </div>
              ) : (
                <div className="relative max-h-56 overflow-hidden flex items-center justify-center bg-slate-950">
                  <img
                    src={receiptPreview}
                    alt="Comprobante"
                    className="w-full object-contain max-h-56"
                  />
                  <div className="absolute bottom-2 left-2 bg-slate-900/85 backdrop-blur-md px-2.5 py-1 rounded-md text-[11px] text-white flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />
                    Comprobante adjunto
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Submit button */}
        <div className="pt-2">
          <button
            type="submit"
            id="btn-submit-record"
            disabled={isSubmitting}
            className="w-full py-3.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white font-semibold shadow-lg shadow-teal-600/25 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Guardando en Google Sheets...</span>
              </>
            ) : (
              <>
                <span>
                  {persons.length > 1
                    ? `Guardar ${persons.length} Personas en Google Sheets`
                    : 'Guardar Registro en Google Sheets'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>

        {/* Success confirmation directly BELOW the submit button */}
        {successMessage && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-950 flex items-start gap-3 shadow-md animate-in fade-in slide-in-from-top-2">
            <div className="w-8 h-8 rounded-full bg-emerald-200 text-emerald-800 flex items-center justify-center shrink-0 mt-0.5">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="text-sm">
              <p className="font-bold text-emerald-900">{successMessage}</p>
              <p className="text-emerald-800 text-xs mt-0.5">
                Los datos fueron guardados y ya están disponibles en Google Sheets y en el panel del administrador.
              </p>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};
