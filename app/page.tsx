'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  ArrowUpRight,
  Focus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TownGame, GameStats } from '@/lib/town/game';

export default function Home() {
  const host = useRef<HTMLDivElement>(null),
    game = useRef<TownGame | null>(null);
  const stickPointer = useRef<number | null>(null);
  const brakePointer = useRef<number | null>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [paused, setPaused] = useState(false),
    [muted, setMuted] = useState(true);
  const [stats, setStats] = useState<GameStats>({
    speed: 0,
    airborne: false,
    distance: 0,
    fps: 60,
    broken: 0,
  });
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  useEffect(() => {
    let dead = false;
    import('@/lib/town/game')
      .then(async ({ TownGame }) => {
        if (dead || !host.current) return;
        const g = new TownGame(host.current, setStats, (value) => {
          setPaused(value);
          if (value) {
            stickPointer.current = brakePointer.current = null;
            setKnob({ x: 0, y: 0 });
          }
        });
        game.current = g;
        try {
          await g.init();
          if (!dead) setReady(true);
        } catch (e) {
          g.dispose();
          if (!dead) setError(String(e));
        }
        if (dead) g.dispose();
      })
      .catch((e) => setError(String(e)));
    return () => {
      dead = true;
      game.current?.dispose();
      game.current = null;
    };
  }, []);
  function stick(e: React.PointerEvent<HTMLDivElement>) {
    if (paused || stickPointer.current !== e.pointerId) return;
    const r = e.currentTarget.getBoundingClientRect(),
      x = e.clientX - r.left - r.width / 2,
      y = e.clientY - r.top - r.height / 2,
      d = Math.hypot(x, y),
      k = Math.min(d, 43) / (d || 1);
    setKnob({ x: x * k, y: y * k });
    game.current?.setTouch((x * k) / 43, (-y * k) / 43);
  }
  function release(e: React.PointerEvent<HTMLDivElement>) {
    if (stickPointer.current !== e.pointerId) return;
    stickPointer.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    setKnob({ x: 0, y: 0 });
    game.current?.setTouch(0, 0);
  }
  function releaseBrake(e: React.PointerEvent<HTMLButtonElement>) {
    if (brakePointer.current !== e.pointerId) return;
    brakePointer.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    game.current?.setBrake(false);
  }
  return (
    <main className="game-shell">
      <div
        ref={host}
        className="world"
        role="application"
        aria-label="ボールで壊せる3Dの住宅街。WASDで移動、スペースでジャンプ、画面をドラッグして視点を回転。"
      />
      <header className="hud-top">
        <div className="identity">
          <span className="identity-symbol">
            R<span>·</span>
          </span>
          <div>
            <h1>ROLLING TOWN</h1>
            <p>
              坂道の街 <span className="version">/ SMASH & ROLL</span>
            </p>
          </div>
        </div>
        <div className="toolbar">
          <Button
            className="hud-button"
            variant="ghost"
            aria-label="視点を正面に戻す"
            title="視点を正面に戻す (C)"
            onClick={() => game.current?.resetCamera()}
          >
            <Focus />
          </Button>
          <Button
            className="hud-button"
            variant="ghost"
            aria-label={muted ? '音をオン' : '音をオフ'}
            title={muted ? '音をオン' : '音をオフ'}
            onClick={() => {
              game.current?.setMuted(!muted);
              setMuted(!muted);
            }}
          >
            {muted ? <VolumeX /> : <Volume2 />}
          </Button>
          <Button
            className="hud-button"
            variant="ghost"
            aria-label="坂の上からやり直す"
            title="坂の上からやり直す (R)"
            onClick={() => game.current?.reset()}
          >
            <RotateCcw />
          </Button>
          <Button
            className="hud-button"
            variant="ghost"
            aria-label={paused ? '再開' : '一時停止'}
            title="一時停止 (P)"
            onClick={() => game.current?.setPaused(!paused)}
          >
            {paused ? <Play /> : <Pause />}
          </Button>
        </div>
      </header>
      {ready && (
        <>
          <div className="location">
            <i /> HILLSIDE DISTRICT <span>01</span>
          </div>
          <div
            className="destruction-counter"
            aria-label={`破壊したパーツ ${stats.broken}`}
          >
            <span>SMASHED</span>
            <strong key={stats.broken}>
              {stats.broken.toString().padStart(3, '0')}
            </strong>
            <small>ぶつかって街を壊そう</small>
          </div>
          <div className="orbit-hint">画面をスライドして視点を回転</div>
          <div className="speedometer">
            <div className="speed-value">
              {Math.round(stats.speed).toString().padStart(2, '0')}
              <span>km/h</span>
            </div>
            <div className="speed-track">
              <i
                style={{
                  transform: 'scaleX(' + Math.min(1, stats.speed / 100) + ')',
                }}
              />
            </div>
            <p>
              {stats.airborne
                ? 'AIR TIME'
                : stats.speed > 65
                  ? 'KEEP ROLLING'
                  : 'LET’S SMASH'}
              <span>{Math.floor(stats.distance)} m</span>
            </p>
          </div>
          <div className="keyboard-hint">
            <span>
              <kbd>W A S D</kbd> 移動
            </span>
            <span>
              <kbd>SPACE</kbd> ジャンプ
            </span>
            <span>
              <kbd>SHIFT</kbd> ブレーキ
            </span>
            <span>
              <kbd>ドラッグ</kbd> 視点
            </span>
            <span>
              <kbd>R</kbd> 戻る
            </span>
          </div>
          <div className="touch-controls">
            <div
              className="joystick"
              role="application"
              aria-label="移動スティック"
              onPointerDown={(e) => {
                if (paused || stickPointer.current !== null) return;
                e.preventDefault();
                stickPointer.current = e.pointerId;
                e.currentTarget.setPointerCapture(e.pointerId);
                stick(e);
              }}
              onPointerMove={stick}
              onPointerUp={release}
              onPointerCancel={release}
              onLostPointerCapture={release}
            >
              <div
                className="stick-knob"
                style={{
                  transform: 'translate(' + knob.x + 'px,' + knob.y + 'px)',
                }}
              />
            </div>
            <div className="touch-actions">
              <button
                className="touch-brake"
                aria-label="ブレーキ"
                onPointerDown={(e) => {
                  if (paused || brakePointer.current !== null) return;
                  e.preventDefault();
                  brakePointer.current = e.pointerId;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  game.current?.setBrake(true);
                }}
                onPointerUp={releaseBrake}
                onPointerCancel={releaseBrake}
                onLostPointerCapture={releaseBrake}
              >
                BRAKE
              </button>
              <button
                className="touch-jump"
                aria-label="ジャンプ"
                onPointerDown={(e) => {
                  e.preventDefault();
                  game.current?.jump();
                }}
              >
                <ArrowUpRight />
                <span>JUMP</span>
              </button>
            </div>
          </div>
        </>
      )}
      {!ready && (
        <div className="loading-panel">
          <div className="loading-wordmark">ROLLING TOWN</div>
          <p>{error || '街を読み込み中…'}</p>
          {error ? (
            <Button onClick={() => location.reload()}>再読み込み</Button>
          ) : (
            <span className="loading-line" />
          )}
        </div>
      )}
      {paused && ready && (
        <div className="pause-scrim">
          <div className="pause-panel">
            <p>TAKE A BREATHER</p>
            <h2>ひとやすみ。</h2>
            <Button
              className="resume-button"
              onClick={() => game.current?.setPaused(false)}
            >
              <Play /> 街に戻る
            </Button>
            <span>
              WASD / 方向キーで移動 · Spaceでジャンプ
              <br />
              画面をドラッグして視点を回転 · Cで視点を戻す
            </span>
          </div>
        </div>
      )}
      <div className="vignette" />
    </main>
  );
}
