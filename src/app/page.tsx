'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  GameState,
  GameConfig,
  Point,
  Snake,
  GRID_SIZE,
  SNAKE_COLORS,
  createGame,
  setDirection,
  tickGame,
  tickAI,
} from '@/lib/game-engine';
import { BoardRenderer } from '@/lib/board-renderer';
import { sound } from '@/lib/sound';
import { GoEasyManager, PeerMessage } from '@/lib/goeasy-manager';

type Screen = 'menu' | 'setup' | 'lobby' | 'game' | 'end';

export default function Home() {
  // Screen state
  const [screen, setScreen] = useState<Screen>('menu');

  // Game state
  const [game, setGame] = useState<GameState | null>(null);
  const [paused, setPaused] = useState(false);
  const gameRef = useRef<GameState | null>(null);

  // Player settings
  const [myName, setMyName] = useState('');
  const [speed, setSpeed] = useState<'slow' | 'normal' | 'fast'>('normal');
  const [mode, setMode] = useState<'local' | 'online'>('local');

  // Online
  const [roomId, setRoomId] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [onlinePlayers, setOnlinePlayers] = useState<string[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<string>('');

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const peerRef = useRef<GoEasyManager | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastBroadcastRef = useRef<number>(0);

  // ===== Single player start =====
  const startLocalGame = useCallback(() => {
    const name = myName || '玩家';
    const players = [
      { name, color: SNAKE_COLORS[0], isAI: false },
      { name: 'AI-小红', color: SNAKE_COLORS[1], isAI: true },
      { name: 'AI-小紫', color: SNAKE_COLORS[2], isAI: true },
    ];
    const config: GameConfig = { gridW: GRID_SIZE, gridH: GRID_SIZE, speed, mode: 'local' };
    const state = createGame(config, players);
    gameRef.current = state;
    setGame(state);
    setScreen('game');
    sound.init();
  }, [myName, speed]);

  // ===== Online mode =====
  const initOnline = useCallback(async (asHost: boolean, targetRoomId?: string) => {
    const name = myName || '玩家';
    setConnectionStatus('连接中...');

    try {
      const manager = new GoEasyManager();
      peerRef.current = manager;

      manager.onConnectionStatusChange((status) => {
        setConnectionStatus(status === 'connected' ? '已连接' : status === 'connecting' ? '连接中...' : status);
      });

      manager.onMessage((msg: PeerMessage) => {
        handleOnlineMessage(msg);
      });

      await manager.initialize(name);

      if (asHost) {
        const rid = await manager.createRoom();
        setRoomId(rid);
        setIsHost(true);
        setOnlinePlayers([name]);
        setScreen('lobby');
      } else if (targetRoomId) {
        await manager.connectToRoom(targetRoomId);
        setRoomId(targetRoomId);
        setIsHost(false);
        setOnlinePlayers([]);
        setScreen('lobby');
      }
      setConnectionStatus('已连接');
    } catch (err: any) {
      setConnectionStatus(`连接失败: ${err.message || err}`);
    }
  }, [myName]);

  const handleOnlineMessage = useCallback((msg: PeerMessage) => {
    switch (msg.type) {
      case 'player-join': {
        const playerName = msg.payload?.name || '未知玩家';
        setOnlinePlayers(prev => {
          if (prev.includes(playerName)) return prev;
          return [...prev, playerName];
        });
        sound.playJoin();
        // Host broadcasts room info
        if (peerRef.current?.getIsHost()) {
          setOnlinePlayers(prev => {
            peerRef.current?.broadcast({
              type: 'room-info',
              payload: { players: prev },
            });
            return prev;
          });
        }
        break;
      }
      case 'player-leave': {
        const playerName = msg.payload?.name || '';
        setOnlinePlayers(prev => prev.filter(p => p !== playerName));
        sound.playLeave();
        break;
      }
      case 'room-info': {
        const players = msg.payload?.players || [];
        setOnlinePlayers(players);
        break;
      }
      case 'game-state': {
        // Guest receives game state from host
        const state = msg.payload as GameState;
        if (state) {
          gameRef.current = state;
          setGame(state);
          if (state.gameOver) {
            setScreen('end');
          }
        }
        break;
      }
      case 'direction': {
        // Host receives direction from guest
        if (peerRef.current?.getIsHost() && gameRef.current) {
          const { dir, playerId } = msg.payload || {};
          if (dir) {
            const snakeIdx = gameRef.current.snakes.findIndex(
              s => !s.isAI && s.name !== (myName || '玩家')
            );
            if (snakeIdx >= 0) {
              const updatedSnake = setDirection(gameRef.current.snakes[snakeIdx], dir);
              gameRef.current.snakes[snakeIdx] = updatedSnake;
            }
          }
        }
        break;
      }
    }
  }, [myName]);

  const startOnlineGame = useCallback(() => {
    if (!isHost) return;
    const name = myName || '玩家';
    const players = onlinePlayers.map((pName, i) => ({
      name: pName,
      color: SNAKE_COLORS[i % SNAKE_COLORS.length],
      isAI: false,
    }));
    // Add AI if less than 3 players
    if (players.length < 3) {
      players.push({ name: 'AI-小红', color: SNAKE_COLORS[players.length % SNAKE_COLORS.length], isAI: true });
    }
    const config: GameConfig = { gridW: GRID_SIZE, gridH: GRID_SIZE, speed, mode: 'online' };
    const state = createGame(config, players);
    gameRef.current = state;
    setGame(state);
    setScreen('game');
    sound.init();
    // Broadcast initial state
    peerRef.current?.broadcast({ type: 'game-state', payload: state });
  }, [isHost, myName, onlinePlayers, speed]);

  // ===== Game loop =====
  useEffect(() => {
    if (screen !== 'game' || !gameRef.current) return;

    let lastTime = performance.now();
    let stateUpdateCounter = 0;

    const loop = (time: number) => {
      const dtMs = Math.min(time - lastTime, 50);
      lastTime = time;
      const dtSec = dtMs / 1000;

      if (!paused && gameRef.current && !gameRef.current.gameOver) {
        // Tick game
        gameRef.current = tickGame(gameRef.current, dtSec);

        // Online host broadcasts ~15Hz
        if (mode === 'online' && isHost) {
          if (time - lastBroadcastRef.current > 66) {
            lastBroadcastRef.current = time;
            peerRef.current?.broadcast({ type: 'game-state', payload: gameRef.current });
          }
        }

        // Update React state at ~30fps for UI panel
        stateUpdateCounter++;
        if (stateUpdateCounter % 2 === 0) {
          setGame({ ...gameRef.current });
        }

        // Check game over
        if (gameRef.current.gameOver) {
          setGame({ ...gameRef.current });
          sound.playGameOver();
          setTimeout(() => setScreen('end'), 1000);
        }
      }

      // Render
      if (rendererRef.current && gameRef.current) {
        rendererRef.current.render(gameRef.current);
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [screen, paused, mode, isHost]);

  // ===== Canvas init =====
  useEffect(() => {
    if (screen === 'game' && canvasRef.current && !rendererRef.current) {
      const gridW = gameRef.current?.config.gridW || GRID_SIZE;
      const gridH = gameRef.current?.config.gridH || GRID_SIZE;
      rendererRef.current = new BoardRenderer(canvasRef.current, gridW, gridH);
    }
    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [screen]);

  // ===== Window resize =====
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => rendererRef.current?.resize(), 100);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ===== Keyboard input =====
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (screen !== 'game' || !gameRef.current) return;

      const myIndex = gameRef.current.snakes.findIndex(s => !s.isAI);
      if (myIndex < 0) return;

      let dir: Point | null = null;
      switch (e.key) {
        case 'ArrowUp': case 'w': case 'W': dir = { x: 0, y: -1 }; break;
        case 'ArrowDown': case 's': case 'S': dir = { x: 0, y: 1 }; break;
        case 'ArrowLeft': case 'a': case 'A': dir = { x: -1, y: 0 }; break;
        case 'ArrowRight': case 'd': case 'D': dir = { x: 1, y: 0 }; break;
        case 'Shift': case ' ':
          // Sprint
          if (gameRef.current.snakes[myIndex].alive) {
            gameRef.current.snakes[myIndex].boosting = true;
            sound.playBoost();
          }
          e.preventDefault();
          break;
        case 'p': case 'P': case 'Escape':
          if (mode === 'local') setPaused(p => !p);
          break;
      }

      if (dir && gameRef.current) {
        const updatedSnake = setDirection(gameRef.current.snakes[myIndex], dir);
        gameRef.current.snakes[myIndex] = updatedSnake;

        if (mode === 'online' && !isHost) {
          peerRef.current?.broadcast({
            type: 'direction',
            payload: { dir, playerId: peerRef.current.getClientId() },
          });
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (screen !== 'game' || !gameRef.current) return;
      if (e.key === 'Shift' || e.key === ' ') {
        const myIndex = gameRef.current.snakes.findIndex(s => !s.isAI);
        if (myIndex >= 0 && gameRef.current.snakes[myIndex]) {
          gameRef.current.snakes[myIndex].boosting = false;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [screen, mode, isHost]);

  // ===== Touch input =====
  useEffect(() => {
    if (screen !== 'game') return;
    let touchStartX = 0;
    let touchStartY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
      if (e.touches.length === 2 && gameRef.current) {
        // Two-finger = boost
        const myIndex = gameRef.current.snakes.findIndex(s => !s.isAI);
        if (myIndex >= 0) {
          gameRef.current.snakes[myIndex].boosting = true;
          sound.playBoost();
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (gameRef.current) {
        const myIndex = gameRef.current.snakes.findIndex(s => !s.isAI);
        if (myIndex >= 0) {
          gameRef.current.snakes[myIndex].boosting = false;
        }
      }

      if (e.changedTouches.length === 1) {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        if (Math.max(absDx, absDy) < 20) return; // too short

        let dir: Point | null = null;
        if (absDx > absDy) {
          dir = dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
        } else {
          dir = dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };
        }

        if (dir && gameRef.current) {
          const myIndex = gameRef.current.snakes.findIndex(s => !s.isAI);
          if (myIndex >= 0) {
            const updatedSnake = setDirection(gameRef.current.snakes[myIndex], dir);
            gameRef.current.snakes[myIndex] = updatedSnake;
            if (mode === 'online' && !isHost) {
              peerRef.current?.broadcast({
                type: 'direction',
                payload: { dir, playerId: peerRef.current.getClientId() },
              });
            }
          }
        }
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [screen, mode, isHost]);

  // ===== Cleanup on unmount =====
  useEffect(() => {
    return () => {
      peerRef.current?.destroy();
      peerRef.current = null;
    };
  }, []);

  // ===== Render screens =====

  // Menu Screen
  if (screen === 'menu') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-8 animate-fadeIn">
        <div className="text-center">
          <h1 className="text-5xl md:text-6xl font-bold bg-gradient-to-r from-green-400 to-emerald-500 bg-clip-text text-transparent animate-bounceIn">
            贪吃蛇大作战
          </h1>
          <p className="mt-4 text-gray-400 text-lg">多人在线对战贪吃蛇</p>
        </div>
        <button
          onClick={() => setScreen('setup')}
          className="px-10 py-4 text-lg font-bold rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 transition-all duration-200 transform hover:scale-105 shadow-lg shadow-green-500/25"
        >
          开始游戏
        </button>
      </div>
    );
  }

  // Setup Screen
  if (screen === 'setup') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-4 animate-fadeIn">
        <h2 className="text-3xl font-bold">游戏设置</h2>

        {/* Nickname */}
        <div className="w-full max-w-sm">
          <label className="block text-sm text-gray-400 mb-2">昵称</label>
          <input
            type="text"
            value={myName}
            onChange={(e) => setMyName(e.target.value)}
            placeholder="输入你的昵称"
            maxLength={10}
            className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 focus:border-green-500 focus:outline-none transition-colors"
          />
        </div>

        {/* Mode */}
        <div className="w-full max-w-sm">
          <label className="block text-sm text-gray-400 mb-2">模式</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setMode('local')}
              className={`px-4 py-3 rounded-lg font-medium transition-all ${mode === 'local' ? 'bg-green-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
            >
              单人模式
            </button>
            <button
              onClick={() => setMode('online')}
              className={`px-4 py-3 rounded-lg font-medium transition-all ${mode === 'online' ? 'bg-green-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
            >
              在线对战
            </button>
          </div>
        </div>

        {/* Speed */}
        <div className="w-full max-w-sm">
          <label className="block text-sm text-gray-400 mb-2">速度</label>
          <div className="grid grid-cols-3 gap-3">
            {(['slow', 'normal', 'fast'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`px-4 py-3 rounded-lg font-medium transition-all ${speed === s ? 'bg-green-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
              >
                {s === 'slow' ? '慢' : s === 'normal' ? '正常' : '快'}
              </button>
            ))}
          </div>
        </div>

        {/* Online options */}
        {mode === 'online' && (
          <div className="w-full max-w-sm space-y-3 animate-slideUp">
            <button
              onClick={() => initOnline(true)}
              className="w-full px-4 py-3 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 font-medium transition-all"
            >
              创建房间
            </button>
            <div className="flex gap-2">
              <input
                type="text"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
                placeholder="输入房间号"
                maxLength={6}
                className="flex-1 px-4 py-3 rounded-lg bg-white/10 border border-white/20 focus:border-green-500 focus:outline-none transition-colors uppercase"
              />
              <button
                onClick={() => joinRoomId && initOnline(false, joinRoomId)}
                disabled={!joinRoomId}
                className="px-6 py-3 rounded-lg bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 font-medium transition-all disabled:opacity-50"
              >
                加入
              </button>
            </div>
            {connectionStatus && (
              <p className="text-sm text-center text-gray-400">{connectionStatus}</p>
            )}
          </div>
        )}

        {/* Start local game */}
        {mode === 'local' && (
          <button
            onClick={startLocalGame}
            className="w-full max-w-sm px-6 py-4 text-lg font-bold rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 transition-all duration-200 transform hover:scale-105 shadow-lg shadow-green-500/25"
          >
            开始游戏
          </button>
        )}

        {/* Back */}
        <button
          onClick={() => setScreen('menu')}
          className="text-gray-400 hover:text-white transition-colors text-sm"
        >
          ← 返回主菜单
        </button>
      </div>
    );
  }

  // Lobby Screen
  if (screen === 'lobby') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-4 animate-fadeIn">
        <h2 className="text-3xl font-bold">等待大厅</h2>

        <div className="bg-white/10 rounded-xl p-6 w-full max-w-sm">
          <div className="text-center mb-4">
            <p className="text-sm text-gray-400">房间号</p>
            <p className="text-3xl font-mono font-bold tracking-widest text-green-400">{roomId}</p>
          </div>

          <div className="border-t border-white/10 pt-4">
            <p className="text-sm text-gray-400 mb-3">玩家 ({onlinePlayers.length}/4)</p>
            <div className="space-y-2">
              {onlinePlayers.map((player, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: SNAKE_COLORS[i % SNAKE_COLORS.length].body }}
                  />
                  <span className="font-medium">{player}</span>
                  {i === 0 && isHost && <span className="text-xs text-yellow-400 ml-auto">房主</span>}
                </div>
              ))}
            </div>
          </div>

          {!isHost && (
            <p className="text-center text-sm text-gray-400 mt-4 animate-pulse">等待房主开始游戏...</p>
          )}
        </div>

        {isHost && (
          <button
            onClick={startOnlineGame}
            disabled={onlinePlayers.length < 1}
            className="w-full max-w-sm px-6 py-4 text-lg font-bold rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 transition-all duration-200 transform hover:scale-105 shadow-lg shadow-green-500/25 disabled:opacity-50"
          >
            开始游戏
          </button>
        )}

        <button
          onClick={() => {
            peerRef.current?.leaveRoom();
            peerRef.current = null;
            setScreen('setup');
          }}
          className="text-gray-400 hover:text-white transition-colors text-sm"
        >
          ← 离开房间
        </button>
      </div>
    );
  }

  // Game Screen
  if (screen === 'game') {
    return (
      <div className="flex flex-col md:flex-row w-full h-screen overflow-hidden">
        {/* Canvas area */}
        <div className="flex-1 flex items-center justify-center p-2 md:p-4 relative">
          <div className="relative w-full h-full max-w-[min(100vw,80vh)] max-h-[80vh] md:max-w-[min(70vw,90vh)] md:max-h-[90vh] aspect-square">
            <canvas
              ref={canvasRef}
              className="w-full h-full rounded-lg"
              style={{ touchAction: 'none' }}
            />
          </div>
          {/* Pause overlay */}
          {paused && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-10 rounded-lg">
              <div className="text-center animate-bounceIn">
                <p className="text-4xl font-bold mb-4">暂停</p>
                <p className="text-gray-400">按 P 或 Esc 继续</p>
              </div>
            </div>
          )}
        </div>

        {/* Info panel */}
        <div className="w-full md:w-64 lg:w-72 bg-gray-900/80 border-t md:border-t-0 md:border-l border-white/10 p-4 flex flex-col gap-4 overflow-y-auto">
          <h3 className="text-lg font-bold text-gray-200">玩家</h3>
          <div className="space-y-2">
            {game?.snakes.map((sn) => (
              <div
                key={sn.id}
                className={`flex items-center gap-3 p-3 rounded-lg ${sn.alive ? 'bg-white/10' : 'bg-white/5 opacity-50'}`}
              >
                <div
                  className="w-4 h-4 rounded-full flex-shrink-0"
                  style={{ backgroundColor: sn.color.body }}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate">{sn.name}</div>
                  <div className="text-xs text-gray-400">
                    分数: {sn.score}{sn.kills > 0 && ` · 击杀: ${sn.kills}`}
                  </div>
                </div>
                {!sn.alive && <span className="text-xs text-red-400 flex-shrink-0">已死亡</span>}
              </div>
            ))}
          </div>

          {/* Controls hint */}
          <div className="mt-auto border-t border-white/10 pt-4 space-y-2">
            <p className="text-xs text-gray-500">WASD / 方向键：移动</p>
            <p className="text-xs text-gray-500">Shift / 空格：冲刺</p>
            <p className="text-xs text-gray-500">P / Esc：暂停</p>
            {mode === 'local' && (
              <button
                onClick={() => setPaused(p => !p)}
                className="w-full mt-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-medium transition-colors"
              >
                {paused ? '继续' : '暂停'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // End Screen
  if (screen === 'end') {
    const winner = game?.winner || '未知';
    const sortedSnakes = game ? [...game.snakes].sort((a, b) => b.score - a.score) : [];

    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-4 animate-fadeIn">
        <h2 className="text-4xl font-bold animate-bounceIn">游戏结束</h2>

        <div className="bg-white/10 rounded-xl p-6 w-full max-w-sm">
          <div className="text-center mb-4">
            <p className="text-sm text-gray-400">获胜者</p>
            <p className="text-2xl font-bold text-green-400">{winner}</p>
          </div>

          <div className="border-t border-white/10 pt-4 space-y-2">
            {sortedSnakes.map((sn, i) => (
              <div key={sn.id} className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
                <span className="text-sm font-bold text-gray-500 w-5">{i + 1}</span>
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: sn.color.body }} />
                <span className="flex-1 font-medium text-sm">{sn.name}</span>
                <span className="text-sm text-gray-400">{sn.score}分</span>
                {sn.kills > 0 && <span className="text-xs text-red-400">{sn.kills}杀</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-4 w-full max-w-sm">
          <button
            onClick={() => {
              if (mode === 'local') {
                startLocalGame();
              } else {
                startOnlineGame();
              }
            }}
            className="flex-1 px-6 py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 font-bold transition-all"
          >
            再来一局
          </button>
          <button
            onClick={() => {
              cancelAnimationFrame(animFrameRef.current);
              rendererRef.current?.destroy();
              rendererRef.current = null;
              gameRef.current = null;
              setGame(null);
              if (mode === 'online') {
                peerRef.current?.leaveRoom();
                peerRef.current = null;
                setScreen('setup');
              } else {
                setScreen('menu');
              }
            }}
            className="flex-1 px-6 py-3 rounded-xl bg-white/10 hover:bg-white/20 font-bold transition-all"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  return null;
}
