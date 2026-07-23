import { render } from 'https://markdown.jsfn.run/index.mjs';

export async function RenderMarkdown(/*string*/ content) {
  '## convert markdown to HTML markup ##';
  return await render(content);
}

export async function CreatePageFromMarkdown(/*string*/ content) {
  '##Creates a static page from markdown, deploys it and returns the public URL.##';

  const res = await fetch('https://mdbin.api.apphor.de/p', {
    method: 'POST',
    body: content,
  });

  if (!res.ok) {
    throw new Error('Failed to create page with the provided content: ' + res.status);
  }

  const json = await res.json();

  return json.url;
}
