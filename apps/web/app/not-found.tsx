import Link from "next/link";

export default function NotFound() {
  return <main className="site-shell state-page"><p className="eyebrow">404 / not found</p><h1>That champion is not in this publication.</h1><p>Try a champion from the current catalog.</p><Link className="button-link" href="/">Back to champions</Link></main>;
}
