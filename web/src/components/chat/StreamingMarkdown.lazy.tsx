/**
 * Lazy wrapper for <StreamingMarkdown />.
 *
 * Why: the real component pulls in `streamdown` + `@streamdown/code` +
 * shiki (≈ hundreds of kB gzipped). Before the first assistant message
 * renders, the empty chat view does not need any of that JavaScript —
 * so we defer it with `React.lazy`.
 *
 * The fallback is a single line of raw text. Streamdown output takes
 * milliseconds to render once the chunk arrives, and keeping the same
 * textual content in the fallback prevents layout jumps while the
 * chunk streams in.
 *
 * The public prop surface (`{ content: string; streaming?: boolean }`)
 * matches the original export so callers can swap imports with no other
 * changes.
 */
import { lazy, Suspense } from 'react';

const StreamingMarkdownInner = lazy(() =>
  import('./StreamingMarkdown').then((m) => ({ default: m.StreamingMarkdown })),
);

interface StreamingMarkdownProps {
  content: string;
  streaming?: boolean;
}

function MarkdownFallback({ content }: { content: string }) {
  // Plain text keeps the bubble roughly the right size while the real
  // renderer is loading. whitespace-pre-wrap preserves newlines.
  return (
    <div className="chat-md">
      <p className="whitespace-pre-wrap">{content}</p>
    </div>
  );
}

export function StreamingMarkdown(props: StreamingMarkdownProps) {
  return (
    <Suspense fallback={<MarkdownFallback content={props.content} />}>
      <StreamingMarkdownInner {...props} />
    </Suspense>
  );
}
