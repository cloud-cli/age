import { readBoundedResponse } from "./http-body.mjs";

// import { render } from 'https://markdown.jsfn.run/index.mjs';

//export async function RenderMarkdown(/*string*/ content) {
//  '## convert markdown to HTML markup ##';
//  return await render(content);
//}

export async function CreatePageFromMarkdown(/*string*/ content: string) {
  "##Creates a static page from markdown, deploys it and returns the public URL.##";
  if (Buffer.byteLength(content, "utf8") > 1_000_000) {
    throw new Error("Markdown content exceeds the 1 MB limit");
  }

  const res = await fetch("https://mdbin.api.apphor.de/p", {
    method: "POST",
    body: content,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    throw new Error("Failed to create page with the provided content: " + res.status);
  }

  const responseBody = await readBoundedResponse(res, 1_000_000);
  const json = JSON.parse(responseBody.toString("utf8")) as { url?: unknown };
  if (typeof json.url !== "string") {
    throw new Error("The page service returned an invalid URL");
  }
  let url: URL;
  try {
    url = new URL(json.url);
  } catch {
    throw new Error("The page service returned an invalid URL");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("The page service returned an unsupported URL");
  }
  return url.href;
}
