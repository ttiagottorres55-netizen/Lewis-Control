import React from 'react';

interface LewisLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const LewisLogo: React.FC<LewisLogoProps> = ({ className = '', size = 'md' }) => {
  const isSmall = size === 'sm';

  return (
    <div className={`inline-flex items-center gap-1.5 sm:gap-2 select-none shrink-0 ${className}`}>
      {/* LEWIS wordmark in ultra-bold modern typography */}
      <span
        className={`font-black tracking-tight text-slate-950 uppercase font-sans leading-none ${
          isSmall ? 'text-base sm:text-xl' : 'text-xl sm:text-2xl'
        }`}
      >
        LEWIS
      </span>

      {/* CONTROL pill with warm gold/amber background */}
      <span
        className={`bg-[#E4B877] text-slate-950 font-black tracking-wide uppercase leading-none shadow-xs font-sans rounded-md shrink-0 ${
          isSmall ? 'text-[9px] sm:text-xs px-1.5 sm:px-2 py-0.5' : 'text-xs sm:text-sm px-2.5 py-1'
        }`}
      >
        CONTROL
      </span>
    </div>
  );
};
