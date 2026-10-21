import s from "./landing.module.css";

/** Custom vector lettering; the identity stays crisp without a font dependency. */
export function KultWordmark() {
  return (
    <svg className={s.wordmark} viewBox="0 0 155 41" role="img" aria-label="Kult" focusable="false">
      <g fill="currentColor">
        <path d="M0 0h9v40H0zM13 18 26 0h11L23 20l15 20H26L13 22z" />
        <path d="M45 0h9v24c0 6 3 9 8 9s8-3 8-9V0h9v25c0 10-7 16-17 16s-17-6-17-16z" />
        <path d="M89 0h9v32h20v8H89zM119 0h36v8h-13v32h-9V8h-14z" />
      </g>
    </svg>
  );
}

export function KultMonogram({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M3 3h8v34H3zM16 18 27 3h10L23 20l14 17H27L16 22z" />
    </svg>
  );
}
