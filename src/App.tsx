import React, { useEffect, useRef, useState, useCallback } from "react";

// ── Constants (must match server engine.ts) ──────────────────────────────────
const TILE = 48, COLS = 15, ROWS = 13;
const W = COLS * TILE, H = ROWS * TILE;
const MAX_BOMBS = 6, MAX_POWER = 7, MAX_SPEED_UPS = 4;
const BUBBLE_LIFE = 3.5; // seconds a speech bubble stays visible

type PUKind = "B" | "P" | "S";
type Phase = "lobby" | "waiting" | "game" | "gameover" | "disconnected";

interface PSt {
  x: number; y: number; col: number; row: number; alive: boolean;
  maxBombs: number; bombPower: number; speedUps: number;
  wins: number; anim: number; dx: number; dy: number;
}
interface BombSt  { col: number; row: number; timer: number; fuse: number; }
interface FireSt  { col: number; row: number; timer: number; life: number; }
interface PUSt    { col: number; row: number; kind: PUKind; age: number; }
interface CollEv  { col: number; row: number; }
interface GameState {
  p1: PSt; p2: PSt;
  bombs: BombSt[]; fires: FireSt[]; powerups: PUSt[];
  grid: number[][];
  gameOver: boolean; winner: 1 | 2 | null;
  collectEvents: CollEv[];
}
interface CollectFlash { col: number; row: number; timer: number; maxTimer: number; }
interface SpeechBubble { text: string; timer: number; }
interface ChatMsg { playerNum: 1 | 2; text: string; ts: number; }
interface FaceDir { dx: number; dy: number; }

