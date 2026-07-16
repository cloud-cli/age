// import { render } from "https://markdown.jsfn.run/index.mjs";

export async function RenderMarkdown(/* string */ content) {
  "## convert markdown to HTML markup ##";
  return await render(content);
}
