import React, { useEffect, useState } from 'react';
import { UserProfile } from '../types';

interface ForensicWatermarkProps {
  user: UserProfile;
  enabled?: boolean;
}

export const ForensicWatermark: React.FC<ForensicWatermarkProps> = ({ user, enabled = true }) => {
  const [timestamp, setTimestamp] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimestamp(now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!enabled) return null;

  const watermarkString = `RÉPUBLIQUE GABONAISE // ANIF GABON // DC NKOK TIER-III // MATRICULE: ${user.matricule} // RÔLE: ${user.habilitation} // IP: ${user.stationIP.split(' ')[0]} // HORODATAGE CERTIFIÉ: ${timestamp}`;

  return (
    <div
      id="forensic-watermark"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden select-none"
    >
      <div className="absolute inset-0 flex flex-col justify-around opacity-[0.038] rotate-[-22deg] scale-125 transform">
        {[...Array(9)].map((_, i) => (
          <div
            key={i}
            className="whitespace-nowrap font-mono text-[11px] font-bold tracking-widest text-slate-300 text-center"
          >
            {watermarkString} &nbsp;&nbsp; • &nbsp;&nbsp; {watermarkString}
          </div>
        ))}
      </div>
    </div>
  );
};
