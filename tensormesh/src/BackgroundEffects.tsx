import { useEffect, useRef } from 'react';
import { ElikasVortex } from './effects/elikas-vortex.js';
import { PlektoLace } from './effects/plekto-lace.js';

export function BackgroundEffects({ kind, paused }: { kind: 'vortex' | 'lace'; paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element || !element.getContext('2d')) return;
    const effect = kind === 'vortex'
      ? new ElikasVortex(element, { ribbonCount: 20, pointsPerRibbon: 80, color: 'rgba(183,204,255,0.65)' })
      : new PlektoLace(element, { samples: 100, layers: 6, color: 'rgba(70,87,167,0.13)', coreColor: 'rgba(0,0,0,0)' });
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      effect.stop();
      effect.draw();
      if (!paused && !document.hidden && !reduced.matches) effect.start();
    };
    update();
    document.addEventListener('visibilitychange', update);
    reduced.addEventListener('change', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      reduced.removeEventListener('change', update);
      effect.destroy();
    };
  }, [kind, paused]);
  return <canvas ref={canvas} className={`background-effect effect-${kind}`} aria-hidden="true" />;
}
