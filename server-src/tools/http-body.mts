export async function readBoundedResponse(response: Response, maxBytes: number) {
  const contentLength = response.headers.get("content-length");
  const declaredLength = contentLength === null ? 0 : Number(contentLength);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error("Remote response exceeds the size limit");
  }
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Remote response exceeds the size limit");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}
