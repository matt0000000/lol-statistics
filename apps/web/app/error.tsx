"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="site-shell state-page"><p className="eyebrow">Something went wrong</p><h1>The statistics desk needs a restart.</h1><p>We could not load this view. Your scope is unchanged; retry when ready.</p><button className="button-link" onClick={() => reset()}>Retry</button></main>;
}
