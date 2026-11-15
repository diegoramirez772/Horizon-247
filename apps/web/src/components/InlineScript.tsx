"use client";

// Next 16 guide «Preventing flash before hydration»: an inline script that runs while the HTML is parsed. It is
// `text/javascript` on the server and `text/plain` on the client, so React does not warn about rendering a <script>.
// It must be a Client Component: as a Server Component the `typeof window` check only ran on the server, the client got
// `text/javascript` from the RSC payload and React warned «Encountered a script tag while rendering».
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
