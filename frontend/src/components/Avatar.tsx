// Small gradient co-pilot avatar with a spark glyph. `live` adds a pulsing glow.
export default function Avatar({ live = false }: { live?: boolean }) {
  return (
    <div
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-mid to-brand-dark text-white shadow-soft ${
        live ? "pulse-glow" : ""
      }`}
      aria-hidden
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l1.9 5.2L19 9l-5.1 1.8L12 16l-1.9-5.2L5 9l5.1-1.8L12 2z" />
        <circle cx="18.5" cy="17.5" r="2" opacity="0.85" />
      </svg>
    </div>
  );
}
