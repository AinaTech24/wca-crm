// Shows a stored file. PDFs and pictures open in a new tab; anything else (a Word or Excel file — or an HTML / SVG
// page someone uploaded) is downloaded instead, so it can never run as a page inside the CRM, where it could
// read the signed-in session.
const VIEWABLE = /^(application\/pdf|image\/(png|jpe?g|gif|webp|bmp|heic|heif))$/i;

export function showBlob(blob, name = 'document') {
  if (VIEWABLE.test(blob.type || '')) {
    const u = URL.createObjectURL(blob);
    window.open(u, '_blank');
    setTimeout(() => URL.revokeObjectURL(u), 60000);
    return;
  }
  const u = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = u;
  a.download = name || 'document';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