// ── Canvas helpers ────────────────────────────────────────────────────────────
function roundRect(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let cur = "";
  // Handle Chinese/CJK char-by-char splitting + word splitting for Latin
  for (const ch of text) {
    const test = cur + ch;
    if (ctx.measureText(test).width > maxW && cur.length > 0) {
      lines.push(cur);
      cur = ch;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function drawWall(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#3c3c3c"; ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = "#505050"; ctx.fillRect(x+2, y+2, TILE-4, TILE-4);
  ctx.strokeStyle = "#3c3c3c"; ctx.lineWidth = 1;
  for (let i = 0; i < TILE; i += 12) { ctx.beginPath(); ctx.moveTo(x,y+i); ctx.lineTo(x+TILE,y+i); ctx.stroke(); }
  for (let i = 0; i < TILE; i += 8)  { ctx.beginPath(); ctx.moveTo(x+i,y); ctx.lineTo(x+i,y+TILE); ctx.stroke(); }
}
function drawBox(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#8b5a2b"; ctx.fillRect(x+1,y+1,TILE-2,TILE-2);
  ctx.strokeStyle = "#64391e"; ctx.lineWidth = 2;
  ctx.strokeRect(x+4,y+4,TILE-8,TILE-8);
  ctx.beginPath(); ctx.moveTo(x+4,y+TILE/2); ctx.lineTo(x+TILE-4,y+TILE/2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x+TILE/2,y+4); ctx.lineTo(x+TILE/2,y+TILE-4); ctx.stroke();
}
function drawGrass(ctx: CanvasRenderingContext2D, x: number, y: number, shade: boolean) {
  ctx.fillStyle = shade ? "#145014" : "#228b22"; ctx.fillRect(x,y,TILE,TILE);
}
function drawBomb(ctx: CanvasRenderingContext2D, x: number, y: number, t: number, fuse: number) {
  const pulse = 1 + 0.08 * Math.abs((Date.now() % 400) / 200 - 1);
  const r = (TILE/2-6) * pulse;
  const cx = x+TILE/2, cy = y+TILE/2;
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fillStyle="#141414"; ctx.fill();
  ctx.beginPath(); ctx.arc(cx-r*0.3,cy-r*0.3,Math.max(2,r*0.25),0,Math.PI*2); ctx.fillStyle="#505050"; ctx.fill();
  ctx.strokeStyle=(t/fuse)>0.4?"#ff8c00":"#dc1e1e"; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(cx,cy-r); ctx.lineTo(cx+4,cy-r-8); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx+4,cy-r-8,3,0,Math.PI*2); ctx.fillStyle="#ffdc00"; ctx.fill();
}
function drawFire(ctx: CanvasRenderingContext2D, x: number, y: number, timer: number, life: number) {
  const a = (timer/life).toFixed(2);
  const cx=x+TILE/2, cy=y+TILE/2;
  for (const [i,col] of (["rgba(255,220,0,","rgba(255,140,0,","rgba(220,30,30,"] as string[]).entries()) {
    const rs=TILE/2-4-i*4;
    ctx.beginPath(); ctx.arc(cx,cy,rs,0,Math.PI*2); ctx.fillStyle=col+a+")"; ctx.fill();
  }
}
function drawIconBomb(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.fillStyle="#141414"; ctx.beginPath(); ctx.arc(cx,cy+2,9,0,Math.PI*2); ctx.fill();
  ctx.fillStyle="#606060"; ctx.beginPath(); ctx.arc(cx-3,cy-1,3,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle="#ff8c00"; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(cx+1,cy-7); ctx.lineTo(cx+5,cy-12); ctx.stroke();
  ctx.fillStyle="#ffdc00"; ctx.beginPath(); ctx.arc(cx+5,cy-12,2.5,0,Math.PI*2); ctx.fill();
}
function drawIconFlame(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.font = "22px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("💩", cx, cy);
}
function drawIconLightning(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.fillStyle="#fff";
  ctx.beginPath(); ctx.moveTo(cx+4,cy-13); ctx.lineTo(cx-5,cy+1); ctx.lineTo(cx+2,cy+1);
  ctx.lineTo(cx-4,cy+13); ctx.lineTo(cx+7,cy-1); ctx.lineTo(cx+0,cy-1); ctx.closePath(); ctx.fill();
}
function drawPowerUp(ctx: CanvasRenderingContext2D, pu: PUSt) {
  const x = pu.col * TILE, y = pu.row * TILE;
  const bob = Math.sin(pu.age * 4) * 2;
  const cx = x + TILE/2, cy = y + TILE/2 + bob;
  const glow = pu.kind === "B" ? "#888" : pu.kind === "P" ? "#a855f7" : "#38bdf8";
  ctx.save();
  ctx.shadowColor = glow; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI*2);
  const col = pu.kind === "B" ? "#444" : pu.kind === "P" ? "#6b21a8" : "#075985";
  ctx.fillStyle = col; ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.shadowColor = glow; ctx.shadowBlur = 6;
  if (pu.kind === "B") drawIconBomb(ctx, cx, cy);
  else if (pu.kind === "P") drawIconFlame(ctx, cx, cy);
  else drawIconLightning(ctx, cx, cy);
  ctx.restore();
}

// ── Directional character face rendering ─────────────────────────────────────
function drawSpeechBubble(
  ctx: CanvasRenderingContext2D, cx: number, topY: number,
  text: string, alpha: number
) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  const maxW = 150, padding = 7;
  ctx.font = "bold 11px sans-serif";
  const lines = wrapText(ctx, text, maxW - padding * 2);
  const lineH = 15;
  const bw = Math.min(maxW, Math.max(60, ...lines.map(l => ctx.measureText(l).width + padding * 2)));
  const bh = lines.length * lineH + padding * 2;
  const bx = Math.max(4, Math.min(W - bw - 4, cx - bw / 2));
  const by = topY - bh - 10;

  // Shadow
  ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
  roundRect(ctx, bx, by, bw, bh, 8);
  ctx.fillStyle = "rgba(255,255,255,0.96)"; ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  ctx.strokeStyle = "rgba(160,160,160,0.7)"; ctx.lineWidth = 1;
  roundRect(ctx, bx, by, bw, bh, 8); ctx.stroke();

  // Tail triangle
  const tx = Math.max(bx + 8, Math.min(bx + bw - 8, cx));
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ctx.beginPath();
  ctx.moveTo(tx - 5, by + bh);
  ctx.lineTo(tx + 5, by + bh);
  ctx.lineTo(tx, topY - 5);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(160,160,160,0.7)"; ctx.lineWidth = 1; ctx.stroke();

  // Text
  ctx.fillStyle = "#333"; ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  lines.forEach((line, i) => ctx.fillText(line, bx + bw / 2, by + padding + i * lineH));
  ctx.restore();
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  p: PSt, color: string, accent: string,
  dir: FaceDir,
  bubble: SpeechBubble | null
) {
  if (!p.alive) return;
  const R = TILE / 2 - 6; // 18px body radius
  const cx = p.x, cy = p.y;
  const isMoving = p.dx !== 0 || p.dy !== 0;
  // Sinusoidal walking bob — feels organic
  const bob = isMoving ? Math.sin(p.anim * Math.PI) * 2.8 : 0;
  const bx = cx, by = cy + bob;

  // Shadow on ground
  ctx.beginPath();
  ctx.ellipse(cx, cy + R + 2, R * 0.6, R * 0.16, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fill();

  // Body
  ctx.beginPath(); ctx.arc(bx, by, R, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = 2.5; ctx.stroke();

  const { dx, dy } = dir;

  if (dy === -1) {
    // ── BACK OF HEAD ──────────────────────────────────────────────────────
    // Darken top half to suggest facing away
    ctx.beginPath();
    ctx.arc(bx, by, R, Math.PI, 2 * Math.PI);
    ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fill();
    // Two hair tufts at top
    for (const ox of [-R * 0.38, 0, R * 0.38]) {
      ctx.beginPath(); ctx.arc(bx + ox, by - R * 0.82, R * 0.17, 0, Math.PI * 2);
      ctx.fillStyle = accent; ctx.fill();
    }
  } else if (dy === 1) {
    // ── FRONT FACE ────────────────────────────────────────────────────────
    // White sclera
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.ellipse(bx - R*0.32, by - R*0.12, R*0.23, R*0.27, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(bx + R*0.32, by - R*0.12, R*0.23, R*0.27, 0, 0, Math.PI*2); ctx.fill();
    // Pupils
    ctx.fillStyle = "#141414";
    ctx.beginPath(); ctx.arc(bx - R*0.3, by - R*0.1, R*0.13, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(bx + R*0.3, by - R*0.1, R*0.13, 0, Math.PI*2); ctx.fill();
    // Eye shine
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(bx - R*0.24, by - R*0.19, R*0.055, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(bx + R*0.36, by - R*0.19, R*0.055, 0, Math.PI*2); ctx.fill();
    // Smile
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bx, by + R*0.28, R*0.28, 0.15, Math.PI - 0.15); ctx.stroke();
  } else if (dx === 1) {
    // ── RIGHT FACE ────────────────────────────────────────────────────────
    // Ear hint on left (hidden side)
    ctx.beginPath(); ctx.arc(bx - R*0.75, by + R*0.1, R*0.22, 0, Math.PI*2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
    // Visible eye (right side)
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.ellipse(bx + R*0.22, by - R*0.1, R*0.25, R*0.28, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#141414";
    ctx.beginPath(); ctx.arc(bx + R*0.31, by - R*0.09, R*0.13, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(bx + R*0.24, by - R*0.19, R*0.055, 0, Math.PI*2); ctx.fill();
    // Smile
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bx + R*0.12, by + R*0.3, R*0.2, 0.1, Math.PI - 0.1); ctx.stroke();
  } else {
    // ── LEFT FACE (dx === -1 or default) ─────────────────────────────────
    // Ear hint on right (hidden side)
    ctx.beginPath(); ctx.arc(bx + R*0.75, by + R*0.1, R*0.22, 0, Math.PI*2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
    // Visible eye (left side)
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.ellipse(bx - R*0.22, by - R*0.1, R*0.25, R*0.28, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#141414";
    ctx.beginPath(); ctx.arc(bx - R*0.31, by - R*0.09, R*0.13, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(bx - R*0.36, by - R*0.19, R*0.055, 0, Math.PI*2); ctx.fill();
    // Smile
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bx - R*0.12, by + R*0.3, R*0.2, 0.1, Math.PI - 0.1); ctx.stroke();
  }

  // Speech bubble above head
  if (bubble && bubble.timer > 0) {
    const alpha = Math.min(1, bubble.timer / 0.5) * Math.min(1, (bubble.timer / 0.5));
    drawSpeechBubble(ctx, bx, by - R - 4, bubble.text, alpha);
  }
}

// ── Lobby Screen ─────────────────────────────────────────────────────────────
function Lobby({ onCreateRoom, onJoinRoom, onSolo, error }: {
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onSolo: () => void;
  error: string;
}) {
  const [code, setCode] = useState("");
  return (
    <div style={{ minHeight:"100vh", background:"#0d0d1a", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"#14142a", border:"2px solid #333", borderRadius:16, padding:"40px 36px", width:340, textAlign:"center" }}>
        <div style={{ fontSize:40, marginBottom:6 }}>💣</div>
        <h1 style={{ color:"#fff", fontSize:24, margin:"0 0 4px", fontWeight:800 }}>炸弹人联机版</h1>
        <p style={{ color:"#888", fontSize:13, marginBottom:28 }}>Bomberman Online — 双人实时对战</p>
        <button
          onClick={onCreateRoom}
          style={{ width:"100%", padding:"14px 0", borderRadius:10, border:"none", background:"#3b82f6", color:"#fff", fontSize:16, fontWeight:700, cursor:"pointer", marginBottom:12 }}
        >🎮 创建房间</button>
        <div style={{ color:"#555", fontSize:13, margin:"0 0 10px" }}>—— 或 ——</div>
        <input
          type="text" placeholder="输 入 房 间 码"
          value={code} onChange={e => setCode(e.target.value.toUpperCase().slice(0,4))}
          onKeyDown={e => e.key === "Enter" && code.length === 4 && onJoinRoom(code)}
          style={{ width:"100%", boxSizing:"border-box", padding:"12px 14px", borderRadius:10, border:"2px solid #333", background:"#0d0d1a", color:"#fff", fontSize:17, letterSpacing:8, textAlign:"center", marginBottom:10, outline:"none" }}
        />
        <button
          onClick={() => code.length === 4 && onJoinRoom(code)}
          style={{ width:"100%", padding:"14px 0", borderRadius:10, border:"none", background: code.length===4?"#15803d":"#1e3a2e", color: code.length===4?"#fff":"#555", fontSize:16, fontWeight:700, cursor: code.length===4?"pointer":"default", marginBottom:16 }}
        >🔗 加入房间</button>
        {error && <div style={{ color:"#f87171", fontSize:13, marginBottom:10 }}>{error}</div>}
        {/* Solo test button */}
        <div style={{ borderTop:"1px solid #222", paddingTop:14, marginTop:4 }}>
          <button
            onClick={onSolo}
            style={{ width:"100%", padding:"11px 0", borderRadius:10, border:"2px dashed #444", background:"transparent", color:"#888", fontSize:14, fontWeight:600, cursor:"pointer" }}
          >🧪 单机测试（查看效果）</button>
        </div>
        <div style={{ color:"#444", fontSize:11, marginTop:14, lineHeight:1.8 }}>
          <div>P1: WASD 移动 · 空格放炸弹</div>
          <div>P2: 方向键移动 · 回车放炸弹</div>
        </div>
      </div>
    </div>
  );
}

// ── Waiting Screen ────────────────────────────────────────────────────────────
function Waiting({ code, playerNum }: { code: string; playerNum: 1 | 2 }) {
  const [dots, setDots] = useState(".");
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? "." : d + "."), 500);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ minHeight:"100vh", background:"#0d0d1a", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"#14142a", border:"2px solid #333", borderRadius:16, padding:"40px 36px", width:340, textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:12 }}>⏳</div>
        <h2 style={{ color:"#fff", fontSize:22, marginBottom:8 }}>你是 Player {playerNum}</h2>
        <p style={{ color:"#888", fontSize:14, marginBottom:24 }}>等待对手加入{dots}</p>
        <div style={{ background:"#0d0d1a", borderRadius:12, padding:"16px 0", marginBottom:16 }}>
          <div style={{ color:"#aaa", fontSize:12, marginBottom:6 }}>房间码</div>
          <div style={{ color:"#5bb8ff", fontSize:40, fontWeight:900, letterSpacing:12 }}>{code}</div>
          <div style={{ color:"#555", fontSize:11, marginTop:6 }}>把这个码发给你的朋友</div>
        </div>
      </div>
    </div>
  );
}

// ── Mobile D-Pad ──────────────────────────────────────────────────────────────
function DPad({ onKey }: { onKey: (key: string, down: boolean) => void }) {
  const btnStyle = (label: string): React.CSSProperties => ({
    width: 52, height: 52, borderRadius: 10,
    background: "rgba(255,255,255,0.15)", border: "2px solid rgba(255,255,255,0.25)",
    color: "#fff", fontSize: 22, display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", userSelect: "none", WebkitUserSelect: "none",
    touchAction: "none",
  });
  const mkHandlers = (key: string) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); onKey(key, true); },
    onPointerUp:   (e: React.PointerEvent) => { e.preventDefault(); onKey(key, false); },
    onPointerCancel:(e: React.PointerEvent) => { onKey(key, false); },
  });
  return (
    <div style={{ position:"relative", width:160, height:160, flexShrink:0 }}>
      {/* Up */}
      <div style={{ ...btnStyle("▲"), position:"absolute", top:0, left:54 }} {...mkHandlers("up")}>▲</div>
      {/* Down */}
      <div style={{ ...btnStyle("▼"), position:"absolute", top:108, left:54 }} {...mkHandlers("down")}>▼</div>
      {/* Left */}
      <div style={{ ...btnStyle("◀"), position:"absolute", top:54, left:0 }} {...mkHandlers("left")}>◀</div>
      {/* Right */}
      <div style={{ ...btnStyle("▶"), position:"absolute", top:54, left:108 }} {...mkHandlers("right")}>▶</div>
      {/* Center dot */}
      <div style={{ position:"absolute", top:60, left:60, width:40, height:40, borderRadius:8,
        background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.1)" }} />
    </div>
  );
}

// ── Chat Panel ────────────────────────────────────────────────────────────────
function ChatPanel({ msgs, myNum, onSend }: {
  msgs: ChatMsg[]; myNum: 1 | 2; onSend: (text: string) => void;
}) {
  const [input, setInput] = useState("");
  // Ref directly on the scrollable container — fastest scroll-to-bottom
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const submit = () => {
    const t = input.trim();
    if (!t) return;
    onSend(t);
    setInput("");
  };

  return (
    <div style={{
      width: 190, background:"#10102080", backdropFilter:"blur(6px)",
      border:"1px solid #333", borderRadius:10, display:"flex",
      flexDirection:"column", overflow:"hidden", flexShrink: 0,
    }}>
      <div style={{ padding:"8px 10px", borderBottom:"1px solid #2a2a2a", color:"#888", fontSize:12, fontWeight:700 }}>
        💬 聊天
      </div>
      {/* Fixed height — NEVER grows beyond this, scrolls inside */}
      <div
        ref={listRef}
        style={{
          height: 220, overflowY: "auto", padding: "8px",
          scrollbarWidth: "thin", scrollbarColor: "#333 transparent",
        }}
      >
        {msgs.length === 0 && (
          <div style={{ color:"#444", fontSize:11, textAlign:"center", marginTop:16 }}>还没有消息…</div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ marginBottom:6 }}>
            <span style={{ fontSize:11, fontWeight:700, color: m.playerNum === myNum ? "#5bb8ff" : "#ff7c7c" }}>
              P{m.playerNum}
            </span>
            <span style={{ fontSize:11, color:"#ccc", marginLeft:5, wordBreak:"break-all" }}>{m.text}</span>
          </div>
        ))}
      </div>
      <div style={{ padding:"6px 8px", borderTop:"1px solid #2a2a2a", display:"flex", gap:4 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          placeholder="发条消息…"
          maxLength={80}
          style={{
            flex:1, background:"#0d0d1a", border:"1px solid #333",
            borderRadius:6, color:"#fff", fontSize:11, padding:"5px 7px", outline:"none",
          }}
        />
        <button
          onClick={submit}
          style={{ background:"#3b82f6", border:"none", borderRadius:6,
            color:"#fff", fontSize:11, padding:"5px 9px", cursor:"pointer", fontWeight:700 }}
        >发</button>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase] = useState<Phase>("lobby");
  const [playerNum, setPlayerNum] = useState<1 | 2>(1);
  const [roomCode, setRoomCode] = useState("");
  const [winner, setWinner] = useState<1 | 2 | null>(null);
  const [wins, setWins] = useState<[number,number]>([0,0]);
  const [error, setError] = useState("");
  const [remoteVote, setRemoteVote] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [scale, setScale] = useState(1);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef     = useRef<WebSocket | null>(null);
  const stateRef  = useRef<GameState | null>(null);
  const rafRef    = useRef<number>(0);
  const flashesRef = useRef<CollectFlash[]>([]);
  const lastRenderRef = useRef<number>(0);
  const lastDirRef = useRef<{ p1: FaceDir; p2: FaceDir }>({
    p1: { dx: 0, dy: 1 },  // P1 starts facing down
    p2: { dx: 0, dy: -1 }, // P2 starts facing up
  });
  const bubblesRef = useRef<{ p1: SpeechBubble | null; p2: SpeechBubble | null }>({ p1: null, p2: null });
  const mobileKeysRef = useRef({ up:false, down:false, left:false, right:false, bomb:false });
  const keysRef = useRef({ up:false, down:false, left:false, right:false, bomb:false });
  const chatMsgsRef = useRef<ChatMsg[]>([]);

  // Detect mobile
  const isMobile = typeof window !== "undefined"
    && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  // Responsive scale — recalculates on every resize/orientation-change
  useEffect(() => {
    const update = () => {
      if (isMobile) {
        // Portrait: fit to screen width. Landscape: also check height-based limit.
        const byWidth  = (window.innerWidth - 8) / W;
        const byHeight = (window.innerHeight * 0.72) / H; // leave room for controls below
        setScale(Math.min(1, byWidth, byHeight));
      } else {
        // Desktop: subtract side panel (HUD + Chat, ~210px) + gap
        setScale(Math.min(1, (window.innerWidth - 230) / W));
      }
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [isMobile]);

  // ── WebSocket connection ──────────────────────────────────────────────────
  const connect = useCallback(() => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    //const ws = new WebSocket(`${proto}//${location.host}/api/ws`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as Record<string, unknown>;

      if (msg.type === "created") {
        setPlayerNum(1); setRoomCode(msg.code as string);
        setPhase("waiting"); setError("");
      }
      else if (msg.type === "joined") {
        setPlayerNum(2); setPhase("game"); setError("");
        stateRef.current = msg as unknown as GameState;
      }
      else if (msg.type === "start") {
        setPhase("game"); setWinner(null); setRemoteVote(false);
        stateRef.current = msg as unknown as GameState;
        setChatMsgs([]); chatMsgsRef.current = [];
        bubblesRef.current = { p1: null, p2: null };
        lastDirRef.current = { p1:{ dx:0, dy:1 }, p2:{ dx:0, dy:-1 } };
      }
      else if (msg.type === "state") {
        stateRef.current = msg as unknown as GameState;
        const gs = stateRef.current;
        // Update win counts
        if (gs.gameOver) {
          setWins([gs.p1.wins, gs.p2.wins]);
          setWinner(gs.winner);
          setPhase("gameover");
        }
        // Collect events → flashes
        if (gs.collectEvents?.length) {
          for (const ev of gs.collectEvents) {
            flashesRef.current.push({ col:ev.col, row:ev.row, timer:0.6, maxTimer:0.6 });
          }
        }
      }
      else if (msg.type === "chat") {
        const cm: ChatMsg = { playerNum: msg.playerNum as 1|2, text: msg.text as string, ts: Date.now() };
        chatMsgsRef.current = [...chatMsgsRef.current, cm];
        setChatMsgs([...chatMsgsRef.current]);
        // Speech bubble
        const key = msg.playerNum === 1 ? "p1" : "p2";
        bubblesRef.current[key] = { text: msg.text as string, timer: BUBBLE_LIFE };
      }
      else if (msg.type === "error")    { setError(msg.msg as string); }
      else if (msg.type === "rematch_vote") { setRemoteVote(true); }
      else if (msg.type === "opponent_disconnected") { setPhase("disconnected"); }
    };

    ws.onerror = () => setError("连接失败，请刷新重试");
  }, []);

  // ── Keyboard handling ─────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "game" && phase !== "gameover") return;
    const send = () => {
      wsRef.current?.send(JSON.stringify({ type:"input", ...keysRef.current }));
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return; // don't hijack chat input
      const k = keysRef.current;
      const pn = playerNum;
      let changed = false;
      if (pn === 1) {
        if (e.code==="KeyW"&&!k.up)    { k.up=true; changed=true; }
        if (e.code==="KeyS"&&!k.down)  { k.down=true; changed=true; }
        if (e.code==="KeyA"&&!k.left)  { k.left=true; changed=true; }
        if (e.code==="KeyD"&&!k.right) { k.right=true; changed=true; }
        if (e.code==="Space"&&!k.bomb) { k.bomb=true; changed=true; e.preventDefault(); }
      } else {
        if (e.code==="ArrowUp"&&!k.up)    { k.up=true; changed=true; e.preventDefault(); }
        if (e.code==="ArrowDown"&&!k.down) { k.down=true; changed=true; e.preventDefault(); }
        if (e.code==="ArrowLeft"&&!k.left) { k.left=true; changed=true; e.preventDefault(); }
        if (e.code==="ArrowRight"&&!k.right){ k.right=true; changed=true; e.preventDefault(); }
        if ((e.code==="Enter"||e.code==="NumpadEnter")&&!k.bomb){ k.bomb=true; changed=true; }
      }
      if (changed) send();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = keysRef.current;
      const pn = playerNum;
      let changed = false;
      if (pn === 1) {
        if (e.code==="KeyW")   { k.up=false; changed=true; }
        if (e.code==="KeyS")   { k.down=false; changed=true; }
        if (e.code==="KeyA")   { k.left=false; changed=true; }
        if (e.code==="KeyD")   { k.right=false; changed=true; }
        if (e.code==="Space")  { k.bomb=false; changed=true; }
      } else {
        if (e.code==="ArrowUp")    { k.up=false; changed=true; }
        if (e.code==="ArrowDown")  { k.down=false; changed=true; }
        if (e.code==="ArrowLeft")  { k.left=false; changed=true; }
        if (e.code==="ArrowRight") { k.right=false; changed=true; }
        if (e.code==="Enter"||e.code==="NumpadEnter") { k.bomb=false; changed=true; }
      }
      if (changed) send();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [phase, playerNum]);

  // ── Mobile key handler ────────────────────────────────────────────────────
  const setMobileKey = useCallback((key: string, down: boolean) => {
    const mk = mobileKeysRef.current as Record<string, boolean>;
    if (mk[key] === down) return;
    mk[key] = down;
    keysRef.current = { ...mk } as typeof keysRef.current;
    wsRef.current?.send(JSON.stringify({ type:"input", ...mk }));
  }, []);

  // ── Send chat ─────────────────────────────────────────────────────────────
  const sendChat = useCallback((text: string) => {
    wsRef.current?.send(JSON.stringify({ type:"chat", text }));
  }, []);

  // ── Render loop ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "game" && phase !== "gameover") {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const render = (now: number) => {
      rafRef.current = requestAnimationFrame(render);
      const dt = Math.min((now - lastRenderRef.current) / 1000, 0.1);
      lastRenderRef.current = now;

      // Tick speech bubbles
      const b = bubblesRef.current;
      if (b.p1 && b.p1.timer > 0) b.p1 = { ...b.p1, timer: b.p1.timer - dt };
      if (b.p2 && b.p2.timer > 0) b.p2 = { ...b.p2, timer: b.p2.timer - dt };
      if (b.p1 && b.p1.timer <= 0) b.p1 = null;
      if (b.p2 && b.p2.timer <= 0) b.p2 = null;

      const gs = stateRef.current;
      if (!gs) { ctx.clearRect(0,0,W,H); return; }

      // Track facing direction
      const ld = lastDirRef.current;
      if (gs.p1.dx !== 0 || gs.p1.dy !== 0) ld.p1 = { dx: gs.p1.dx, dy: gs.p1.dy };
      if (gs.p2.dx !== 0 || gs.p2.dy !== 0) ld.p2 = { dx: gs.p2.dx, dy: gs.p2.dy };

      // ── Grid ──────────────────────────────────────────────────────────────
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const v = gs.grid[r][c], x = c*TILE, y = r*TILE;
        if (v === 1) drawWall(ctx, x, y);
        else if (v === 2) { drawGrass(ctx,x,y,(r+c)%2===0); drawBox(ctx,x,y); }
        else drawGrass(ctx,x,y,(r+c)%2===0);
      }

      // ── Fires ─────────────────────────────────────────────────────────────
      for (const f of gs.fires) drawFire(ctx, f.col*TILE, f.row*TILE, f.timer, f.life);

      // ── Collect flashes ───────────────────────────────────────────────────
      flashesRef.current = flashesRef.current.filter(fl => fl.timer > 0);
      for (const fl of flashesRef.current) {
        fl.timer -= dt;
        const a = fl.timer / fl.maxTimer;
        const cx = fl.col*TILE+TILE/2, cy = fl.row*TILE+TILE/2;
        ctx.save(); ctx.globalAlpha=a;
        ctx.fillStyle="#ffff88"; ctx.font="bold 18px sans-serif";
        ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText("✨", cx, cy - (1-a)*22);
        ctx.restore();
      }

      // ── Power-ups ─────────────────────────────────────────────────────────
      for (const pu of gs.powerups) drawPowerUp(ctx, pu);

      // ── Bombs ─────────────────────────────────────────────────────────────
      for (const bm of gs.bombs) drawBomb(ctx, bm.col*TILE, bm.row*TILE, bm.timer, bm.fuse);

      // ── Players ───────────────────────────────────────────────────────────
      // Draw opponent first, then self (self always on top)
      const [myP, opP, myDir, opDir, myBub, opBub] = playerNum === 1
        ? [gs.p1, gs.p2, ld.p1, ld.p2, b.p1, b.p2]
        : [gs.p2, gs.p1, ld.p2, ld.p1, b.p2, b.p1];
      const [myCol, myAccent, opCol, opAccent] = playerNum === 1
        ? ["#4fc3f7","#0277bd","#ef9a9a","#c62828"]
        : ["#ef9a9a","#c62828","#4fc3f7","#0277bd"];

      drawPlayer(ctx, opP, opCol, opAccent, opDir, opBub);
      drawPlayer(ctx, myP, myCol, myAccent, myDir, myBub);
    };

    lastRenderRef.current = performance.now();
    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, playerNum]);

  // ── Compute stats (need actual player objects) ────────────────────────────
  const gs = stateRef.current;
  const myP  = gs ? (playerNum===1?gs.p1:gs.p2) : null;
  const opP  = gs ? (playerNum===1?gs.p2:gs.p1) : null;

  function StatBar({ label, icon, val, max }: { label:string; icon:React.ReactNode; val:number; max:number }) {
    return (
      <div style={{ marginBottom:8 }}>
        <div style={{ display:"flex", justifyContent:"space-between", color:"#bbb", fontSize:11, marginBottom:3 }}>
          <span>{icon} {label}</span><span style={{ color:"#fff" }}>{val}/{max}</span>
        </div>
        <div style={{ display:"flex", gap:2 }}>
          {Array.from({length:max},(_,i)=>(
            <div key={i} style={{ flex:1, height:6, borderRadius:3,
              background: i<val ? (label==="炸弹"?"#555":label==="威力"?"#a855f7":"#38bdf8") : "#222" }} />
          ))}
        </div>
      </div>
    );
  }

  const handleCreate  = () => { connect(); wsRef.current!.onopen = () => wsRef.current!.send(JSON.stringify({type:"create"})); };
  const handleJoin    = (code: string) => { connect(); wsRef.current!.onopen = () => wsRef.current!.send(JSON.stringify({type:"join",code})); };
  const handleSolo    = () => { connect(); wsRef.current!.onopen = () => wsRef.current!.send(JSON.stringify({type:"solo"})); };
  const handleRestart = () => { wsRef.current?.send(JSON.stringify({type:"restart"})); };

  // ── Render ────────────────────────────────────────────────────────────────
  if (phase === "lobby") return <Lobby onCreateRoom={handleCreate} onJoinRoom={handleJoin} onSolo={handleSolo} error={error} />;
  if (phase === "waiting") return <Waiting code={roomCode} playerNum={playerNum} />;
  if (phase === "disconnected") return (
    <div style={{ minHeight:"100vh", background:"#0d0d1a", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ textAlign:"center", color:"#fff" }}>
        <div style={{ fontSize:48, marginBottom:12 }}>📡</div>
        <div style={{ fontSize:20, marginBottom:20 }}>对手已断线</div>
        <button onClick={() => { setPhase("lobby"); setError(""); }} style={{ padding:"12px 28px", borderRadius:10, border:"none", background:"#3b82f6", color:"#fff", fontSize:16, cursor:"pointer" }}>返回大厅</button>
      </div>
    </div>
  );

  // ── Game / Gameover ───────────────────────────────────────────────────────
  const canvasEl = (
    <canvas
      ref={canvasRef} width={W} height={H}
      style={{ display:"block", imageRendering:"pixelated",
        width: W * scale, height: H * scale,
        borderRadius: 6, boxShadow:"0 0 40px rgba(0,0,0,0.6)" }}
    />
  );

  const hud = (
    <div style={{ width: 190, flexShrink:0, display:"flex", flexDirection:"column", gap:12 }}>
      {/* Wins */}
      <div style={{ background:"#14142a", border:"1px solid #333", borderRadius:10, padding:"10px 12px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <span style={{ color:"#5bb8ff", fontWeight:800, fontSize:14 }}>P{playerNum} 你</span>
          <span style={{ color:"#fbbf24", fontSize:20, fontWeight:900 }}>🏆{wins[playerNum-1]}</span>
        </div>
        {myP && <>
          <StatBar label="炸弹" icon="🖤" val={myP.maxBombs}  max={MAX_BOMBS}    />
          <StatBar label="威力" icon="💩" val={myP.bombPower} max={MAX_POWER}    />
          <StatBar label="速度" icon="⚡" val={myP.speedUps}  max={MAX_SPEED_UPS}/>
        </>}
      </div>
      {/* Opponent */}
      <div style={{ background:"#14142a", border:"1px solid #333", borderRadius:10, padding:"10px 12px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <span style={{ color:"#ff7c7c", fontWeight:800, fontSize:14 }}>P{playerNum===1?2:1} 对手</span>
          <span style={{ color:"#fbbf24", fontSize:20, fontWeight:900 }}>🏆{wins[playerNum===1?1:0]}</span>
        </div>
        {opP && <>
          <StatBar label="炸弹" icon="🖤" val={opP.maxBombs}  max={MAX_BOMBS}    />
          <StatBar label="威力" icon="💩" val={opP.bombPower} max={MAX_POWER}    />
          <StatBar label="速度" icon="⚡" val={opP.speedUps}  max={MAX_SPEED_UPS}/>
        </>}
      </div>
      {/* Legend */}
      <div style={{ fontSize:11, color:"#555", textAlign:"center", lineHeight:2 }}>
        <div>🖤 炸弹+1（max {MAX_BOMBS}）</div>
        <div>💩 威力+1（max {MAX_POWER}）</div>
        <div>⚡ 速度+15%（max {MAX_SPEED_UPS}次）</div>
      </div>
    </div>
  );

  // Height of the fixed mobile control bar so canvas/content can leave room
  const CTRL_BAR_H = isMobile ? 180 : 0;

  return (
    <div style={{
      minHeight:"100vh", background:"#0d0d1a", display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"flex-start",
      padding: isMobile ? "6px 0 0" : "16px 12px",
      // On mobile, leave space at the bottom for the fixed control bar
      paddingBottom: isMobile ? CTRL_BAR_H + 8 : 16,
    }}>

      {/* Header */}
      <div style={{ color:"#fff", fontSize: isMobile?13:17, fontWeight:800, marginBottom:8, letterSpacing:1 }}>
        💣 炸弹人  <span style={{ color:"#555", fontSize:11, fontWeight:400 }}>房间: {roomCode}</span>
      </div>

      {/* ── Main layout row ── */}
      <div style={{
        display:"flex", gap:10, alignItems:"flex-start",
        width:"100%", justifyContent:"center",
        flexWrap: "nowrap",   // never wrap — canvas+panel always side-by-side on desktop
      }}>

        {/* Canvas wrapper */}
        <div style={{ position:"relative", flexShrink:0 }}>
          {canvasEl}

          {/* Game-over overlay */}
          {phase === "gameover" && (
            <div style={{
              position:"absolute", inset:0, background:"rgba(0,0,0,0.78)",
              display:"flex", alignItems:"center", justifyContent:"center",
              borderRadius:6,
            }}>
              <div style={{ textAlign:"center", color:"#fff" }}>
                <div style={{ fontSize:52, marginBottom:8 }}>
                  {winner === playerNum ? "🏆" : "💀"}
                </div>
                <div style={{ fontSize:26, fontWeight:900, marginBottom:6 }}>
                  {winner === playerNum ? "你赢了！" : winner === null ? "平局！" : "你输了！"}
                </div>
                <div style={{ fontSize:14, color:"#aaa", marginBottom:20 }}>
                  P1 {wins[0]} : {wins[1]} P2
                </div>
                {remoteVote && (
                  <div style={{ color:"#fbbf24", fontSize:13, marginBottom:12 }}>对手想再来一局！</div>
                )}
                <button
                  onClick={handleRestart}
                  style={{ padding:"12px 32px", borderRadius:10, border:"none",
                    background:"#3b82f6", color:"#fff", fontSize:16, fontWeight:700, cursor:"pointer" }}
                >再来一局</button>
              </div>
            </div>
          )}
        </div>

        {/* Side panel — always visible on desktop; compact strip on mobile */}
        {!isMobile ? (
          /* ── Desktop: full HUD + chat column ── */
          <div style={{ display:"flex", flexDirection:"column", gap:10, width:200, flexShrink:0 }}>
            {hud}
            <ChatPanel msgs={chatMsgs} myNum={playerNum} onSend={sendChat} />
          </div>
        ) : (
          /* ── Mobile: ultra-compact stats strip to the right of canvas ── */
          <div style={{
            display:"flex", flexDirection:"column", gap:6, flexShrink:0,
            width: Math.max(70, window.innerWidth - W * scale - 16),
            maxWidth: 90,
          }}>
            <div style={{ background:"#14142a55", border:"1px solid #333", borderRadius:8, padding:"6px 7px" }}>
              <div style={{ color:"#5bb8ff", fontSize:9, fontWeight:700 }}>P{playerNum}</div>
              {myP && <div style={{ color:"#ccc", fontSize:9, lineHeight:1.6 }}>
                🖤{myP.maxBombs}<br/>💩{myP.bombPower}<br/>⚡{myP.speedUps}
              </div>}
            </div>
            <div style={{ background:"#14142a55", border:"1px solid #333", borderRadius:8, padding:"6px 7px" }}>
              <div style={{ color:"#ff7c7c", fontSize:9, fontWeight:700 }}>P{playerNum===1?2:1}</div>
              {opP && <div style={{ color:"#ccc", fontSize:9, lineHeight:1.6 }}>
                🖤{opP.maxBombs}<br/>💩{opP.bombPower}<br/>⚡{opP.speedUps}
              </div>}
            </div>
          </div>
        )}
      </div>

      {/* ── Mobile fixed control bar — sits at the bottom, NEVER overlaps canvas or chat ── */}
      {isMobile && (
        <div style={{
          position:"fixed", bottom:0, left:0, right:0, height: CTRL_BAR_H,
          background:"linear-gradient(to top, rgba(13,13,26,0.97) 70%, transparent)",
          display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"0 20px 12px",
          zIndex: 100,
          // prevent page scroll while touching controls
          touchAction:"none",
        }}>
          {/* D-Pad — left side */}
          <DPad onKey={setMobileKey} />

          {/* Center: chat input */}
          <div style={{ flex:1, margin:"0 12px", display:"flex", flexDirection:"column", gap:6 }}>
            <input
              placeholder="发消息…" maxLength={80}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const v = (e.target as HTMLInputElement).value.trim();
                  if (v) { sendChat(v); (e.target as HTMLInputElement).value = ""; }
                }
              }}
              style={{
                width:"100%", boxSizing:"border-box",
                background:"rgba(255,255,255,0.08)", border:"1px solid #444",
                borderRadius:8, color:"#fff", fontSize:12, padding:"8px 10px", outline:"none",
              }}
            />
            <div style={{ color:"#555", fontSize:9, textAlign:"center" }}>
              🏆 {wins[0]}:{wins[1]} · P{playerNum} 炸弹{myP?.maxBombs} 威力{myP?.bombPower}
            </div>
          </div>

          {/* BOMB button — right side */}
          <div
            style={{
              width:82, height:82, borderRadius:"50%",
              background:"radial-gradient(circle, #ef4444 40%, #991b1b)",
              border:"3px solid rgba(255,255,255,0.35)",
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
              fontSize:28, cursor:"pointer",
              userSelect:"none", WebkitUserSelect:"none" as const,
              touchAction:"none",
              boxShadow:"0 0 20px rgba(239,68,68,0.6), 0 4px 8px rgba(0,0,0,0.5)",
              flexShrink:0,
            }}
            onPointerDown={e => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setMobileKey("bomb",true); }}
            onPointerUp={e => { e.preventDefault(); setMobileKey("bomb",false); }}
            onPointerCancel={() => setMobileKey("bomb",false)}
          >
            💣
            <span style={{ fontSize:9, color:"rgba(255,255,255,0.7)", marginTop:2, fontWeight:700 }}>BOMB</span>
          </div>
        </div>
      )}
    </div>
  );
}
