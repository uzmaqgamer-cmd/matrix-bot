import { useEffect, useRef } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Fiber {
  x0: number; y0: number;
  cx0: number; cy0: number;
  cx1: number; cy1: number;
  x1: number; y1: number;
  dcx0: number; dcy0: number;
  dcx1: number; dcy1: number;
  dx0: number; dy0: number;
  dx1: number; dy1: number;
  baseColor: string;
  width: number;
}

interface Packet {
  fiberIdx: number;
  t: number;
  speed: number;
  color: string;
  size: number;
  trail: { x: number; y: number }[];
}

interface Node {
  x: number;
  y: number;
  pulse: number;
  pulseSpeed: number;
  r: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function hex2(n: number) {
  return Math.min(255, Math.max(0, Math.floor(n))).toString(16).padStart(2, '0');
}

function bezierPt(f: Fiber, t: number) {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * f.x0 + 3 * mt * mt * t * f.cx0 + 3 * mt * t * t * f.cx1 + t * t * t * f.x1,
    y: mt * mt * mt * f.y0 + 3 * mt * mt * t * f.cy0 + 3 * mt * t * t * f.cy1 + t * t * t * f.y1,
  };
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function NeuralNerveCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const dpr = window.devicePixelRatio || 1;
    let W = 0, H = 0;

