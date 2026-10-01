const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

async function requestApi(url, options) {
  const response = await fetch(url, options && {
    ...options,
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const responseData = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(responseData.message || 'Terjadi kesalahan');
  return responseData;
}

function formatRupiah(number) {
  return 'Rp ' + Number(number).toLocaleString('id-ID');
}

function escapeHtml(text) {
  const replacements = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text).replace(/[&<>"']/g, (character) => replacements[character]);
}

function getTransactionIdFromUrl() {
  return new URLSearchParams(window.location.search).get('id');
}
