// Animated welcome illustration for the empty chat state.
// Three SVG frames cycle every 9 s with ambient glow, rotating ring,
// scan line, floating particles, corner brackets, and progress dots.
// Reduced-motion: every animation is frozen via `[data-globe-loader]` rules
// in index.css so the still illustration remains readable.
import frameAnalytics from '@/assets/welcome-globe-analytics.svg';
import frameBars from '@/assets/welcome-globe-bars.svg';
import frameNews from '@/assets/welcome-news-card.svg';

export function GlobeLoader() {
  // 65 % scale of the source design (400×340) — keeps the existing CSS
  // keyframes intact while compressing the visible footprint to 260×221.
  return (
    <div
      data-globe-loader
      className="relative mx-auto select-none pointer-events-none"
      style={{ width: 260, height: 221 }}
      aria-hidden="true"
    >
      <div
        className="absolute left-1/2 top-0"
        style={{ width: 400, height: 340, transform: 'translateX(-50%) scale(0.65)', transformOrigin: 'top center' }}
      >
      <div className="globe-loader-glow" />
      <div className="globe-loader-ring" />

      <div className="globe-loader-particles">
        <span className="globe-loader-particle p1" />
        <span className="globe-loader-particle p2" />
        <span className="globe-loader-particle p3" />
        <span className="globe-loader-particle p4" />
        <span className="globe-loader-particle p5" />
        <span className="globe-loader-particle p6" />
        <span className="globe-loader-particle p7" />
        <span className="globe-loader-particle p8" />
      </div>

      <div className="globe-loader-corner globe-loader-corner-tl" />
      <div className="globe-loader-corner globe-loader-corner-tr" />
      <div className="globe-loader-corner globe-loader-corner-bl" />
      <div className="globe-loader-corner globe-loader-corner-br" />

      <div className="globe-loader-scan" />

      <div className="globe-loader-frame globe-loader-frame-1">
        <img src={frameAnalytics} alt="" draggable={false} />
      </div>
      <div className="globe-loader-frame globe-loader-frame-2">
        <img src={frameBars} alt="" draggable={false} />
      </div>
      <div className="globe-loader-frame globe-loader-frame-3">
        <img src={frameNews} alt="" draggable={false} />
      </div>

      <div className="globe-loader-progress">
        <span className="globe-loader-dot globe-loader-dot-1" />
        <span className="globe-loader-dot globe-loader-dot-2" />
        <span className="globe-loader-dot globe-loader-dot-3" />
      </div>
      </div>
    </div>
  );
}
