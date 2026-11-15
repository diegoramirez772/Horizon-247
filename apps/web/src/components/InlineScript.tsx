// Next 16 guide «Preventing flash before hydration»: an inline script that runs while the HTML is parsed. It is
// `text/javascript` on the server and `text/plain` on the client, so React does not warn about rendering a <script>.
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
