// 贪吃蛇大作战 - GoEasy 联机管理器
// 使用 GoEasy PubSub 实现多人在线对战
// 频道格式: snake-{roomId}

import { GOEASY_CONFIG } from './goeasy-config';

// ===== 类型定义 =====

export type MessageType =
  | 'player-join'
  | 'player-leave'
  | 'room-info'
  | 'game-state'
  | 'direction'
  | 'ping'
  | 'pong'
  | 'sync-request'
  | 'error';

export interface PeerMessage {
  type: MessageType;
  payload: any;
  from: string;
  timestamp: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'disconnected';

type MessageHandler = (msg: PeerMessage) => void;
type DisconnectionHandler = (peerId: string) => void;
type ConnectionHandler = (peerId: string) => void;
type StatusHandler = (status: ConnectionStatus) => void;

// ===== GoEasy Manager =====

export class GoEasyManager {
  private static sdkInitialized: boolean = false;
  private goEasy: any = null;
  private pubsub: any = null;
  private channelName: string = '';
  private clientId: string = '';
  private roomId: string = '';
  private isHost: boolean = false;
  private destroyed: boolean = false;
  private playerName: string = '';

  // 回调
  private messageHandlers: MessageHandler[] = [];
  private disconnectionHandlers: DisconnectionHandler[] = [];
  private connectionHandlers: ConnectionHandler[] = [];
  private statusHandlers: StatusHandler[] = [];

  // 心跳相关
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private peerLastSeen: Map<string, number> = new Map();

  // 房间号生成：6位去歧义字母数字（排除 I/O/0/1）
  private generateRoomId(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  }

  // 加载 GoEasy SDK（动态 script 方式）
  private async loadSDK(): Promise<void> {
    if (typeof window === 'undefined') return;
    if ((window as any).GoEasy) return;

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.goeasy.io/goeasy-2.14.9.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('GoEasy SDK 加载失败'));
      document.head.appendChild(script);

