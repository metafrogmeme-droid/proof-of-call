import type { TxRequest } from './types.js';

export interface AddChainParams {
  chainId: string;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls?: string[];
}

/** JSON that is safe inside a <script type="application/json"> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * The one-shot signing page. No external resources; the script runs under a nonce CSP and can only talk back to
 * the CLI's own origin. It asks the wallet for exactly the prepared transaction and posts the hash (or the error).
 */
export function bridgePage(tx: TxRequest, chain: AddChainParams, nonce: string): string {
  const payload = { chainId: tx.chainId, chain, from: tx.from, to: tx.to, data: tx.data };
  const details = tx.details.map((d) => `<li>${escapeHtml(d)}</li>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proof of Call: sign</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; --fg:#1b1f24; --bg:#f6f7f9; --card:#fff; --muted:#5b6470; --accent:#2f5bd3; --bad:#b42318; --ok:#067647; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e6e8eb; --bg:#111418; --card:#1a1e24; --muted:#9aa4b2; --accent:#7c9cff; --bad:#ff8a80; --ok:#6ee7a8; } }
  body { margin:0; font:16px/1.5 system-ui, sans-serif; background:var(--bg); color:var(--fg); }
  main { max-width:640px; margin:0 auto; padding:24px 16px; }
  .card { background:var(--card); border-radius:12px; padding:20px; box-shadow:0 1px 3px rgba(0,0,0,.12); }
  h1 { font-size:20px; margin:0 0 12px; }
  code { font-family:ui-monospace, monospace; font-size:13px; word-break:break-all; }
  ul { padding-left:20px; } .muted { color:var(--muted); font-size:14px; }
  button { font:inherit; padding:10px 16px; border-radius:8px; border:0; background:var(--accent); color:#fff; cursor:pointer; margin:4px 8px 4px 0; }
  button:disabled { opacity:.5; cursor:default; }
  #status { margin-top:16px; min-height:1.5em; } .bad { color:var(--bad); } .ok { color:var(--ok); }
</style>
</head>
<body>
<main>
<div class="card">
  <h1>${escapeHtml(tx.title)}</h1>
  <ul>${details}</ul>
  <p class="muted">From <code>${escapeHtml(tx.from)}</code><br>To <code>${escapeHtml(tx.to)}</code> (chain ${tx.chainId})<br>Value 0. Your wallet shows the same data before you confirm.</p>
  <div id="wallets"></div>
  <div id="status" role="status"></div>
</div>
<p class="muted">This page was opened by the Proof of Call CLI on your computer and only talks to it. It closes itself after one answer.</p>
</main>
<script type="application/json" id="tx">${scriptJson(payload)}</script>
<script nonce="${nonce}">
(() => {
  const tx = JSON.parse(document.getElementById('tx').textContent);
  const statusEl = document.getElementById('status');
  const walletsEl = document.getElementById('wallets');
  const providers = new Map();
  let done = false;
  const say = (text, cls) => { statusEl.textContent = text; statusEl.className = cls || ''; };
  const post = (body) => fetch(location.pathname + '/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const render = () => {
    walletsEl.replaceChildren();
    const list = [...providers.values()];
    if (list.length === 0 && window.ethereum) list.push({ info: { name: 'Browser wallet' }, provider: window.ethereum });
    if (list.length === 0) { say('No browser wallet found. Open this page in the browser that has your wallet (e.g. MetaMask).', 'bad'); return; }
    for (const p of list) {
      const b = document.createElement('button');
      b.textContent = 'Send with ' + p.info.name;
      b.addEventListener('click', () => send(p.provider));
      walletsEl.append(b);
    }
  };
  async function send(provider) {
    if (done) return;
    for (const b of walletsEl.querySelectorAll('button')) b.disabled = true;
    try {
      say('Connecting to the wallet...');
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })).map((a) => a.toLowerCase());
      if (!accounts.includes(tx.from.toLowerCase())) throw new Error('Select account ' + tx.from + ' in the wallet (it offered ' + (accounts.join(', ') || 'none') + ')');
      if (parseInt(await provider.request({ method: 'eth_chainId' }), 16) !== tx.chainId) {
        say('Switching the wallet to ' + tx.chain.chainName + '...');
        try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: tx.chain.chainId }] }); }
        catch (e) { if (e && e.code === 4902) await provider.request({ method: 'wallet_addEthereumChain', params: [tx.chain] }); else throw e; }
        const now = parseInt(await provider.request({ method: 'eth_chainId' }), 16);
        if (now !== tx.chainId) throw new Error('The wallet is on chain ' + now + ', expected ' + tx.chainId);
      }
      say('Confirm the transaction in the wallet...');
      const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: tx.from, to: tx.to, data: tx.data, value: '0x0' }] });
      done = true;
      await post({ hash });
      say('Sent: ' + hash + '. You can close this tab; the terminal waits for the receipt.', 'ok');
    } catch (e) {
      const message = (e && e.message) ? String(e.message) : String(e);
      say(message, 'bad');
      if (e && e.code === 4001) { done = true; await post({ error: 'rejected in the wallet' }); return; }
      for (const b of walletsEl.querySelectorAll('button')) b.disabled = false;
    }
  }
  window.addEventListener('eip6963:announceProvider', (event) => { providers.set(event.detail.info.uuid, event.detail); render(); });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  setTimeout(render, 300);
})();
</script>
</body>
</html>
`;
}
