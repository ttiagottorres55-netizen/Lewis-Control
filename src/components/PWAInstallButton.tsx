import React, { useState } from 'react';
import { Download, Smartphone, Share2, PlusSquare, CheckCircle, X } from 'lucide-react';
import { usePWAInstall } from './usePWAInstall';

export const PWAInstallModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { isInstallable, install, isIOS } = usePWAInstall();
  const [justInstalled, setJustInstalled] = useState(false);

  if (!isOpen) return null;

  const handleInstallClick = async () => {
    if (isInstallable) {
      const ok = await install();
      if (ok) {
        setJustInstalled(true);
        setTimeout(() => {
          onClose();
        }, 2000);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 text-white p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center font-bold">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Descargar en tu Celular</h3>
              <p className="text-xs text-slate-400">Instala la app en iPhone o Android</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {justInstalled ? (
          <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 flex items-center gap-3">
            <CheckCircle className="w-6 h-6 text-emerald-400 shrink-0" />
            <div className="text-xs">
              <strong className="block text-white font-semibold">¡Aplicación instalada!</strong>
              Ya puedes abrirla desde tu pantalla de inicio como una app nativa.
            </div>
          </div>
        ) : (
          <>
            {/* Direct Android/Desktop Install Button */}
            {isInstallable && (
              <div className="p-4 rounded-xl bg-teal-950/40 border border-teal-500/40 text-teal-200 space-y-3">
                <div className="flex items-center gap-2">
                  <Download className="w-5 h-5 text-teal-400" />
                  <span className="font-semibold text-sm text-white">Instalación directa disponible</span>
                </div>
                <p className="text-xs text-slate-300">
                  Tu navegador permite instalar la app directamente en un toque.
                </p>
                <button
                  type="button"
                  onClick={handleInstallClick}
                  className="w-full py-2.5 px-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Instalar Aplicación Ahora</span>
                </button>
              </div>
            )}

            {/* iPhone / iPad Step-by-Step Instructions */}
            <div className="rounded-xl bg-slate-800/80 border border-slate-700/60 p-4 space-y-3">
              <div className="flex items-center gap-2 text-white text-xs font-bold uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                <span>Cómo descargar en iPhone / iOS:</span>
              </div>
              <ol className="text-xs text-slate-300 space-y-2.5 pl-1">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-slate-700 text-slate-200 flex items-center justify-center shrink-0 font-bold text-[11px]">1</span>
                  <span>Abre este enlace en <strong className="text-white">Safari</strong> (el navegador oficial de Apple).</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-slate-700 text-slate-200 flex items-center justify-center shrink-0 font-bold text-[11px]">2</span>
                  <span className="flex items-center gap-1.5 flex-wrap">
                    Toca el botón <strong className="text-white inline-flex items-center gap-1 bg-slate-700 px-1.5 py-0.5 rounded text-[11px]"><Share2 className="w-3 h-3 text-blue-400" /> Compartir</strong> abajo en la barra de Safari.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-slate-700 text-slate-200 flex items-center justify-center shrink-0 font-bold text-[11px]">3</span>
                  <span className="flex items-center gap-1.5 flex-wrap">
                    Desliza hacia abajo y elige <strong className="text-white inline-flex items-center gap-1 bg-slate-700 px-1.5 py-0.5 rounded text-[11px]"><PlusSquare className="w-3 h-3 text-emerald-400" /> Agregar a Inicio</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-slate-700 text-slate-200 flex items-center justify-center shrink-0 font-bold text-[11px]">4</span>
                  <span>Toca <strong className="text-white">Agregar</strong> arriba a la derecha. ¡Listo! Se abrirá a pantalla completa sin barra de navegación.</span>
                </li>
              </ol>
            </div>

            {/* Android Instructions */}
            <div className="rounded-xl bg-slate-800/80 border border-slate-700/60 p-4 space-y-3">
              <div className="flex items-center gap-2 text-white text-xs font-bold uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span>Cómo descargar en Android (Chrome):</span>
              </div>
              <ol className="text-xs text-slate-300 space-y-2.5 pl-1">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-slate-700 text-slate-200 flex items-center justify-center shrink-0 font-bold text-[11px]">1</span>
                  <span>Abre este enlace en <strong className="text-white">Google Chrome</strong>.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-slate-700 text-slate-200 flex items-center justify-center shrink-0 font-bold text-[11px]">2</span>
                  <span>Toca los <strong className="text-white">3 puntos (⋮)</strong> en la esquina superior derecha.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-slate-700 text-slate-200 flex items-center justify-center shrink-0 font-bold text-[11px]">3</span>
                  <span>Selecciona <strong className="text-white">"Instalar aplicación"</strong> o <strong className="text-white">"Agregar a la pantalla principal"</strong>.</span>
                </li>
              </ol>
            </div>
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
};

export const PWAInstallButton: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const { isInstalled } = usePWAInstall();

  // If already running inside standalone app, do not distract
  if (isInstalled) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        id="btn-pwa-install"
        onClick={() => setModalOpen(true)}
        className={
          className ||
          'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-bold shadow-md hover:shadow-lg transition-all cursor-pointer border border-slate-700 active:scale-95'
        }
        title="Descargar app en iPhone y Android"
      >
        <Smartphone className="w-4 h-4 text-teal-400" />
        <Download className="w-3.5 h-3.5 text-teal-300" />
        <span>Descargar App en tu Celular</span>
      </button>

      <PWAInstallModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
};
