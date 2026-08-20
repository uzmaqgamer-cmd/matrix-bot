import React from 'react';

export function AmbientBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      {/* Deep base gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#020617] via-[#0a0f24] to-[#020617]" />
      
      {/* Glowing Orbs */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-[radial-gradient(circle,rgba(0,229,255,0.06)_0%,transparent_60%)] blur-[100px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-[radial-gradient(circle,rgba(255,42,95,0.04)_0%,transparent_60%)] blur-[100px]" />
      <div className="absolute top-[30%] left-[50%] w-[40%] h-[40%] bg-[radial-gradient(circle,rgba(255,170,0,0.03)_0%,transparent_60%)] blur-[100px]" />
      
      {/* Grain / Noise */}
      <div 
        className="absolute inset-0 opacity-[0.03] mix-blend-overlay" 
        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.8%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }}
      />
    </div>
  );
}
