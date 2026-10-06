// Hands a file to the user via a Blob URL. Nothing is uploaded anywhere.
export function downloadBytes(name: string, bytes: Uint8Array<ArrayBuffer> | string, type: string): void {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function readFileBytes(f: File): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await f.arrayBuffer());
}
