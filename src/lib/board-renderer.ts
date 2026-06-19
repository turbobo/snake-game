import type { GameState, Snake, Food, Particle, Point } from './game-engine';

/**
 * Canvas 2D 渲染器 —— 负责游戏全部视觉呈现
 */
export class BoardRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number = 1;
  private size: number = 0;
  private cellSize: number = 0;
  private gridW: number;
  private gridH: number;

  constructor(canvas: HTMLCanvasElement, gridW = 40, gridH = 40) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Cannot get 2d context');
    this.ctx = context;
    this.gridW = gridW;
    this.gridH = gridH;
    this.resize();
  }

  /* ============================
   * 公开方法
   * ============================ */

  /** 根据容器尺寸重新计算画布大小 */
  resize(): void {
    const parent = this.canvas.parentElement;
    const containerW = parent ? parent.clientWidth : 600;
    const containerH = parent ? parent.clientHeight : 600;
    this.size = Math.min(containerW, containerH);

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.size * this.dpr;
    this.canvas.height = this.size * this.dpr;
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;

    this.cellSize = this.size / this.gridW;
  }

  /** 主渲染入口 */
  render(state: GameState): void {
    const ctx = this.ctx;
    const dpr = this.dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. 清屏 + 背景
    this.drawBackground();

    // 2. 网格线
    this.drawGrid();

    // 3. 食物
    const time = state.tick ?? Date.now();
    for (const food of state.foods) {
      this.drawFood(food, time);
    }

    // 4. 蛇体
    for (const snake of state.snakes) {
      if (!snake.alive) continue;
      this.drawSnake(snake);
    }

    // 5. 名称标签（单独层绘制确保在蛇体之上）
    for (const snake of state.snakes) {
      if (!snake.alive) continue;
      if (snake.name && snake.body.length > 0) {
        const head = snake.body[0];
        const cx = (head.x + 0.5) * this.cellSize;
        const cy = (head.y + 0.5) * this.cellSize;
        const displayName = snake.isAI ? `AI-${snake.name}` : snake.name;
        this.drawNameTag(displayName, cx, cy - this.cellSize * 0.8, snake.color.head);
      }
    }

    // 6. 粒子
    for (const p of state.particles) {
      this.drawParticle(p);
    }

    ctx.restore();
  }

  /** 销毁渲染器 */
  destroy(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /* ============================
   * 私有渲染方法
   * ============================ */

  private drawBackground(): void {
    const ctx = this.ctx;
    const w = this.size;
    const h = this.size;
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#0a0a1a');
    gradient.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  private drawGrid(): void {
    const ctx = this.ctx;
    const cs = this.cellSize;
    const w = this.size;
    const h = this.size;

    ctx.lineWidth = 0.5;
    for (let x = 0; x <= this.gridW; x++) {
      ctx.strokeStyle = x % 5 === 0
        ? 'rgba(255, 255, 255, 0.06)'
        : 'rgba(255, 255, 255, 0.03)';
      ctx.beginPath();
      ctx.moveTo(x * cs, 0);
      ctx.lineTo(x * cs, h);
      ctx.stroke();
    }
    for (let y = 0; y <= this.gridH; y++) {
      ctx.strokeStyle = y % 5 === 0
        ? 'rgba(255, 255, 255, 0.06)'
        : 'rgba(255, 255, 255, 0.03)';
      ctx.beginPath();
      ctx.moveTo(0, y * cs);
      ctx.lineTo(w, y * cs);
      ctx.stroke();
    }
  }

  private drawSnake(snake: Snake): void {
    const ctx = this.ctx;
    const cs = this.cellSize;
    const body = snake.body;
    const bodyColor = snake.color.body;
    const headColor = snake.color.head;
    const borderColor = this.darkenColor(bodyColor, 0.3);

    // 从尾到头绘制（确保头在最上层）
    for (let i = body.length - 1; i >= 0; i--) {
      const seg = body[i];
      const cx = (seg.x + 0.5) * cs;
      const cy = (seg.y + 0.5) * cs;
      const isHead = i === 0;

      // 节间连接矩形
      if (i < body.length - 1) {
        const next = body[i + 1];
        const dx = seg.x - next.x;
        const dy = seg.y - next.y;
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
          const mx = ((seg.x + next.x) / 2 + 0.5) * cs;
          const my = ((seg.y + next.y) / 2 + 0.5) * cs;
          const connW = dx !== 0 ? cs * 0.85 : cs * 0.6;
          const connH = dy !== 0 ? cs * 0.85 : cs * 0.6;
          ctx.fillStyle = bodyColor;
          ctx.fillRect(mx - connW / 2, my - connH / 2, connW, connH);
        }
      }

      const segSize = isHead ? cs * 0.95 : cs * 0.85;
      const half = segSize / 2;
      const radius = segSize * 0.3;

      // 发光效果
      if (isHead) {
        ctx.shadowColor = headColor;
        ctx.shadowBlur = snake.boosting ? 24 : 14;
      } else {
        ctx.shadowColor = bodyColor;
        ctx.shadowBlur = 3;
      }

      // 绘制身体圆角矩形
      ctx.beginPath();
      this.drawRoundRect(cx - half, cy - half, segSize, segSize, radius);
      ctx.fillStyle = isHead ? headColor : bodyColor;

      // 身体透明度渐变（尾部略透明）
      if (!isHead) {
        const t = i / Math.max(body.length - 1, 1);
        ctx.globalAlpha = 1 - t * 0.35;
      }
      ctx.fill();

      // 深色边框
      ctx.shadowBlur = 0;
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.globalAlpha = 1;

      // 蛇头绘制眼睛
      if (isHead) {
        ctx.shadowBlur = 0;
        this.drawEyes(cx, cy, snake.dir, cs);
      }
    }
  }

  private drawEyes(cx: number, cy: number, dir: Point, cellSize: number): void {
    const ctx = this.ctx;
    const eyeR = cellSize * 0.15;
    const offset = cellSize * 0.2;
    const pupilR = eyeR * 0.45;

    // 计算两只眼睛位置（垂直于运动方向偏移）
    const perpX = -dir.y;
    const perpY = dir.x;

    const ex1 = cx + dir.x * offset * 0.6 + perpX * offset * 0.7;
    const ey1 = cy + dir.y * offset * 0.6 + perpY * offset * 0.7;
    const ex2 = cx + dir.x * offset * 0.6 - perpX * offset * 0.7;
    const ey2 = cy + dir.y * offset * 0.6 - perpY * offset * 0.7;

    // 白色眼球
    ctx.beginPath();
    ctx.arc(ex1, ey1, eyeR, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(ex2, ey2, eyeR, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // 黑色瞳孔
    const pupilOffX = dir.x * pupilR * 0.5;
    const pupilOffY = dir.y * pupilR * 0.5;

    ctx.beginPath();
    ctx.arc(ex1 + pupilOffX, ey1 + pupilOffY, pupilR, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0a1a';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(ex2 + pupilOffX, ey2 + pupilOffY, pupilR, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0a1a';
    ctx.fill();
  }

  private drawNameTag(name: string, x: number, y: number, color: string): void {
    const ctx = this.ctx;
    const fontSize = Math.round(this.cellSize * 0.5);

    ctx.font = `bold ${fontSize}px -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const metrics = ctx.measureText(name);
    const tw = metrics.width;
    const padH = 6;
    const padV = 2;
    const bgW = tw + padH * 2;
    const bgH = fontSize + padV * 2;
    const bgX = x - bgW / 2;
    const bgY = y - bgH;

    // 背景圆角矩形（使用 head 颜色半透明）
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;

    ctx.beginPath();
    this.drawRoundRect(bgX, bgY, bgW, bgH, 4);
    ctx.fillStyle = this.hexToRgba(color, 0.8);
    ctx.fill();
    ctx.restore();

    // 白色文字
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name, x, y - padV);
    ctx.textBaseline = 'alphabetic';
  }

  private drawFood(food: Food, time: number): void {
    const ctx = this.ctx;
    const cs = this.cellSize;
    const cx = (food.pos.x + 0.5) * cs;
    const cy = (food.pos.y + 0.5) * cs;

    // 呼吸脉冲
    const pulse = 1 + Math.sin(time * 0.05) * 0.12;

    switch (food.type) {
      case 'normal': {
        const r = cs * 0.25 * pulse;
        // 外发光
        const glow = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 2.5);
        glow.addColorStop(0, 'rgba(0, 245, 160, 0.3)');
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(cx - r * 2.5, cy - r * 2.5, r * 5, r * 5);
        // 圆点
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = '#00f5a0';
        ctx.fill();
        break;
      }
      case 'big': {
        const r = cs * 0.38 * pulse;
        const glow = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 2.2);
        glow.addColorStop(0, 'rgba(255, 107, 107, 0.35)');
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(cx - r * 2.2, cy - r * 2.2, r * 4.4, r * 4.4);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = '#ff4757';
        ctx.fill();
        break;
      }
      case 'speed': {
        const r = cs * 0.3 * pulse;
        // 蓝色三角形（简化闪电）
        const glow = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 2);
        glow.addColorStop(0, 'rgba(30, 144, 255, 0.3)');
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4);
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r * 0.87, cy + r * 0.5);
        ctx.lineTo(cx - r * 0.87, cy + r * 0.5);
        ctx.closePath();
        ctx.fillStyle = '#1e90ff';
        ctx.fill();
        break;
      }
      case 'shield': {
        const r = cs * 0.3 * pulse;
        const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2);
        glow.addColorStop(0, 'rgba(255, 215, 0, 0.25)');
        glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4);
        // 金色圆环
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 3;
        ctx.stroke();
        // 内部小圆点
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd700';
        ctx.fill();
        break;
      }
      default: {
        // 默认普通食物
        const r = cs * 0.25 * pulse;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = '#00f5a0';
        ctx.fill();
      }
    }
  }

  private drawParticle(p: Particle): void {
    const ctx = this.ctx;
    const ratio = p.life / p.maxLife;
    const r = p.size * ratio;

    ctx.globalAlpha = ratio;
    ctx.beginPath();
    ctx.arc(p.x * this.cellSize, p.y * this.cellSize, r, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* ============================
   * Helper 方法
   * ============================ */

  /** 乘以 DPR（用于手动像素操作场景） */
  private px(n: number): number {
    return n * this.dpr;
  }

  /** 绘制圆角矩形路径 */
  private drawRoundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    r = Math.min(r, w / 2, h / 2);
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

  /** 加深颜色（factor: 0~1，表示加深比例） */
  private darkenColor(hex: string, factor: number): string {
    // 处理简写和完整 hex
    let r: number, g: number, b: number;
    const clean = hex.replace('#', '');
    if (clean.length === 3) {
      r = parseInt(clean[0] + clean[0], 16);
      g = parseInt(clean[1] + clean[1], 16);
      b = parseInt(clean[2] + clean[2], 16);
    } else {
      r = parseInt(clean.slice(0, 2), 16);
      g = parseInt(clean.slice(2, 4), 16);
      b = parseInt(clean.slice(4, 6), 16);
    }
    r = Math.round(r * (1 - factor));
    g = Math.round(g * (1 - factor));
    b = Math.round(b * (1 - factor));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  /** hex 颜色转 rgba 字符串 */
  private hexToRgba(hex: string, alpha: number): string {
    const clean = hex.replace('#', '');
    let r: number, g: number, b: number;
    if (clean.length === 3) {
      r = parseInt(clean[0] + clean[0], 16);
      g = parseInt(clean[1] + clean[1], 16);
      b = parseInt(clean[2] + clean[2], 16);
    } else {
      r = parseInt(clean.slice(0, 2), 16);
      g = parseInt(clean.slice(2, 4), 16);
      b = parseInt(clean.slice(4, 6), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}
