async function parseResponse(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

export async function verifyClaim(id, secret, document) {
  const params = new URLSearchParams({ secret, document });
  const res = await fetch(`/api/claim/verify/${encodeURIComponent(id)}?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  return parseResponse(res);
}

export async function postClaimAnswer({ claimId, answer, file }) {
  const form = new FormData();
  form.append('claim_id', claimId);
  form.append('answer', answer);
  form.append('type', 'CLIENT');
  if (file) form.append('attachment', file);

  const res = await fetch('/api/claim/answer', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: form,
  });
  return parseResponse(res);
}

export async function closeClaim(claimId, secret, document) {
  const res = await fetch(`/api/claim/close/${encodeURIComponent(claimId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ secret, document }),
  });
  return parseResponse(res);
}

export async function resendClaimSecret(id) {
  const res = await fetch(`/api/claim/secret?id=${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
  });
  return parseResponse(res);
}