    const resize = () => {
      W = container.clientWidth;
      H = container.clientHeight;
      if (W === 0 || H === 0) return;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // ── Nerve fibers ──────────────────────────────────────────────────────────
    const NUM_FIBERS = 16;
    const FIBER_COLORS = [
      '#0d6b52', '#0f7a5c', '#0a4a3a', '#0d5c48',
      '#0d4f5c', '#0a3a5c', '#0f6b5a', '#124a3c',
      '#1a7060', '#0d5240', '#083a2c', '#0a5046',
    ];

    const mkFiber = (): Fiber => ({
      x0: Math.random() * (W || 600),
      y0: Math.random() * (H || 200),
      cx0: Math.random() * (W || 600),
      cy0: Math.random() * (H || 200),
      cx1: Math.random() * (W || 600),
      cy1: Math.random() * (H || 200),
      x1: Math.random() * (W || 600),
      y1: Math.random() * (H || 200),
      dcx0: (Math.random() - 0.5) * 0.28,
      dcy0: (Math.random() - 0.5) * 0.28,
      dcx1: (Math.random() - 0.5) * 0.28,
      dcy1: (Math.random() - 0.5) * 0.28,
      dx0: (Math.random() - 0.5) * 0.1,
      dy0: (Math.random() - 0.5) * 0.1,
      dx1: (Math.random() - 0.5) * 0.1,
      dy1: (Math.random() - 0.5) * 0.1,
      baseColor: FIBER_COLORS[Math.floor(Math.random() * FIBER_COLORS.length)],
      width: 0.4 + Math.random() * 0.8,
    });

    const fibers: Fiber[] = Array.from({ length: NUM_FIBERS }, mkFiber);

    // ── Signal packets ────────────────────────────────────────────────────────
    const PACKET_COLORS = ['#5DCAA5', '#00ff9d', '#4ae3c8', '#7dffd1', '#2affa0', '#48d9b0', '#9effd8'];
    const NUM_PACKETS = 32;

    const mkPacket = (): Packet => ({
      fiberIdx: Math.floor(Math.random() * NUM_FIBERS),
      t: Math.random(),
      speed: 0.004 + Math.random() * 0.010,
      color: PACKET_COLORS[Math.floor(Math.random() * PACKET_COLORS.length)],
      size: 1.4 + Math.random() * 2.0,
      trail: [],
    });

    const packets: Packet[] = Array.from({ length: NUM_PACKETS }, mkPacket);

    // ── Synapse nodes ─────────────────────────────────────────────────────────
    const NUM_NODES = 22;
    const nodes: Node[] = Array.from({ length: NUM_NODES }, () => ({
      x: (W || 600) * 0.05 + Math.random() * (W || 600) * 0.9,
      y: (H || 200) * 0.05 + Math.random() * (H || 200) * 0.9,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.018 + Math.random() * 0.035,
      r: 1.2 + Math.random() * 1.6,
    }));

    // ── Text flicker state ────────────────────────────────────────────────────
    const TEXT_LINES = [
      'NEURAL VERIFICATION LAYER',
      'SIGNAL FORMATION PENDING',
      'BOT MATRIX SCANNING',
      'AWAITING TRIGGER CONDITIONS',
    ];
    let textIdx = 0;
    let textTimer = 0;
    const TEXT_INTERVAL = 140; // frames

    // ── Draw loop ─────────────────────────────────────────────────────────────
    let frame = 0;

    const draw = () => {
      frame++;
      if (W === 0 || H === 0) {
        animId = requestAnimationFrame(draw);
        return;
      }

      // Background
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.4, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.85);
      bg.addColorStop(0, 'rgba(8,17,14,0.96)');
      bg.addColorStop(1, 'rgba(4,9,12,0.99)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Subtle hex-grid background dots
      const gridStep = 28;
      for (let gx = 0; gx < W + gridStep; gx += gridStep) {
        for (let gy = 0; gy < H + gridStep; gy += gridStep * 0.866) {
          const offset = (Math.floor(gy / (gridStep * 0.866)) % 2) * gridStep * 0.5;
          const px = gx + offset;
          ctx.fillStyle = 'rgba(13,92,72,0.09)';
          ctx.beginPath();
          ctx.arc(px, gy, 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ── Update fibers ───────────────────────────────────────────────────────
      fibers.forEach(f => {
        f.cx0 += f.dcx0; f.cy0 += f.dcy0;
        f.cx1 += f.dcx1; f.cy1 += f.dcy1;
        if (f.cx0 < -20 || f.cx0 > W + 20) f.dcx0 *= -1;
        if (f.cy0 < -20 || f.cy0 > H + 20) f.dcy0 *= -1;
        if (f.cx1 < -20 || f.cx1 > W + 20) f.dcx1 *= -1;
        if (f.cy1 < -20 || f.cy1 > H + 20) f.dcy1 *= -1;
        f.x0 += f.dx0; f.y0 += f.dy0;
        f.x1 += f.dx1; f.y1 += f.dy1;
        if (f.x0 < -20 || f.x0 > W + 20) f.dx0 *= -1;
        if (f.y0 < -20 || f.y0 > H + 20) f.dy0 *= -1;
        if (f.x1 < -20 || f.x1 > W + 20) f.dx1 *= -1;
        if (f.y1 < -20 || f.y1 > H + 20) f.dy1 *= -1;
      });

      // ── Draw fibers (dim base) ──────────────────────────────────────────────
      const activeSet = new Set(packets.map(p => p.fiberIdx));
      fibers.forEach((f, fi) => {
        const active = activeSet.has(fi);
        const alpha = active ? 0.38 : 0.10;
        ctx.beginPath();
        ctx.moveTo(f.x0, f.y0);
        ctx.bezierCurveTo(f.cx0, f.cy0, f.cx1, f.cy1, f.x1, f.y1);
        ctx.strokeStyle = f.baseColor + hex2(alpha * 255);
        ctx.lineWidth = f.width;
        ctx.stroke();
      });

      // Bright highlight fibers when packet is nearby
      packets.forEach(p => {
        const f = fibers[p.fiberIdx];
        const pos = bezierPt(f, p.t);
        // Tiny bright streak on the fiber near the packet
        const t0 = Math.max(0, p.t - 0.06);
        const t1 = Math.min(1, p.t + 0.01);
        const steps = 8;
        for (let si = 0; si < steps; si++) {
          const ta = t0 + (t1 - t0) * (si / steps);
          const tb = t0 + (t1 - t0) * ((si + 1) / steps);
          const pa = bezierPt(f, ta);
          const pb = bezierPt(f, tb);
          const progress = si / steps;
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.strokeStyle = p.color + hex2(progress * 0.55 * 255);
          ctx.lineWidth = f.width * 1.5;
          ctx.stroke();
        }
      });

      // ── Update + draw packets ───────────────────────────────────────────────
      packets.forEach(p => {
        p.t += p.speed;
        if (p.t > 1.05) {
          p.t = 0;
          p.fiberIdx = Math.floor(Math.random() * NUM_FIBERS);
          p.trail = [];
          p.speed = 0.004 + Math.random() * 0.010;
        }

        const f = fibers[p.fiberIdx];
        const pos = bezierPt(f, Math.min(1, p.t));
        p.trail.push({ x: pos.x, y: pos.y });
        if (p.trail.length > 14) p.trail.shift();

        // Trail
        for (let ti = 1; ti < p.trail.length; ti++) {
          const alpha = (ti / p.trail.length) * 0.65;
          const width = p.size * (ti / p.trail.length) * 1.2;
          ctx.beginPath();
          ctx.moveTo(p.trail[ti - 1].x, p.trail[ti - 1].y);
          ctx.lineTo(p.trail[ti].x, p.trail[ti].y);
          ctx.strokeStyle = p.color + hex2(alpha * 255);
          ctx.lineWidth = width;
          ctx.lineCap = 'round';
          ctx.stroke();
        }

        // Glow dot
        ctx.save();
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10 + Math.sin(frame * 0.08 + p.t * 20) * 5;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // ── Synapse nodes ───────────────────────────────────────────────────────
      nodes.forEach(n => {
        n.pulse += n.pulseSpeed;
        const glow = 0.25 + Math.sin(n.pulse) * 0.20;
        const r = n.r + Math.sin(n.pulse) * 0.7;

        // Outer halo
        ctx.save();
        ctx.shadowColor = '#5DCAA5';
        ctx.shadowBlur = 8;
        ctx.fillStyle = `rgba(93,202,165,${glow * 0.6})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Core
        ctx.save();
        ctx.shadowColor = '#5DCAA5';
        ctx.shadowBlur = 4;
        ctx.fillStyle = `rgba(93,202,165,${glow + 0.1})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // ── Overlay text ────────────────────────────────────────────────────────
      textTimer++;
      if (textTimer >= TEXT_INTERVAL) {
        textTimer = 0;
        textIdx = (textIdx + 1) % TEXT_LINES.length;
      }

      const textAlpha = textTimer < 20
        ? textTimer / 20
        : textTimer > TEXT_INTERVAL - 20
          ? (TEXT_INTERVAL - textTimer) / 20
          : 1;

      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = `bold 9px 'JetBrains Mono', monospace`;
      ctx.fillStyle = `rgba(93,202,165,${0.22 * textAlpha})`;
      ctx.fillText(TEXT_LINES[textIdx], W / 2, H / 2 - 6);

      ctx.font = `7px 'JetBrains Mono', monospace`;
      ctx.fillStyle = `rgba(85,99,111,${0.35 * textAlpha})`;
      ctx.fillText(
        `${NUM_PACKETS} SIGNAL PATHWAYS · ${NUM_FIBERS} NEURAL FIBERS · MATRIX ACTIVE`,
        W / 2,
        H / 2 + 10,
      );
      ctx.restore();

      animId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
