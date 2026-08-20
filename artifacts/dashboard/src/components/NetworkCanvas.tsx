import { useEffect, useRef } from 'react';

export interface NetworkNode {
  name: string;
  dir: 1 | 0 | -1;
  val: number;     // real value to display
}

interface NetworkCanvasProps {
  label: string;
  accentUp: string;
  accentDown: string;
  unit: string;
  nodes: NetworkNode[];   // real data — up to 8 nodes
  height?: number;
}

export function NetworkCanvas({ label, accentUp, accentDown, unit, nodes, height = 65 }: NetworkCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Keep a mutable ref to the latest node data so animation loop sees fresh values without re-init
  const nodesRef = useRef<NetworkNode[]>(nodes);
  nodesRef.current = nodes;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const cw = canvas.clientWidth;
      const ch = height;
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const cw = () => canvas.width / dpr;
    const ch = () => canvas.height / dpr;

    // Physics state — positions live here, data values come from nodesRef
    const initNodes = (nodesRef.current ?? []);
    const phys = (initNodes.length > 0 ? initNodes : [{ name: '---', dir: 0 as const, val: 0 }]).map(n => ({
      name: n.name,
      x: 20 + Math.random() * Math.max(10, cw() - 40),
      y: 10 + Math.random() * Math.max(5, ch() - 20),
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      pulse: Math.random() * Math.PI * 2,
    }));

    const dirColor = (d: 1 | 0 | -1) => d > 0 ? accentUp : d < 0 ? accentDown : '#475569'; // slate-600

    const draw = () => {
      const w = cw(), h = ch();
      ctx.clearRect(0, 0, w, h);
      const live = nodesRef.current;

      // Update physics
      phys.forEach((p, i) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 15 || p.x > w - 15) p.vx *= -1;
        if (p.y < 10 || p.y > h - 10) p.vy *= -1;
        p.pulse += 0.04;
        // sync name if nodes changed length
        if (live[i]) p.name = live[i].name;
      });

      // Connecting lines
      for (let i = 0; i < phys.length; i++) {
        for (let j = i + 1; j < phys.length; j++) {
          const a = phys[i], b = phys[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 110) {
            ctx.strokeStyle = `rgba(255,255,255,${0.08 * (1 - d / 110)})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }

      // Nodes
      phys.forEach((p, i) => {
        const nd = live[i] ?? { dir: 0 as const, val: 0, name: p.name };
        const r = 3 + Math.sin(p.pulse) * 1;
        const col = dirColor(nd.dir);

        ctx.save();
        ctx.shadowColor = col;
        ctx.shadowBlur = nd.dir === 0 ? 5 : 15;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        // Symbol label
        ctx.fillStyle = col;
        ctx.font = "bold 9px 'JetBrains Mono', monospace";
        ctx.textAlign = 'center';
        const shortName = p.name.replace('USDT', '').slice(0, 6);
        ctx.fillText(shortName, p.x, p.y - r - 4);

        // Value
        const sign = nd.val >= 0 ? '+' : '';
        ctx.font = "bold 8px 'JetBrains Mono', monospace";
        ctx.fillStyle = `${col}cc`;
        ctx.fillText(`${sign}${nd.val.toFixed(2)}${unit}`, p.x, p.y + r + 10);
      });

      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animId);
  // only re-init canvas on mount / color changes — data updates flow through nodesRef
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accentUp, accentDown, unit, height]);

  return (
    <div className="glass-panel flex flex-col p-2.5 z-10 bg-black/20 hover:bg-black/30 transition-colors cursor-default">
      <div className="text-[9px] text-slate-400 tracking-widest uppercase font-semibold mb-1 px-1 font-sans">{label}</div>
      <canvas ref={canvasRef} className="w-full block" style={{ height }} />
    </div>
  );
}
