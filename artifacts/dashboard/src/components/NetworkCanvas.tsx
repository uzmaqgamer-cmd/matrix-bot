import React, { useEffect, useRef } from 'react';

interface NetworkCanvasProps {
  label: string;
  accentUp: string;
  accentDown: string;
  unit: string;
  nodeNames: string[];
  height?: number;
}

export function NetworkCanvas({ label, accentUp, accentDown, unit, nodeNames, height = 100 }: NetworkCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = height;
    
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    ctx.scale(dpr, dpr);

    const defaultNames = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE"];
    const names = nodeNames.length >= 6 ? nodeNames.slice(0, 6) : [...nodeNames, ...defaultNames].slice(0, 6);

    const nds = names.map(n => ({
      name: n,
      x: 20 + Math.random() * (cw - 40),
      y: 15 + Math.random() * (ch - 30),
      vx: (Math.random() - 0.5) * 0.75,
      vy: (Math.random() - 0.5) * 0.75,
      dir: 0 as 1 | 0 | -1,
      pulse: Math.random() * 6,
      val: (Math.random() * 2 - 1) * 0.8
    }));

    const dirColor = (d: number) => d > 0 ? accentUp : d < 0 ? accentDown : "#3a4650";

    const draw = () => {
      ctx.clearRect(0, 0, cw, ch);
      
      nds.forEach(n => {
        n.x += n.vx;
        n.y += n.vy;
        n.pulse += 0.05;
        if (n.x < 15 || n.x > cw - 15) n.vx *= -1;
        if (n.y < 12 || n.y > ch - 12) n.vy *= -1;
      });

      for (let i = 0; i < nds.length; i++) {
        for (let j = i + 1; j < nds.length; j++) {
          const a = nds[i], b = nds[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 95) {
            ctx.strokeStyle = `rgba(255,255,255,${0.05 * (1 - d / 95)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      nds.forEach(n => {
        const r = 3 + Math.sin(n.pulse) * 1;
        const col = dirColor(n.dir);
        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = n.dir === 0 ? 3 : 10;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, 7);
        ctx.fill();
        ctx.restore();
        
        ctx.fillStyle = col;
        ctx.font = "9px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        const sign = n.val >= 0 ? "+" : "";
        ctx.fillText(sign + n.val.toFixed(2) + unit, n.x, n.y - 8);
      });

      animationId = requestAnimationFrame(draw);
    };

    draw();

    const interval350 = setInterval(() => {
      nds.forEach(n => {
        n.val += (Math.random() - 0.5) * 0.3;
        n.val = Math.max(-3, Math.min(3, n.val));
      });
    }, 350);

    const interval1200 = setInterval(() => {
      const n = nds[Math.floor(Math.random() * nds.length)];
      n.dir = Math.random() < 0.5 ? (Math.random() < 0.5 ? 1 : -1) : 0;
    }, 1200);

    return () => {
      cancelAnimationFrame(animationId);
      clearInterval(interval350);
      clearInterval(interval1200);
    };
  }, [accentUp, accentDown, unit, nodeNames, height]);

  return (
    <div className="matrix-card w-full flex flex-col p-3">
      <div className="text-[9.5px] text-[#55636f] tracking-[0.9px] uppercase font-medium mb-[2px] z-10">{label}</div>
      <canvas ref={canvasRef} className="w-full block z-10" style={{ height }} />
    </div>
  );
}