      // 超时保护
      setTimeout(() => {
        if (!(window as any).GoEasy) {
          reject(new Error('GoEasy SDK 加载超时'));
        }
      }, 15000);
    });
  }

  // 初始化
  async initialize(playerName: string): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('GoEasy 只能在浏览器环境中使用');
    }

    this.playerName = playerName;
    this.clientId = `${playerName}-${Math.random().toString(36).slice(2, 8)}`;
    this.notifyStatus('connecting');

    // 加载 SDK
    await this.loadSDK();
    const GoEasySDK = (window as any).GoEasy;
    if (!GoEasySDK) {
      throw new Error('GoEasy SDK 未加载');
    }

    // 初始化实例（单例，只初始化一次）
    if (!GoEasyManager.sdkInitialized) {
      this.goEasy = GoEasySDK.getInstance({
        host: GOEASY_CONFIG.host,
        appkey: GOEASY_CONFIG.appKey,
        modules: ['pubsub'],
      });
      GoEasyManager.sdkInitialized = true;
    } else {
      this.goEasy = GoEasySDK.getInstance({
        host: GOEASY_CONFIG.host,
        appkey: GOEASY_CONFIG.appKey,
        modules: ['pubsub'],
      });
    }

    // 建立连接
    return new Promise((resolve, reject) => {
      let settled = false;

      this.goEasy.connect({
        id: this.clientId,
        data: { name: this.playerName },
        onSuccess: () => {
          if (settled) return;
          settled = true;
          this.pubsub = this.goEasy.pubsub;
          this.notifyStatus('connected');
          console.log('[GoEasyManager] Connected as:', this.clientId);
          resolve();
        },
        onFailed: (err: any) => {
          if (settled) return;
          settled = true;
          this.notifyStatus('failed');
          console.error('[GoEasyManager] Connect failed:', err);
          reject(new Error(`连接失败: ${this.formatError(err)}`));
        },
      });

      // 超时保护 15s
      setTimeout(() => {
        if (!settled) {
          settled = true;
          this.notifyStatus('failed');
          reject(new Error('连接超时'));
        }
      }, 15000);
    });
  }

  // 创建房间
  async createRoom(): Promise<string> {
    if (!this.goEasy || !this.pubsub) throw new Error('未初始化');

    this.isHost = true;
    this.roomId = this.generateRoomId();
    this.channelName = `${GOEASY_CONFIG.channelPrefix}${this.roomId}`;

    return new Promise((resolve, reject) => {
      let settled = false;

      this.pubsub.subscribe({
        channel: this.channelName,
        onMessage: (msg: { content: string }) => {
          this.handleIncomingMessage(msg.content);
        },
        onSuccess: () => {
          if (settled) return;
          settled = true;
          console.log('[GoEasyManager] Room created:', this.roomId);
          this.startHeartbeat();
          resolve(this.roomId);
        },
        onFailed: (err: any) => {
          if (settled) return;
          settled = true;
          reject(new Error(`创建房间失败: ${this.formatError(err)}`));
        },
      });

      // 超时保护 15s
      setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('创建房间超时'));
        }
      }, 15000);
    });
  }

  // 加入房间
  async connectToRoom(roomId: string): Promise<void> {
    if (!this.goEasy || !this.pubsub) throw new Error('未初始化');

    this.isHost = false;
    this.roomId = roomId;
    this.channelName = `${GOEASY_CONFIG.channelPrefix}${roomId}`;

    return new Promise((resolve, reject) => {
      let settled = false;

      this.pubsub.subscribe({
        channel: this.channelName,
        onMessage: (msg: { content: string }) => {
          this.handleIncomingMessage(msg.content);
        },
        onSuccess: () => {
          if (settled) return;
          settled = true;
          console.log('[GoEasyManager] Joined room:', roomId);
          // 通知房主玩家加入
          this.broadcast({
            type: 'player-join',
            payload: { name: this.playerName },
          });
          this.startHeartbeat();
          resolve();
        },
        onFailed: (err: any) => {
          if (settled) return;
          settled = true;
          reject(new Error(`加入房间失败: ${this.formatError(err)}`));
        },
      });

      // 超时保护 15s
      setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('加入房间超时'));
        }
      }, 15000);
    });
  }

  // 处理收到的消息
  private handleIncomingMessage(content: string): void {
    if (this.destroyed) return;

    try {
      const data = JSON.parse(content) as PeerMessage;

      // 忽略自己发的消息
      if (data.from === this.clientId) return;

      // 更新对端活跃时间
      this.peerLastSeen.set(data.from, Date.now());

      // 自动响应 ping → pong
      if (data.type === 'ping') {
        this.broadcast({ type: 'pong', payload: null });
        return;
      }

      // pong 只用于更新活跃时间，不分发
      if (data.type === 'pong') return;

      // player-join 时触发 connection handler
      if (data.type === 'player-join') {
        this.connectionHandlers.forEach((h) => h(data.from));
      }

      // 分发给所有 messageHandlers
      this.messageHandlers.forEach((h) => h(data));
    } catch (e) {
      console.warn('[GoEasyManager] Failed to parse message:', e);
    }
  }

  // 广播消息
  broadcast(msg: Omit<PeerMessage, 'from' | 'timestamp'>): void {
    if (!this.pubsub || !this.channelName || this.destroyed) return;

    const fullMsg: PeerMessage = {
      ...msg,
      from: this.clientId,
      timestamp: Date.now(),
    };

    this.pubsub.publish({
      channel: this.channelName,
      message: JSON.stringify(fullMsg),
      onSuccess: () => {},
      onFailed: (err: any) => {
        console.error('[GoEasyManager] Publish failed:', err);
      },
    });
  }

  // 发送消息给特定玩家（GoEasy PubSub 实际上是广播，对方通过 from 字段过滤）
  sendToPeer(peerId: string, msg: Omit<PeerMessage, 'from' | 'timestamp'>): void {
    // 在 PubSub 模式下，sendToPeer 等同于 broadcast
    // 接收方需自行根据 payload 中的 target 字段过滤
    const fullMsg: PeerMessage = {
      ...msg,
      payload: { ...msg.payload, target: peerId },
      from: this.clientId,
      timestamp: Date.now(),
    };

    if (!this.pubsub || !this.channelName || this.destroyed) return;

    this.pubsub.publish({
      channel: this.channelName,
      message: JSON.stringify(fullMsg),
      onSuccess: () => {},
      onFailed: (err: any) => {
        console.error('[GoEasyManager] SendToPeer failed:', err);
      },
    });
  }

  // 事件监听
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  onDisconnection(handler: DisconnectionHandler): void {
    this.disconnectionHandlers.push(handler);
  }

  onConnection(handler: ConnectionHandler): void {
    this.connectionHandlers.push(handler);
  }

  onConnectionStatusChange(handler: StatusHandler): void {
    this.statusHandlers.push(handler);
  }

  // 心跳机制
  startHeartbeat(): void {
    this.stopHeartbeat();

    // 每 15 秒发送 ping
    this.heartbeatInterval = setInterval(() => {
      if (this.destroyed) {
        this.stopHeartbeat();
        return;
      }
      this.broadcast({ type: 'ping', payload: null });
    }, 15000);

    // 每 20 秒检查对端活跃度
    this.checkInterval = setInterval(() => {
      if (this.destroyed) {
        this.stopHeartbeat();
        return;
      }
      const now = Date.now();
      this.peerLastSeen.forEach((lastSeen, peerId) => {
        // 45 秒无消息判定断线
        if (now - lastSeen > 45000) {
          console.log('[GoEasyManager] Heartbeat timeout for peer:', peerId);
          this.peerLastSeen.delete(peerId);
          this.disconnectionHandlers.forEach((h) => h(peerId));
        }
      });
    }, 20000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  // 离开房间
  leaveRoom(): void {
    // 广播离开消息
    this.broadcast({ type: 'player-leave', payload: { name: this.playerName } });

    // 延迟 500ms 后销毁，确保消息发出
    setTimeout(() => {
      this.destroy();
    }, 500);
  }

  // 销毁
  destroy(): void {
    this.destroyed = true;
    this.stopHeartbeat();

    if (this.pubsub && this.channelName) {
      try {
        this.pubsub.unsubscribe({
          channel: this.channelName,
          onFailed: () => {},
        });
      } catch {}
      this.channelName = '';
    }

    if (this.goEasy) {
      try {
        this.goEasy.disconnect({ onFailed: () => {} });
      } catch {}
    }

    this.goEasy = null;
    this.pubsub = null;
    this.messageHandlers = [];
    this.disconnectionHandlers = [];
    this.connectionHandlers = [];
    this.statusHandlers = [];
    this.peerLastSeen.clear();
    GoEasyManager.sdkInitialized = false;
    this.notifyStatus('disconnected');
    console.log('[GoEasyManager] Destroyed');
  }

  // 通知连接状态变化
  private notifyStatus(status: ConnectionStatus): void {
    this.statusHandlers.forEach((h) => {
      try {
        h(status);
      } catch (e) {
        console.warn('[GoEasyManager] Status handler error:', e);
      }
    });
  }

  // 格式化错误
  private formatError(err: any): string {
    if (!err) return '未知错误';
    if (typeof err === 'string') return err;
    if (err.content) return `[${err.code || '?'}] ${err.content}`;
    if (err.message) return err.message;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  // Getters
  getRoomId(): string {
    return this.roomId;
  }

  getClientId(): string {
    return this.clientId;
  }

  getIsHost(): boolean {
    return this.isHost;
  }

  setIsHost(v: boolean): void {
    this.isHost = v;
  }
}
